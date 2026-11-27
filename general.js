'use strict';

/**
 * GENERAL MENU — 9 commands.
 */

const config = require('../config');
const { users } = require('../db');
const { num, uptime, bytes } = require('../lib/util');
const { buildMenu } = require('./menu');

const commands = {
  async alive(ctx) {
    const mem = process.memoryUsage();
    await ctx.reply(
      `✅ *${config.bot.name} is alive*\n\n` +
      `⏱️ Uptime: ${uptime(process.uptime())}\n` +
      `🧠 Heap: ${bytes(mem.heapUsed)}\n` +
      `⚙️ Node ${process.version}\n` +
      `🔌 Status: ${ctx.sock.user ? 'connected' : 'connecting'}\n` +
      `🏷️ ${config.bot.version}`
    );
  },

  async ping(ctx) {
    const start = Date.now();
    const sent = await ctx.reply('🏓 Pinging…');
    const latency = Date.now() - start;
    try {
      await ctx.sock.sendMessage(ctx.chatJid, { text: `🏓 *Pong!*\n\n⚡ ${latency} ms`, edit: sent.key });
    } catch {
      await ctx.reply(`🏓 *Pong!*\n\n⚡ ${latency} ms`);
    }
  },

  async owner(ctx) {
    await ctx.reply(
      `👑 *Owner*\n\n` +
      `Name: *${config.owner.name}*\n` +
      `Number: +${config.owner.number}\n` +
      `Email: ${config.owner.email}\n\n` +
      `_Contact for support, billing or a banned number._`
    );
  },

  async repo(ctx) {
    await ctx.reply(
      `📦 *Source code*\n\n${config.bot.repo}\n\n` +
      `_Deployable on Render. See the README for setup._`
    );
  },

  async pair(ctx) {
    const phone = (ctx.args[0] || '').replace(/\D/g, '');
    if (!phone) {
      throw new Error(
        'Usage: .pair 2547XXXXXXXX\n\n' +
        '_Generates a pairing code you can type into WhatsApp → Linked devices._'
      );
    }

    if (!ctx.sock) throw new Error('Not connected.');

    try {
      const code = await ctx.sock.requestPairingCode(phone);
      await ctx.reply(
        `🔗 *Pairing code for +${phone}*\n\n` +
        `\`${code}\`\n\n` +
        `On that phone: WhatsApp → Settings → Linked devices → Link a device → *Link with phone number instead*, then type the code.\n\n` +
        `_Expires in a few minutes._`
      );
    } catch (err) {
      throw new Error(`Could not generate a pairing code: ${err.message}`);
    }
  },

  async channelid(ctx) {
    if (!config.bot.channel) {
      throw new Error('BOT_CHANNEL is not set on the server.');
    }
    await ctx.reply(`📢 *Channel*\n\n${config.bot.channel}`);
  },

  async antidelete(ctx) {
    const on = !ctx.settings.antiDelete;
    users.setSettings(ctx.userId, { ...ctx.settings, antiDelete: on });
    await ctx.reply(
      `${on ? '✅' : '❌'} Anti-delete ${on ? 'enabled' : 'disabled'}.\n` +
      `_Deleted messages are ${on ? 'captured and sent to you' : 'ignored'}._`
    );
  },

  async fancy(ctx) {
    const text = ctx.text.trim();
    if (!text) {
      throw new Error(
        'Usage: .fancy <text>\n\n' +
        '_Optional style: .fancy bold Hello · styles: bold, italic, script, fraktur, double, sans, monospace, fullwidth, circled, smallcaps, flip, zalgo_'
      );
    }

    const { applyStyle, FANCY_NAMES } = require('../lib/util');
    const first = text.split(/\s+/)[0].toLowerCase();
    const known = [...FANCY_NAMES, 'smallcaps', 'flip', 'zalgo'];

    let style = 'bold';
    let body = text;
    if (known.includes(first) && text.split(/\s+/).length > 1) {
      style = first;
      body = text.split(/\s+/).slice(1).join(' ');
    }

    await ctx.reply(`✨ *${style}*\n\n${applyStyle(body, style)}`);
  },

  async voice(ctx) {
    const text = ctx.text.trim();
    if (!text) throw new Error('Usage: .voice <text to speak>');

    const ai = require('../lib/ai');
    const media = require('../lib/media');

    await ctx.react('⏳');
    const mp3 = await ai.tts(text, 'en');
    const ogg = await media.toVoiceNote(mp3);
    await ctx.send(ctx.chatJid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: ctx.msg });
  },
};

module.exports = { category: 'GENERAL', commands };
