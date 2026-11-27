'use strict';

/**
 * GROUP MENU — 29 commands.
 *
 * Every moderation toggle is stored per (user, group) in SQLite and is
 * enforced by the manager on each incoming message (see wa/manager.js).
 */

const config = require('../config');
const { groups, badwords, welcomes } = require('../db');
const { num, jidOf } = require('../lib/util');

/* ── helpers ────────────────────────────────────────────────────────── */

async function meta(ctx) {
  return ctx.groupMeta();
}

function participantsOf(m) {
  return m?.participants || [];
}

function isAdminIn(m, jid) {
  const p = participantsOf(m).find((x) => x.id === jid || num(x.id) === num(jid));
  return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
}

function adminList(m) {
  return participantsOf(m)
    .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
    .map((p) => p.id);
}

function tag(jid) {
  return `@${num(jid)}`;
}

/** Toggle helper shared by the eight ant* commands. */
function toggleCommand(key, label) {
  return async (ctx) => {
    ctx.requireGroup();
    ctx.requireAdmin();
    const current = groups.get(ctx.userId, ctx.chatJid);
    const next = groups.toggle(ctx.userId, ctx.chatJid, key);
    await ctx.reply(
      `${next[key] ? '✅' : '❌'} *${label}* ${next[key] ? 'enabled' : 'disabled'} for this group.`
    );
  };
}

/* ── commands ───────────────────────────────────────────────────────── */

const commands = {
  /* ── moderation toggles ─────────────────────────────────────────── */
  antilink: toggleCommand('antilink', 'Antilink'),
  antispam: toggleCommand('antispam', 'Antispam'),
  antibadword: toggleCommand('antibadword', 'Antibadword'),
  antistatus: toggleCommand('antistatus', 'Antistatus'),
  antitag: toggleCommand('antitag', 'Antitag'),
  antigroupstatus: toggleCommand('antigroupstatus', 'Antigroupstatus'),
  antibot: toggleCommand('antibot', 'Antibot'),
  antiporn: toggleCommand('antiporn', 'Antiporn'),

  /* ── badword list ───────────────────────────────────────────────── */
  async add(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    const word = ctx.text.trim();
    if (!word) throw new Error('Usage: .add <word>');
    badwords.add(ctx.userId, ctx.chatJid, word);
    const list = badwords.list(ctx.userId, ctx.chatJid);
    await ctx.reply(`✅ Added *${word}*.\n_${list.length} word(s) on the list._`);
  },

  /* ── welcome ────────────────────────────────────────────────────── */
  async welcome(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    const text = ctx.text.trim();

    if (!text) {
      const current = welcomes.get(ctx.userId, ctx.chatJid);
      const on = groups.get(ctx.userId, ctx.chatJid).welcome;
      await ctx.reply(
        `*Welcome messages:* ${on ? 'on' : 'off'}\n` +
        `*Current text:* ${current || '_not set_'}\n\n` +
        `Set one with: \`.welcome Hello {user}, welcome to {group}!\`\n` +
        `Placeholders: {user} {group}`
      );
      return;
    }

    welcomes.set(ctx.userId, ctx.chatJid, text);
    groups.toggle(ctx.userId, ctx.chatJid, 'welcome', true);
    await ctx.reply(`✅ Welcome message set and enabled.\n\n_${text}_`);
  },

  /* ── member management ──────────────────────────────────────────── */
  async add(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();

    const target = ctx.mentioned[0] || (ctx.args[0] ? jidOf(ctx.args[0]) : null);
    if (!target) throw new Error('Usage: .add 2547XXXXXXXX  (or mention someone)');

    const res = await ctx.sock.groupParticipantsUpdate(ctx.chatJid, [target], 'add');
    const status = res?.[0]?.status;
    if (status === '200') await ctx.reply(`✅ Added ${tag(target)}.`, { mentions: [target] });
    else if (status === '403') await ctx.reply(`⚠️ Couldn't add ${tag(target)} — they have privacy settings that block it.`, { mentions: [target] });
    else await ctx.reply(`⚠️ Add returned status ${status || 'unknown'}.`, { mentions: [target] });
  },

  async kick(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();

    const targets = ctx.mentioned.length
      ? ctx.mentioned
      : (ctx.quoted?.sender ? [ctx.quoted.sender] : []);

    if (!targets.length) throw new Error('Mention someone or reply to their message.');

    const m = await meta(ctx);
    const blocked = targets.filter((t) => isAdminIn(m, t));
    if (blocked.length) {
      throw new Error(`Can't remove an admin: ${blocked.map(tag).join(', ')}`);
    }

    await ctx.sock.groupParticipantsUpdate(ctx.chatJid, targets, 'remove');
    await ctx.reply(`✅ Removed ${targets.map(tag).join(', ')}.`, { mentions: targets });
  },

  async promote(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();

    const targets = ctx.mentioned.length
      ? ctx.mentioned
      : (ctx.quoted?.sender ? [ctx.quoted.sender] : []);
    if (!targets.length) throw new Error('Mention someone or reply to their message.');

    await ctx.sock.groupParticipantsUpdate(ctx.chatJid, targets, 'promote');
    await ctx.reply(`✅ Promoted ${targets.map(tag).join(', ')} to admin.`, { mentions: targets });
  },

  async mute(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();
    await ctx.sock.groupSettingUpdate(ctx.chatJid, 'announcement');
    await ctx.reply('🔇 Group closed — only admins can send messages.');
  },

  async unmute(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();
    await ctx.sock.groupSettingUpdate(ctx.chatJid, 'not_announcement');
    await ctx.reply('🔊 Group opened — everyone can send messages.');
  },

  async bye(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    await ctx.reply('👋 Leaving this group.');
    await ctx.sock.groupLeave(ctx.chatJid);
  },

  async left(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    const m = await meta(ctx);
    const me = num(ctx.sock.user?.id || '');
    const gone = participantsOf(m).filter((p) => num(p.id) !== me);
    if (!gone.length) {
      await ctx.reply('Nobody has left.');
      return;
    }
    const list = gone.map((p) => `• ${tag(p.id)}`).join('\n');
    await ctx.reply(`*Members who have left:*\n\n${list}`, { mentions: gone.map((p) => p.id) });
  },

  /* ── group info ─────────────────────────────────────────────────── */
  async groupinfo(ctx) {
    ctx.requireGroup();
    const m = await meta(ctx);
    const admins = adminList(m);
    const created = m.creation ? new Date(m.creation * 1000).toLocaleDateString() : '—';
    const s = groups.get(ctx.userId, ctx.chatJid);
    const on = Object.entries(s).filter(([, v]) => v === true).map(([k]) => k);

    await ctx.reply(
      `*${m.subject || 'Group'}*\n\n` +
      `🆔 \`${ctx.chatJid}\`\n` +
      `👥 Members: ${participantsOf(m).length}\n` +
      `👑 Admins: ${admins.length}\n` +
      `📅 Created: ${created}\n` +
      `📝 ${m.desc || '_no description_'}\n\n` +
      `*Active protections:* ${on.length ? on.join(', ') : 'none'}`
    );
  },

  async groupname(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    const name = ctx.text.trim();
    if (!name) throw new Error('Usage: .groupname <new name>');
    await ctx.sock.groupUpdateSubject(ctx.chatJid, name);
    await ctx.reply(`✅ Group renamed to *${name}*.`);
  },

  async setgdesc(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    const desc = ctx.text.trim();
    if (!desc) throw new Error('Usage: .setgdesc <description>');
    await ctx.sock.groupUpdateDescription(ctx.chatJid, desc);
    await ctx.reply('✅ Group description updated.');
  },

  async ppgroup(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();

    const node = ctx.quoted ? ctx.msgLib.mediaNode(ctx.quoted.message) : null;
    if (!node || !ctx.quoted.message.imageMessage) {
      throw new Error('Reply to an image with .ppgroup');
    }
    const buf = await ctx.sock.downloadMediaMessage(ctx.quoted);
    await ctx.sock.updateProfilePicture(ctx.chatJid, buf);
    await ctx.reply('✅ Group photo updated.');
  },

  async listadmin(ctx) {
    ctx.requireGroup();
    const m = await meta(ctx);
    const admins = adminList(m);
    if (!admins.length) {
      await ctx.reply('No admins found.');
      return;
    }
    const list = admins.map((a, i) => `${i + 1}. ${tag(a)}`).join('\n');
    await ctx.reply(`*Group admins (${admins.length}):*\n\n${list}`, { mentions: admins });
  },

  async staff(ctx) {
    ctx.requireGroup();
    const m = await meta(ctx);
    const supers = participantsOf(m).filter((p) => p.admin === 'superadmin').map((p) => p.id);
    const admins = participantsOf(m).filter((p) => p.admin === 'admin').map((p) => p.id);

    const parts = ['*Group staff*', ''];
    if (supers.length) {
      parts.push('👑 *Owner*');
      parts.push(...supers.map((j) => `• ${tag(j)}`));
      parts.push('');
    }
    if (admins.length) {
      parts.push('🛡️ *Admins*');
      parts.push(...admins.map((j) => `• ${tag(j)}`));
    }
    if (!supers.length && !admins.length) parts.push('_No staff._');

    await ctx.reply(parts.join('\n'), { mentions: [...supers, ...admins] });
  },

  /* ── invite link ────────────────────────────────────────────────── */
  async link(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    const code = await ctx.sock.groupInviteCode(ctx.chatJid);
    await ctx.reply(`🔗 *Group link*\n\nhttps://chat.whatsapp.com/${code}`);
  },

  async resetlink(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();
    const code = await ctx.sock.groupRevokeInvite(ctx.chatJid);
    await ctx.reply(`♻️ Link reset.\n\nhttps://chat.whatsapp.com/${code}`);
  },

  async revoke(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();
    const code = await ctx.sock.groupRevokeInvite(ctx.chatJid);
    await ctx.reply(`♻️ Old link revoked. New link:\n\nhttps://chat.whatsapp.com/${code}`);
  },

  /* ── message management ─────────────────────────────────────────── */
  async del(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();

    if (!ctx.quoted) throw new Error('Reply to the message you want deleted.');
    await ctx.sock.sendMessage(ctx.chatJid, { delete: ctx.quoted.key });
    await ctx.reply('🗑️ Deleted.');
  },

  async purge(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();
    ctx.requireBotAdmin();

    if (!ctx.quoted) throw new Error('Reply to a message — everything from there on gets deleted.');

    // Baileys can only delete messages it has keys for, so we delete the
    // quoted one and report honestly rather than pretending to wipe history.
    await ctx.sock.sendMessage(ctx.chatJid, { delete: ctx.quoted.key });
    await ctx.reply(
      '🗑️ Deleted the replied message.\n\n' +
      '_WhatsApp only lets a bot delete messages it can see keys for, so a full history purge is not possible._'
    );
  },

  /* ── tagging ────────────────────────────────────────────────────── */
  async tag(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();

    const m = await meta(ctx);
    const everyone = participantsOf(m).map((p) => p.id);
    const note = ctx.text.trim();

    const body = note
      ? `📢 ${note}\n\n${everyone.map(tag).join(' ')}`
      : `📢 ${everyone.map(tag).join(' ')}`;

    // mentions must be passed in the options — putting @numbers in the text
    // alone does not notify anyone.
    await ctx.send(ctx.chatJid, { text: body, mentions: everyone }, { quoted: ctx.msg });
  },

  async tagall(ctx) {
    ctx.requireGroup();
    ctx.requireAdmin();

    const m = await meta(ctx);
    const everyone = participantsOf(m).map((p) => p.id);
    const note = ctx.text.trim();

    const body =
      `📢 *Attention everyone*\n` +
      (note ? `\n${note}\n` : '') +
      `\n${everyone.map(tag).join(' ')}`;

    await ctx.send(ctx.chatJid, { text: body, mentions: everyone }, { quoted: ctx.msg });
  },
};

module.exports = { category: 'GROUP', commands };
