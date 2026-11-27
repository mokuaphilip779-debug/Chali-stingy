'use strict';

/**
 * SYSTEM MENU — 8 commands. Prefix, language, bot identity, presence.
 */

const config = require('../config');
const { users } = require('../db');
const { uptime, bytes } = require('../lib/util');

const LANGS = {
  en: 'English', sw: 'Kiswahili', fr: 'Français', es: 'Español', de: 'Deutsch',
  pt: 'Português', ar: 'العربية', hi: 'हिन्दी', zh: '中文', ja: '日本語',
};

const commands = {
  async prefix(ctx) {
    const arg = ctx.args[0];
    if (!arg) {
      await ctx.reply(`⚙️ *Current prefix:* \`${ctx.prefix}\`\n\n_Change with .prefix !_`);
      return;
    }
    if (arg.length > 3) throw new Error('Prefix must be 1–3 characters.');
    users.setSettings(ctx.userId, { ...ctx.settings, prefix: arg });
    await ctx.reply(`✅ Prefix changed to \`${arg}\`.\n\n_Try ${arg}menu_`);
  },

  async allprefix(ctx) {
    ctx.requireOwner();
    const arg = ctx.args[0];
    if (!arg) {
      await ctx.reply(`⚙️ *Global prefix:* \`${config.bot.prefix}\`\n\n_Change with .allprefix !_`);
      return;
    }
    if (arg.length > 3) throw new Error('Prefix must be 1–3 characters.');
    config.bot.prefix = arg;
    await ctx.reply(`✅ Global prefix set to \`${arg}\`.\n\n_Note: this resets on redeploy unless you set BOT_PREFIX._`);
  },

  async delprefix(ctx) {
    ctx.requireOwner();
    users.setSettings(ctx.userId, { ...ctx.settings, prefix: config.bot.prefix });
    await ctx.reply(`✅ Prefix reset to the default \`${config.bot.prefix}\`.`);
  },

  async lang(ctx) {
    const code = (ctx.args[0] || '').toLowerCase();
    if (!code) {
      const current = ctx.settings.lang || 'en';
      const list = Object.entries(LANGS).map(([k, v]) => `• \`${k}\` — ${v}`).join('\n');
      await ctx.reply(`🌍 *Language:* ${LANGS[current] || current}\n\n${list}\n\n_Change with .lang sw_`);
      return;
    }
    if (!LANGS[code]) throw new Error(`Unknown language \`${code}\`. Try .lang to see the list.`);
    users.setSettings(ctx.userId, { ...ctx.settings, lang: code });
    await ctx.reply(`✅ Language set to *${LANGS[code]}*.`);
  },

  async botname(ctx) {
    ctx.requireOwner();
    const name = ctx.text.trim();
    if (!name) {
      await ctx.reply(`🤖 *Bot name:* ${config.bot.name}\n\n_Change with .botname New Name_`);
      return;
    }
    config.bot.name = name.slice(0, 40);
    await ctx.reply(`✅ Bot name set to *${config.bot.name}*.\n\n_Resets on redeploy unless you set BOT_NAME._`);
  },

  async botimage(ctx) {
    ctx.requireOwner();
    const node = ctx.quoted ? ctx.msgLib.mediaNode(ctx.quoted.message) : null;
    if (!node || !ctx.quoted.message.imageMessage) {
      throw new Error('Reply to an image with .botimage');
    }
    const buf = await ctx.sock.downloadMediaMessage(ctx.quoted);
    await ctx.sock.updateProfilePicture(ctx.sock.user.id, buf);
    await ctx.reply('✅ Bot profile picture updated.');
  },

  async online(ctx) {
    const on = !ctx.settings.alwaysOnline;
    users.setSettings(ctx.userId, { ...ctx.settings, alwaysOnline: on });
    try {
      await ctx.sock.sendPresenceUpdate(on ? 'available' : 'unavailable');
    } catch { /* ignore */ }
    await ctx.reply(`${on ? '🟢' : '⚫'} Always-online ${on ? 'enabled' : 'disabled'}.`);
  },

  async speed(ctx) {
    const start = Date.now();
    const mem = process.memoryUsage();
    // Lazy require: index.js loads this module, so a top-level require would
    // read a half-initialised exports object.
    const names = require('./index').allCommandNames();

    await ctx.reply(
      `⚡ *System speed*\n\n` +
      `🕐 Uptime: ${uptime(process.uptime())}\n` +
      `🧠 Heap used: ${bytes(mem.heapUsed)}\n` +
      `📦 Heap total: ${bytes(mem.heapTotal)}\n` +
      `🔧 RSS: ${bytes(mem.rss)}\n` +
      `⚙️ Node: ${process.version}\n` +
      `📋 Commands loaded: ${names.length}\n` +
      `⏱️ Handler: ${Date.now() - start} ms`
    );
  },
};

module.exports = { category: 'SYSTEM', commands };
