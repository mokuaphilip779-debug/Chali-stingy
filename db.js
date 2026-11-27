'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  password_hash TEXT,
  created_at    INTEGER NOT NULL,
  plan_status   TEXT NOT NULL DEFAULT 'inactive',
  plan_expires  INTEGER,
  wa_status     TEXT NOT NULL DEFAULT 'disconnected',
  wa_number     TEXT,
  settings      TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  amount        REAL NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  reference     TEXT UNIQUE,
  provider_ref  TEXT,
  created_at    INTEGER NOT NULL,
  paid_at       INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deleted_messages (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  chat_jid      TEXT NOT NULL,
  sender_jid    TEXT,
  body          TEXT,
  deleted_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Per-group moderation toggles. One row per (user, group).
CREATE TABLE IF NOT EXISTS group_settings (
  user_id       TEXT NOT NULL,
  group_jid     TEXT NOT NULL,
  settings      TEXT NOT NULL DEFAULT '{}',
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_jid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Per-group badword list (JSON array of lowercase words).
CREATE TABLE IF NOT EXISTS badwords (
  user_id       TEXT NOT NULL,
  group_jid     TEXT NOT NULL,
  word          TEXT NOT NULL,
  PRIMARY KEY (user_id, group_jid, word),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Per-group welcome message.
CREATE TABLE IF NOT EXISTS welcomes (
  user_id       TEXT NOT NULL,
  group_jid     TEXT NOT NULL,
  text          TEXT NOT NULL,
  PRIMARY KEY (user_id, group_jid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sudo users (extra numbers allowed to run owner commands).
-- Bot-wide, not per-user: there is one owner account per deployment.
CREATE TABLE IF NOT EXISTS sudo (
  number        TEXT PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_deleted_user ON deleted_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_group_settings ON group_settings(user_id, group_jid);
`);

const now = () => Date.now();
const uid = (prefix = '') => prefix + crypto.randomBytes(12).toString('hex');

/* ── password hashing (scrypt, no extra deps) ─────────────────────── */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── users ────────────────────────────────────────────────────────── */
const users = {
  create({ email, password }) {
    const id = uid('u_');
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, settings)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, email.toLowerCase().trim(), hashPassword(password), now(), JSON.stringify(config.defaults));
    return this.byId(id);
  },

  byId(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  byEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  },

  byWaNumber(number) {
    const digits = String(number || '').replace(/\D/g, '');
    if (!digits) return null;
    return db.prepare('SELECT * FROM users WHERE wa_number = ?').get(digits);
  },

  all() {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  },

  setSettings(id, settings) {
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id);
  },

  setWaStatus(id, status, number = null) {
    db.prepare('UPDATE users SET wa_status = ?, wa_number = COALESCE(?, wa_number) WHERE id = ?')
      .run(status, number, id);
  },

  setPlan(id, status, expires) {
    db.prepare('UPDATE users SET plan_status = ?, plan_expires = ? WHERE id = ?').run(status, expires, id);
  },

  refreshPlan(id) {
    const u = this.byId(id);
    if (!u) return null;
    if (u.plan_status === 'active' && u.plan_expires && u.plan_expires < now()) {
      db.prepare("UPDATE users SET plan_status = 'expired' WHERE id = ?").run(id);
      return this.byId(id);
    }
    return u;
  },

  isActive(id) {
    const u = this.refreshPlan(id);
    return !!u && u.plan_status === 'active' && (!u.plan_expires || u.plan_expires > now());
  },

  extendPlan(id, days) {
    const u = this.byId(id);
    if (!u) return null;
    const base = u.plan_expires && u.plan_expires > now() ? u.plan_expires : now();
    const expires = base + days * 24 * 60 * 60 * 1000;
    db.prepare("UPDATE users SET plan_status = 'active', plan_expires = ? WHERE id = ?").run(expires, id);
    return this.byId(id);
  },
};

/* ── payments ─────────────────────────────────────────────────────── */
const payments = {
  create({ userId, provider, amount, currency, reference }) {
    const id = uid('p_');
    db.prepare(
      `INSERT INTO payments (id, user_id, provider, amount, currency, status, reference, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, userId, provider, amount, currency, reference || uid('ref_'), now());
    return this.byId(id);
  },

  byId(id) {
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  },

  byReference(ref) {
    return db.prepare('SELECT * FROM payments WHERE reference = ?').get(ref);
  },

  /** Find a payment by the M-Pesa code the user typed in. */
  byProviderRef(ref) {
    return db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(String(ref || '').toUpperCase());
  },

  pendingForUser(userId) {
    return db.prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC").all(userId);
  },

  all() {
    return db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 200').all();
  },

  markPaid(id, providerRef = null) {
    const p = this.byId(id);
    if (!p || p.status === 'paid') return p;
    // Keep the M-Pesa code the user submitted — an admin approval passes a
    // placeholder, and overwriting would lose the code and break duplicate
    // detection.
    db.prepare(
      `UPDATE payments SET status = 'paid', paid_at = ?, provider_ref = COALESCE(provider_ref, ?) WHERE id = ?`
    ).run(now(), providerRef, id);
    users.extendPlan(p.user_id, config.plan.days);
    return this.byId(id);
  },

  markFailed(id) {
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(id);
  },
};

/* ── deleted messages (anti-delete log) ───────────────────────────── */
const deleted = {
  add({ userId, chatJid, senderJid, body }) {
    const id = uid('d_');
    db.prepare(
      `INSERT INTO deleted_messages (id, user_id, chat_jid, sender_jid, body, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, userId, chatJid, senderJid || null, body || '', now());
    return id;
  },
  forUser(userId, limit = 100) {
    return db.prepare('SELECT * FROM deleted_messages WHERE user_id = ? ORDER BY deleted_at DESC LIMIT ?')
      .all(userId, limit);
  },
};

/* ── per-group settings ───────────────────────────────────────────── */
const GROUP_DEFAULTS = {
  antilink: false,
  antispam: false,
  antibadword: false,
  antistatus: false,
  antitag: false,
  antigroupstatus: false,
  antibot: false,
  antiporn: false,
  welcome: false,
  antidelete: false,
};

const groups = {
  get(userId, groupJid) {
    const row = db.prepare('SELECT settings FROM group_settings WHERE user_id = ? AND group_jid = ?')
      .get(userId, groupJid);
    let stored = {};
    if (row) {
      try { stored = JSON.parse(row.settings || '{}'); } catch { stored = {}; }
    }
    return { ...GROUP_DEFAULTS, ...stored };
  },

  set(userId, groupJid, settings) {
    db.prepare(
      `INSERT INTO group_settings (user_id, group_jid, settings, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, group_jid) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`
    ).run(userId, groupJid, JSON.stringify(settings), now());
    return this.get(userId, groupJid);
  },

  toggle(userId, groupJid, key, value) {
    const s = this.get(userId, groupJid);
    s[key] = value === undefined ? !s[key] : !!value;
    this.set(userId, groupJid, s);
    return s;
  },

  allFor(userId) {
    return db.prepare('SELECT * FROM group_settings WHERE user_id = ?').all(userId);
  },
};

/* ── badwords ─────────────────────────────────────────────────────── */
const badwords = {
  list(userId, groupJid) {
    return db.prepare('SELECT word FROM badwords WHERE user_id = ? AND group_jid = ?')
      .all(userId, groupJid).map((r) => r.word);
  },
  add(userId, groupJid, word) {
    const w = String(word || '').toLowerCase().trim();
    if (!w) return false;
    db.prepare('INSERT OR IGNORE INTO badwords (user_id, group_jid, word) VALUES (?, ?, ?)')
      .run(userId, groupJid, w);
    return true;
  },
  remove(userId, groupJid, word) {
    const w = String(word || '').toLowerCase().trim();
    const info = db.prepare('DELETE FROM badwords WHERE user_id = ? AND group_jid = ? AND word = ?')
      .run(userId, groupJid, w);
    return info.changes > 0;
  },
  clear(userId, groupJid) {
    db.prepare('DELETE FROM badwords WHERE user_id = ? AND group_jid = ?').run(userId, groupJid);
  },
};

/* ── welcome messages ─────────────────────────────────────────────── */
const welcomes = {
  get(userId, groupJid) {
    const row = db.prepare('SELECT text FROM welcomes WHERE user_id = ? AND group_jid = ?').get(userId, groupJid);
    return row ? row.text : null;
  },
  set(userId, groupJid, text) {
    db.prepare(
      `INSERT INTO welcomes (user_id, group_jid, text) VALUES (?, ?, ?)
       ON CONFLICT(user_id, group_jid) DO UPDATE SET text = excluded.text`
    ).run(userId, groupJid, text);
  },
  remove(userId, groupJid) {
    db.prepare('DELETE FROM welcomes WHERE user_id = ? AND group_jid = ?').run(userId, groupJid);
  },
};

/* ── sudo (bot-wide) ──────────────────────────────────────────────── */
const sudo = {
  list() {
    return db.prepare('SELECT number FROM sudo').all().map((r) => r.number);
  },
  add(number) {
    const n = String(number || '').replace(/\D/g, '');
    if (!n) return false;
    db.prepare('INSERT OR IGNORE INTO sudo (number) VALUES (?)').run(n);
    return true;
  },
  remove(number) {
    const n = String(number || '').replace(/\D/g, '');
    const info = db.prepare('DELETE FROM sudo WHERE number = ?').run(n);
    return info.changes > 0;
  },
  has(number) {
    const n = String(number || '').replace(/\D/g, '');
    if (!n) return false;
    return !!db.prepare('SELECT 1 FROM sudo WHERE number = ?').get(n);
  },
};

module.exports = {
  db, users, payments, deleted, groups, badwords, welcomes, sudo,
  hashPassword, verifyPassword, uid, now, GROUP_DEFAULTS,
};
