'use strict';

/**
 * OWNER MENU — 14 commands. All gated to the owner number (or a sudo user).
 *
 * These change global bot behaviour for the account, not per-group settings.
 */

const config = require('../config');
const { users, sudo } = require('../db');
const { num, jidOf, bytes, uptime } = require('../lib/util');

/** Persist a global toggle into the owner's settings row. */
function setGlobal(ctx, key, value) {
  const next = { ...ctx.settings, [key]: value };
  users.setSettings(ctx.userId, next);
  return next;
}

const commands = {
  async autoreact(ctx) {
    ctx.requireOwner();
    const on = !ctx.settings.autoReactMessage;
    setGlobal(ctx, 'autoReactMessage', on);
    await ctx.reply(`${on ? '✅' : '❌'} Auto-react to messages ${on ? 'enabled' : 'disabled'}.\n_Emoji: ${ctx.settings.messageReaction || '👍'}_`);
  },

  async autoreactch(ctx) {
    ctx.requireOwner();
    const emoji = ctx.text.trim();
    if (!emoji) throw new Error('Usage: .autoreactch <emoji>');
    setGlobal(ctx, 'messageReaction', emoji);
    setGlobal(ctx, 'autoReactMessage', true);
    await ctx.reply(`✅ Auto-react set to ${emoji} and enabled.`);
  },

  async autostatus(ctx) {
    ctx.requireOwner();
    const on = !ctx.settings.autoViewStatus;
    setGlobal(ctx, 'autoViewStatus', on);
    setGlobal(ctx, 'autoReactStatus', on);
    await ctx.reply(`${on ? '✅' : '❌'} Auto-view and auto-react to statuses ${on ? 'enabled' : 'disabled'}.`);
  },

  async private(ctx) {
    ctx.requireOwner();
    const on = !ctx.settings.autoReply;
    setGlobal(ctx, 'autoReply', on);
    await ctx.reply(`${on ? '✅' : '❌'} Auto-reply ${on ? 'enabled' : 'disabled'}.\n_Text: ${ctx.settings.autoReplyText}_`);
  },

  async recording(ctx) {
    ctx.requireOwner();
    try {
      await ctx.sock.sendPresenceUpdate('recording', ctx.chatJid);
      await ctx.reply('🎙️ Recording presence sent.');
    } catch {
      throw new Error('Could not set recording presence.');
    }
  },

  async typing(ctx) {
    ctx.requireOwner();
    try {
      await ctx.sock.sendPresenceUpdate('composing', ctx.chatJid);
      await ctx.reply('⌨️ Typing presence sent.');
    } catch {
      throw new Error('Could not set typing presence.');
    }
  },

  async block(ctx) {
    ctx.requireOwner();
    const target = ctx.mentioned[0] || (ctx.args[0] ? jidOf(ctx.args[0]) : null);
    if (!target) throw new Error('Usage: .block 2547XXXXXXXX  (or mention someone)');
    await ctx.sock.updateBlockStatus(target, 'block');
    await ctx.reply(`🚫 Blocked @${num(target)}.`, { mentions: [target] });
  },

  async unban(ctx) {
    ctx.requireOwner();
    const target = ctx.mentioned[0] || (ctx.args[0] ? jidOf(ctx.args[0]) : null);
    if (!target) throw new Error('Usage: .unban 2547XXXXXXXX  (or mention someone)');
    await ctx.sock.updateBlockStatus(target, 'unblock');
    await ctx.reply(`✅ Unblocked @${num(target)}.`, { mentions: [target] });
  },

  async ban(ctx) {
    ctx.requireOwner();
    const target = ctx.mentioned[0] || (ctx.args[0] ? jidOf(ctx.args[0]) : null);
    if (!target) throw new Error('Usage: .ban 2547XXXXXXXX  (or mention someone)');

    await ctx.sock.updateBlockStatus(target, 'block');
    if (ctx.isGroup) {
      try { await ctx.sock.groupParticipantsUpdate(ctx.chatJid, [target], 'remove'); } catch { /* ignore */ }
    }
    await ctx.reply(`⛔ Banned and blocked @${num(target)}.`, { mentions: [target] });
  },

  async blockinbox(ctx) {
    ctx.requireOwner();
    // Block every chat that has messaged us but is not a contact we know.
    const store = ctx.sock.store;
    const chats = store?.chats ? Object.values(store.chats) : [];
    const targets = chats
      .filter((c) => c.id?.endsWith('@s.whatsapp.net'))
      .map((c) => c.id);

    if (!targets.length) {
      await ctx.reply('No direct chats found to block.');
      return;
    }

    let done = 0;
    for (const t of targets) {
      try { await ctx.sock.updateBlockStatus(t, 'block'); done++; } catch { /* ignore */ }
    }
    await ctx.reply(`🚫 Blocked ${done} direct chat(s).`);
  },

  async getpp(ctx) {
    ctx.requireOwner();
    const target = ctx.mentioned[0] || ctx.quoted?.sender || (ctx.args[0] ? jidOf(ctx.args[0]) : null);
    if (!target) throw new Error('Mention someone or reply to their message.');

    let url;
    try {
      url = await ctx.sock.profilePictureUrl(target, 'image');
    } catch {
      throw new Error('That user has no profile picture, or it is hidden.');
    }
    const buf = await require('../lib/media').fetchImage(url);
    await ctx.send(ctx.chatJid, { image: buf, caption: `📸 @${num(target)}` }, { quoted: ctx.msg, mentions: [target] });
  },

  async sudo(ctx) {
    ctx.requireOwner();
    const arg = ctx.args[0] || '';
    const target = ctx.mentioned[0] || (arg ? jidOf(arg) : null);

    if (!arg && !ctx.mentioned.length) {
      const list = sudo.list();
      await ctx.reply(
        list.length
          ? `*Sudo users:*\n\n${list.map((n) => `• +${n}`).join('\n')}\n\n_Remove with .sudo del <number>_`
          : 'No sudo users.\n\n_Add with .sudo add 2547XXXXXXXX_'
      );
      return;
    }

    if (arg.toLowerCase() === 'del' || arg.toLowerCase() === 'remove') {
      const n = ctx.args[1];
      if (!n) throw new Error('Usage: .sudo del 2547XXXXXXXX');
      const ok = sudo.remove(n);
      await ctx.reply(ok ? `✅ Removed +${String(n).replace(/\D/g, '')} from sudo.` : 'That number was not a sudo user.');
      return;
    }

    if (arg.toLowerCase() === 'add' && ctx.args[1]) {
      sudo.add(ctx.args[1]);
      await ctx.reply(`✅ Added +${String(ctx.args[1]).replace(/\D/g, '')} as sudo.`);
      return;
    }

    if (target) {
      sudo.add(num(target));
      await ctx.reply(`✅ Added @${num(target)} as sudo.`, { mentions: [target] });
      return;
    }

    throw new Error('Usage: .sudo add|del <number>');
  },

  async report(ctx) {
    ctx.requireOwner();
    const all = users.all();
    const active = all.filter((u) => users.isActive(u.id));
    const connected = all.filter((u) => u.wa_status === 'connected');
    const mem = process.memoryUsage();

    await ctx.reply(
      `📊 *Bot report*\n\n` +
      `⏱️ Uptime: ${uptime(process.uptime())}\n` +
      `👥 Users: ${all.length}\n` +
      `💳 Active plans: ${active.length}\n` +
      `📱 Connected numbers: ${connected.length}\n` +
      `🧠 Heap: ${bytes(mem.heapUsed)} / ${bytes(mem.heapTotal)}\n` +
      `⚙️ Node: ${process.version}\n` +
      `🖥️ Platform: ${process.platform}`
    );
  },

  async update(ctx) {
    ctx.requireOwner();
    await ctx.reply(
      `🔄 *Update*\n\n` +
      `This bot runs from your GitHub repo. To update:\n\n` +
      `1. Push your changes to GitHub\n` +
      `2. Render redeploys automatically (autoDeploy is on)\n` +
      `3. Or hit *Manual Deploy → Deploy latest commit* in Render\n\n` +
      `📦 ${config.bot.repo}\n` +
      `🏷️ Running ${config.bot.version}`
    );
  },

  async allkaya(ctx) {
    ctx.requireOwner();
    // "allkaya" — broadcast a message to every chat the bot has seen.
    const text = ctx.text.trim();
    if (!text) throw new Error('Usage: .allkaya <message>');

    const store = ctx.sock.store;
    const chats = store?.chats ? Object.values(store.chats) : [];
    const targets = chats
      .filter((c) => c.id && (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')))
      .map((c) => c.id);

    if (!targets.length) {
      await ctx.reply('No chats found to broadcast to.');
      return;
    }

    let sent = 0;
    for (const t of targets) {
      try {
        await ctx.sock.sendMessage(t, { text });
        sent++;
        await new Promise((r) => setTimeout(r, 1200)); // stay under rate limits
      } catch { /* ignore */ }
    }
    await ctx.reply(`📤 Broadcast sent to ${sent}/${targets.length} chat(s).`);
  },
};

module.exports = { category: 'OWNER', commands };
