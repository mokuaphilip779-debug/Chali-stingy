'use strict';

/**
 * ADMIN MENU — 3 commands. Owner-level channel and support settings.
 */

const config = require('../config');
const { users } = require('../db');
const { uptime, bytes } = require('../lib/util');

const commands = {
  async autochannel(ctx) {
    ctx.requireOwner();
    const link = ctx.text.trim();

    if (!link) {
      await ctx.reply(
        `📢 *Auto-channel:* ${config.bot.channel || '_not set_'}\n\n` +
        `_Set with .autochannel https://whatsapp.com/channel/XXXX_\n` +
        `_This is the channel shown in .channelid and .menu._`
      );
      return;
    }

    if (!/whatsapp\.com\/channel\//.test(link)) {
      throw new Error('That does not look like a WhatsApp channel link.');
    }

    config.bot.channel = link;
    await ctx.reply(`✅ Channel set to:\n${link}\n\n_Resets on redeploy unless you set BOT_CHANNEL._`);
  },

  async supportch(ctx) {
    ctx.requireOwner();
    const link = ctx.text.trim();

    if (!link) {
      await ctx.reply(
        `🆘 *Support group:* ${config.bot.supportGroup || '_not set_'}\n\n` +
        `_Set with .supportch https://chat.whatsapp.com/XXXX_`
      );
      return;
    }

    if (!/chat\.whatsapp\.com\//.test(link)) {
      throw new Error('That does not look like a WhatsApp group invite link.');
    }

    config.bot.supportGroup = link;
    await ctx.reply(`✅ Support group set to:\n${link}\n\n_Resets on redeploy unless you set SUPPORT_GROUP._`);
  },

  async ram(ctx) {
    const mem = process.memoryUsage();
    const all = users.all();
    const connected = all.filter((u) => u.wa_status === 'connected').length;

    const pct = (n) => `${((n / mem.heapTotal) * 100).toFixed(1)}%`;

    await ctx.reply(
      `💾 *Memory*\n\n` +
      `RSS: ${bytes(mem.rss)}\n` +
      `Heap used: ${bytes(mem.heapUsed)} (${pct(mem.heapUsed)})\n` +
      `Heap total: ${bytes(mem.heapTotal)}\n` +
      `External: ${bytes(mem.external)}\n` +
      `Array buffers: ${bytes(mem.arrayBuffers || 0)}\n\n` +
      `⏱️ Uptime: ${uptime(process.uptime())}\n` +
      `📱 Connected sessions: ${connected}/${all.length}\n` +
      `⚙️ Node ${process.version}`
    );
  },
};

module.exports = { category: 'ADMIN', commands };
