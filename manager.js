'use strict';

/**
 * WhatsApp session manager.
 *
 * One Baileys socket per user. Handles linking, the automation features,
 * per-group moderation enforcement, and command dispatch.
 *
 * ⚠️  This uses WhatsApp Web automation (Baileys), which is NOT an official
 *     API. WhatsApp may ban numbers that use it. See README.
 */

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const config = require('../config');
const { users, deleted, groups, badwords, welcomes } = require('../db');
const msgLib = require('../lib/msg');
const { num } = require('../lib/util');
const commands = require('../commands');

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });

/** userId -> Session */
const sessions = new Map();

/** Anti-delete cache: `${userId}:${msgId}` -> { chatJid, senderJid, body } */
const messageCache = new Map();
const CACHE_LIMIT = 5000;

/** Per-group spam tracker: `${userId}:${groupJid}:${sender}` -> [timestamps] */
const spamTracker = new Map();

function cacheKey(userId, id) {
  return `${userId}:${id}`;
}

function cacheMessage(userId, msg) {
  if (!msg?.key?.id) return;
  const body = msgLib.extractText(msg.message);
  if (!body) return;
  messageCache.set(cacheKey(userId, msg.key.id), {
    chatJid: msg.key.remoteJid,
    senderJid: msg.key.participant || msg.key.remoteJid,
    body,
  });
  if (messageCache.size > CACHE_LIMIT) {
    const first = messageCache.keys().next().value;
    messageCache.delete(first);
  }
}

function getSettings(userId) {
  const u = users.byId(userId);
  if (!u) return { ...config.defaults };
  try {
    return { ...config.defaults, ...JSON.parse(u.settings || '{}') };
  } catch {
    return { ...config.defaults };
  }
}

/* ── moderation patterns ────────────────────────────────────────────── */

const LINK_RE = /(https?:\/\/|www\.)\S+/i;
const WA_GROUP_RE = /chat\.whatsapp\.com\/[A-Za-z0-9]+/i;
const PORN_RE = /\b(porn|xxx|nsfw|nude|nudes|hentai|onlyfans)\b/i;
const BOT_RE = /\b(chatbot|auto-?reply|broadcast bot)\b/i;

/** True when the sender is an admin in this group. */
function isAdminIn(meta, jid) {
  const p = (meta?.participants || []).find((x) => x.id === jid || num(x.id) === num(jid));
  return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
}

/**
 * Run the per-group protections against one message.
 * Returns true when the message was handled (deleted / warned) and should
 * not be processed further.
 */
async function enforceGroupRules(session, msg, meta, gs, text) {
  const { sock, userId } = session;
  const chatJid = msg.key.remoteJid;
  const senderJid = msg.key.participant || '';
  const senderNumber = num(senderJid);

  // Admins and the owner are never moderated.
  if (isAdminIn(meta, senderJid)) return false;
  if (senderNumber === config.owner.number) return false;

  const deleteIt = async (reason) => {
    try {
      await sock.sendMessage(chatJid, { delete: msg.key });
    } catch { /* ignore */ }
    try {
      await sock.sendMessage(chatJid, {
        text: `⚠️ @${senderNumber} — ${reason}`,
        mentions: [senderJid],
      });
    } catch { /* ignore */ }
    return true;
  };

  if (gs.antilink && (LINK_RE.test(text) || WA_GROUP_RE.test(text))) {
    return deleteIt('links are not allowed here.');
  }

  if (gs.antiporn && PORN_RE.test(text)) {
    return deleteIt('that content is not allowed here.');
  }

  if (gs.antibadword) {
    const list = badwords.list(userId, chatJid);
    if (list.length) {
      const lower = text.toLowerCase();
      const hit = list.find((w) => lower.includes(w));
      if (hit) return deleteIt('watch your language.');
    }
  }

  if (gs.antibot && BOT_RE.test(text)) {
    return deleteIt('bot talk is not allowed here.');
  }

  if ((gs.antistatus || gs.antigroupstatus) && msgLib.isGroupStatus(msg.message)) {
    return deleteIt('group statuses are not allowed here.');
  }

  if (gs.antitag) {
    const mentions = msgLib.mentionedJids(msg.message);
    if (mentions.length >= 5) {
      return deleteIt('mass mentions are not allowed here.');
    }
  }

  if (gs.antispam) {
    const key = `${userId}:${chatJid}:${senderNumber}`;
    const now = Date.now();
    const hits = (spamTracker.get(key) || []).filter((t) => now - t < 10000);
    hits.push(now);
    spamTracker.set(key, hits);

    if (hits.length > 6) {
      spamTracker.delete(key);
      return deleteIt('slow down — that is spam.');
    }
    if (spamTracker.size > 2000) spamTracker.clear();
  }

  return false;
}

/* ── Session ────────────────────────────────────────────────────────── */

class Session {
  constructor(userId) {
    this.userId = userId;
    this.sock = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.status = 'disconnected';
    this.reconnectAttempts = 0;
    this.stopped = false;
    this.listeners = new Set();
    this.groupMetaCache = new Map();
  }

  emit(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* ignore */ }
    }
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  authDir() {
    return path.join(config.sessionsDir, this.userId);
  }

  hasCreds() {
    return fs.existsSync(path.join(this.authDir(), 'creds.json'));
  }

  /** Cached group metadata, refreshed every 60s. */
  async groupMeta(jid) {
    const hit = this.groupMetaCache.get(jid);
    if (hit && Date.now() - hit.at < 60000) return hit.meta;
    const meta = await this.sock.groupMetadata(jid);
    this.groupMetaCache.set(jid, { meta, at: Date.now() });
    return meta;
  }

  async isGroupAdmin(jid) {
    try {
      const meta = await this.groupMeta(jid);
      return isAdminIn(meta, jid);
    } catch {
      return false;
    }
  }

  /** Is the bot itself an admin in the given group? */
  async botIsAdmin(jid) {
    try {
      const me = jidNormalizedUser(this.sock.user?.id || '');
      const meta = await this.groupMeta(jid);
      return isAdminIn(meta, me);
    } catch {
      return false;
    }
  }

  async start({ phoneNumber = null } = {}) {
    if (this.sock) return;
    this.stopped = false;
    fs.mkdirSync(this.authDir(), { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir());
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined;
    }

    this.sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['WA Bot Suite', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: getSettings(this.userId).alwaysOnline,
      generateHighQualityLinkPreview: false,
    });

    this.status = 'pairing';
    users.setWaStatus(this.userId, 'pairing');
    this.emit({ type: 'status', status: 'pairing' });

    if (phoneNumber && !state.creds.registered) {
      try {
        const code = await this.sock.requestPairingCode(String(phoneNumber).replace(/\D/g, ''));
        this.pairingCode = code;
        this.emit({ type: 'pairing-code', code });
      } catch (err) {
        this.emit({ type: 'error', message: `Pairing code failed: ${err.message}` });
      }
    }

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
          this.emit({ type: 'qr', qr: this.qrDataUrl });
        } catch { /* ignore */ }
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.reconnectAttempts = 0;
        this.qrDataUrl = null;
        this.pairingCode = null;
        const me = this.sock.user;
        const number = me?.id ? jidNormalizedUser(me.id).split('@')[0] : null;
        users.setWaStatus(this.userId, 'connected', number);
        this.emit({ type: 'status', status: 'connected', number });
        if (getSettings(this.userId).alwaysOnline) {
          try { await this.sock.sendPresenceUpdate('available'); } catch { /* ignore */ }
        }
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.sock = null;

        if (loggedOut) {
          this.status = 'disconnected';
          users.setWaStatus(this.userId, 'disconnected');
          this.emit({ type: 'status', status: 'disconnected', reason: 'logged_out' });
          this.clearAuth();
          return;
        }

        if (this.stopped) return;

        this.status = 'pairing';
        users.setWaStatus(this.userId, 'pairing');
        this.emit({ type: 'status', status: 'reconnecting', code });

        this.reconnectAttempts += 1;
        const delay = Math.min(30000, 2000 * this.reconnectAttempts);
        setTimeout(() => {
          if (!this.stopped) this.start().catch(() => {});
        }, delay);
      }
    });

    this.sock.ev.on('messages.upsert', (payload) => {
      this.handleUpsert(payload).catch(() => {});
    });

    this.sock.ev.on('messages.update', (updates) => {
      this.handleUpdates(updates).catch(() => {});
    });

    this.sock.ev.on('group-participants.update', (event) => {
      this.handleParticipants(event).catch(() => {});
    });
  }

  async handleUpsert({ messages, type }) {
    const settings = getSettings(this.userId);

    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid) continue;

      /* ── status broadcast ─────────────────────────────────────── */
      if (jid === 'status@broadcast') {
        if (settings.autoViewStatus) {
          try { await this.sock.readMessages([msg.key]); } catch { /* ignore */ }
        }
        if (settings.autoReactStatus) {
          try {
            await this.sock.sendMessage('status@broadcast', {
              react: { text: settings.statusReaction || '❤️', key: msg.key },
            }, { statusJidList: [jidNormalizedUser(msg.key.participant || '')] });
          } catch { /* ignore */ }
        }
        continue;
      }

      if (type !== 'notify') continue;

      cacheMessage(this.userId, msg);

      const fromMe = !!msg.key.fromMe;
      const isGroup = jid.endsWith('@g.us');
      const text = msgLib.extractText(msg.message);

      /* ── group moderation ─────────────────────────────────────── */
      if (isGroup && !fromMe) {
        const gs = groups.get(this.userId, jid);
        const anyOn = Object.values(gs).some((v) => v === true);
        if (anyOn) {
          try {
            const meta = await this.groupMeta(jid);
            const handled = await enforceGroupRules(this, msg, meta, gs, text);
            if (handled) continue;
          } catch { /* ignore — never block on a metadata failure */ }
        }
      }

      /* ── commands ─────────────────────────────────────────────── */
      if (text && text.startsWith(settings.prefix || config.bot.prefix)) {
        const ran = await commands.dispatch({
          sock: this.sock,
          msg,
          userId: this.userId,
          settings,
          groupSettings: isGroup ? groups.get(this.userId, jid) : null,
          groupMeta: () => this.groupMeta(jid),
          isGroupAdmin: (j) => this.isGroupAdmin(j),
          botIsAdmin: () => this.botIsAdmin(jid),
        }).catch(() => false);

        if (ran) continue;
      }

      /* ── automation ───────────────────────────────────────────── */
      if (!fromMe && settings.autoRead) {
        try { await this.sock.readMessages([msg.key]); } catch { /* ignore */ }
      }

      if (!fromMe && settings.autoReactMessage) {
        try {
          await this.sock.sendMessage(jid, {
            react: { text: settings.messageReaction || '👍', key: msg.key },
          });
        } catch { /* ignore */ }
      }

      if (!fromMe && settings.autoReply && settings.autoReplyText) {
        if (!isGroup || settings.autoReplyGroups) {
          if (text && !msg.message.protocolMessage) {
            try {
              await this.sock.sendMessage(jid, { text: settings.autoReplyText }, { quoted: msg });
            } catch { /* ignore */ }
          }
        }
      }
    }
  }

  async handleUpdates(updates) {
    const settings = getSettings(this.userId);
    if (!settings.antiDelete) return;

    for (const { key, update } of updates) {
      if (!key?.id) continue;
      if (!msgLib.isRevoke(update)) continue;

      const cached = messageCache.get(cacheKey(this.userId, key.id));
      if (!cached) continue;

      deleted.add({
        userId: this.userId,
        chatJid: cached.chatJid,
        senderJid: cached.senderJid,
        body: cached.body,
      });

      try {
        const me = this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : null;
        if (me) {
          const who = cached.senderJid ? cached.senderJid.split('@')[0] : 'unknown';
          await this.sock.sendMessage(me, {
            text: `🗑️ *Deleted message captured*\n\nFrom: ${who}\nChat: ${cached.chatJid}\n\n${cached.body}`,
          });
        }
      } catch { /* ignore */ }
    }
  }

  /** Welcome new members when the group has it enabled. */
  async handleParticipants({ id, participants, action }) {
    if (action !== 'add') return;
    const gs = groups.get(this.userId, id);
    if (!gs.welcome) return;

    const template = welcomes.get(this.userId, id);
    if (!template) return;

    let subject = 'this group';
    try {
      const meta = await this.groupMeta(id);
      subject = meta.subject || subject;
    } catch { /* ignore */ }

    for (const p of participants) {
      const text = template
        .replace(/\{user\}/g, `@${num(p)}`)
        .replace(/\{group\}/g, subject);
      try {
        await this.sock.sendMessage(id, { text, mentions: [p] });
      } catch { /* ignore */ }
    }
  }

  async stop() {
    this.stopped = true;
    try { this.sock?.end(undefined); } catch { /* ignore */ }
    this.sock = null;
    this.status = 'disconnected';
    users.setWaStatus(this.userId, 'disconnected');
    this.emit({ type: 'status', status: 'disconnected' });
  }

  async logout() {
    this.stopped = true;
    try { await this.sock?.logout(); } catch { /* ignore */ }
    this.sock = null;
    this.status = 'disconnected';
    users.setWaStatus(this.userId, 'disconnected');
    this.clearAuth();
    this.emit({ type: 'status', status: 'disconnected', reason: 'logged_out' });
  }

  clearAuth() {
    try {
      fs.rmSync(this.authDir(), { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  async sendText(jid, text) {
    if (!this.sock) throw new Error('Not connected');
    return this.sock.sendMessage(jid, { text });
  }
}

/* ── public API ─────────────────────────────────────────────────────── */

function getSession(userId) {
  return sessions.get(userId) || null;
}

async function startSession(userId, opts = {}) {
  let s = sessions.get(userId);
  if (!s) {
    s = new Session(userId);
    sessions.set(userId, s);
  }
  await s.start(opts);
  return s;
}

async function stopSession(userId) {
  const s = sessions.get(userId);
  if (s) await s.stop();
}

async function logoutSession(userId) {
  const s = sessions.get(userId);
  if (s) await s.logout();
  sessions.delete(userId);
}

/** Restart every user whose plan is active and who has saved credentials. */
async function restoreAll() {
  for (const u of users.all()) {
    if (!users.isActive(u.id)) continue;
    const s = new Session(u.id);
    if (!s.hasCreds()) continue;
    sessions.set(u.id, s);
    try {
      await s.start();
    } catch { /* ignore */ }
  }
}

module.exports = {
  Session,
  getSession,
  startSession,
  stopSession,
  logoutSession,
  restoreAll,
  getSettings,
  isAdminIn,
};
