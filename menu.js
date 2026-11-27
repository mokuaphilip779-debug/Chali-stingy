'use strict';

/**
 * .menu — the styled command list.
 *
 * Header box carries OWNER and PREFIX only. Each category gets its own
 * box-drawing section with the commands listed one per line.
 */

const config = require('../config');

const ORDER = [
  'GROUP', 'FUN', 'OWNER', 'MEDIA', 'GENERAL', 'SYSTEM',
  'AI', 'TOOLS', 'DOWNLOAD', 'ADMIN', 'ANIME', 'MAKER',
];

const ICON = {
  GROUP: '👥', FUN: '🎉', OWNER: '👑', MEDIA: '🎬', GENERAL: '⚙️',
  SYSTEM: '🛠️', AI: '🤖', TOOLS: '🧰', DOWNLOAD: '📥', ADMIN: '🔐',
  ANIME: '🌸', MAKER: '✍️',
};

const LINE = '─';
const W = 34;

function pad(text, width = W) {
  const len = [...text].length;
  return text + ' '.repeat(Math.max(0, width - len));
}

function header(ownerName, prefix) {
  const top = `╭${LINE.repeat(W + 2)}╮`;
  const bot = `╰${LINE.repeat(W + 2)}╯`;
  const row = (label, value) => `│ ${pad(`${label}: ${value}`)} │`;
  return [
    top,
    row('OWNER', ownerName),
    row('PREFIX', prefix),
    bot,
  ].join('\n');
}

function section(name, commands, prefix) {
  const title = `${ICON[name] || '•'} ${name} MENU`;
  const head = `╭───「 ${title} 」${LINE.repeat(Math.max(0, W - [...title].length - 6))}`;
  const body = commands.map((c) => `│ ${prefix}${c}`).join('\n');
  const foot = `╰${LINE.repeat(W + 2)}`;
  return `${head}\n${body}\n${foot}`;
}

function buildMenu({ ownerName, prefix, botName }) {
  // Required lazily: index.js loads this module, so a top-level require here
  // would read a half-initialised exports object.
  const { commandsByCategory } = require('./index');
  const byCat = commandsByCategory();
  const parts = [];

  parts.push(`*${botName}*`);
  parts.push(header(ownerName, prefix));

  for (const name of ORDER) {
    const cmds = byCat.get(name);
    if (!cmds || !cmds.length) continue;
    parts.push(section(name, cmds, prefix));
  }

  const total = [...byCat.values()].reduce((n, arr) => n + arr.length, 0);
  parts.push(`_${total} commands · ${prefix}menu to redisplay_`);

  return parts.join('\n\n');
}

const commands = {
  async menu(ctx) {
    const text = buildMenu({
      ownerName: config.owner.name,
      prefix: ctx.prefix,
      botName: config.bot.name,
    });
    await ctx.reply(text);
  },
};

module.exports = { category: 'GENERAL', commands, buildMenu };
