'use strict';

/**
 * Command registry and dispatcher.
 *
 * Every command module exports a plain object: { name: handler }.
 * A handler receives one `ctx` object and returns nothing (it replies itself).
 *
 * ctx = {
 *   sock, msg, userId, chatJid, isGroup, senderJid, senderNumber,
 *   isOwner, isSudo, isAdmin, isBotAdmin, isSelf,
 *   args, text, command, prefix, settings, groupSettings,
 *   reply(t), send(jid, content, opts), react(emoji), quoted, mentioned,
 *   groupMeta(), isGroupAdmin(jid), botIsAdmin(), requireGroup(), requireAdmin(),
 *   requireOwner(), requireBotAdmin(), db, config, ai, media, util
 * }
 */

const config = require('./config');
const db = require('./db');
const ai = require('./ai');
const media = require('./media');
const util = require('./util');
const msgLib = require('./msg');

const modules = [
  require('./menu'),
  require('./group'),
  require('./fun'),
  require('./owner'),
  require('./media'),
  require('./general'),
  require('./system'),
  require('./ai'),
  require('./tools'),
  require('./download'),
  require('./admin'),
  require('./anime'),
  require('./maker'),
];

/** name -> { handler, category } */
const registry = new Map();
const categories = new Map();

for (const mod of modules) {
  const { category, commands } = mod;
  if (!category || !commands) continue;
  const names = [];
  for (const [name, handler] of Object.entries(commands)) {
    registry.set(name, { handler, category });
    names.push(name);
  }
  // Merge, never overwrite: several modules can contribute to one menu
  // (menu.js and general.js are both GENERAL).
  const existing = categories.get(category) || [];
  categories.set(category, [...existing, ...names]);
}

/** Commands that only the owner (or a sudo user) may run. */
const OWNER_ONLY = new Set([
  'allkaya', 'autoreact', 'autoreactch', 'autostatus', 'ban', 'block', 'blockinbox',
  'getpp', 'private', 'recording', 'report', 'sudo', 'typing', 'unban', 'update',
  'autochannel', 'supportch', 'botimage', 'botname', 'allprefix', 'delprefix',
]);

/** Commands that need the sender to be a group admin. */
const ADMIN_ONLY = new Set([
  'add', 'antibadword', 'antibot', 'antigroupstatus', 'antilink', 'antiporn',
  'antispam', 'antistatus', 'antitag', 'bye', 'del', 'ppgroup', 'groupname',
  'kick', 'left', 'link', 'mute', 'promote', 'purge', 'resetlink', 'revoke',
  'setgdesc', 'tag', 'tagall', 'unmute', 'welcome',
]);

/** Commands that need the bot itself to be a group admin. */
const BOT_ADMIN_ONLY = new Set([
  'add', 'kick', 'promote', 'mute', 'unmute', 'revoke', 'resetlink', 'purge', 'del',
]);

/** Commands that work in groups only. */
const GROUP_ONLY = new Set([
  'add', 'antibadword', 'antibot', 'antigroupstatus', 'antilink', 'antiporn',
  'antispam', 'antistatus', 'antitag', 'bye', 'del', 'ppgroup', 'groupinfo',
  'groupname', 'kick', 'left', 'link', 'listadmin', 'mute', 'promote', 'purge',
  'resetlink', 'revoke', 'setgdesc', 'staff', 'tag', 'tagall', 'unmute', 'welcome',
]);

function allCommandNames() {
  return [...registry.keys()];
}

function categoryOf(name) {
  return registry.get(name)?.category || null;
}

function commandsByCategory() {
  return categories;
}

/**
 * Build the ctx for one incoming message and run the matching command.
 * Returns true when a command ran.
 */
async function dispatch({ sock, msg, userId, settings, groupSettings, groupMeta, isGroupAdmin, botIsAdmin }) {
  const body = msgLib.extractText(msg.message);
  if (!body) return false;

  const prefix = settings.prefix || config.bot.prefix;
  if (!body.startsWith(prefix)) return false;

  const withoutPrefix = body.slice(prefix.length).trim();
  if (!withoutPrefix) return false;

  const [rawCmd, ...rest] = withoutPrefix.split(/\s+/);
  const command = rawCmd.toLowerCase();
  const entry = registry.get(command);
  if (!entry) return false;

  const chatJid = msg.key.remoteJid;
  const isGroup = chatJid.endsWith('@g.us');
  const senderJid = isGroup ? (msg.key.participant || '') : chatJid;
  const senderNumber = util.num(senderJid);
  const isSelf = !!msg.key.fromMe;

  const ownerNumber = config.owner.number;
  const isOwner = senderNumber === ownerNumber || isSelf;
  const isSudo = db.sudo.has(senderNumber);
  const isAdmin = isGroup ? await isGroupAdmin(senderJid) : false;
  const isBotAdmin = isGroup ? await botIsAdmin() : false;

  const args = rest;
  const text = rest.join(' ');

  const ctx = {
    sock, msg, userId, chatJid, isGroup, senderJid, senderNumber,
    isOwner, isSudo, isAdmin, isBotAdmin, isSelf,
    args, text, command, prefix, settings, groupSettings,
    quoted: msgLib.getQuoted(msg),
    mentioned: msgLib.mentionedJids(msg.message),
    db, config, ai, media, util, msgLib,

    reply: (t) => sock.sendMessage(chatJid, { text: String(t) }, { quoted: msg }),
    send: (jid, content, opts = {}) => sock.sendMessage(jid, content, opts),
    react: (emoji) => sock.sendMessage(chatJid, { react: { text: emoji, key: msg.key } }),
    groupMeta,
    isGroupAdmin,
    botIsAdmin,

    requireGroup() {
      if (!isGroup) throw new Error('This command only works in a group.');
    },
    requireAdmin() {
      if (!isGroup) throw new Error('This command only works in a group.');
      if (!isAdmin) throw new Error('You need to be a group admin to use this.');
    },
    requireBotAdmin() {
      if (!isGroup) throw new Error('This command only works in a group.');
      if (!isBotAdmin) throw new Error('Make me a group admin first.');
    },
    requireOwner() {
      if (!isOwner && !isSudo) throw new Error('Owner only.');
    },
  };

  // ── permission gates ────────────────────────────────────────────────
  if (GROUP_ONLY.has(command) && !isGroup) {
    await ctx.reply('❌ This command only works in a group.');
    return true;
  }
  if (OWNER_ONLY.has(command) && !isOwner && !isSudo) {
    await ctx.reply('❌ Owner only.');
    return true;
  }
  if (ADMIN_ONLY.has(command) && isGroup && !isAdmin && !isOwner && !isSudo) {
    await ctx.reply('❌ You need to be a group admin to use this.');
    return true;
  }
  if (BOT_ADMIN_ONLY.has(command) && isGroup && !isBotAdmin) {
    await ctx.reply('❌ Make me a group admin first.');
    return true;
  }

  try {
    await entry.handler(ctx);
  } catch (err) {
    const m = err?.message || 'Something went wrong.';
    try { await ctx.reply(`❌ ${m}`); } catch { /* ignore */ }
  }
  return true;
}

module.exports = {
  dispatch, registry, allCommandNames, categoryOf, commandsByCategory,
  OWNER_ONLY, ADMIN_ONLY, BOT_ADMIN_ONLY, GROUP_ONLY,
};
