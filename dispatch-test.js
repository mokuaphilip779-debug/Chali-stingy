'use strict';

/**
 * Dispatch test. Drives the real command layer with a fake Baileys socket so
 * we can prove commands execute and reply, not just that they are registered.
 *
 * Run: node scripts/dispatch-test.js
 */

process.env.DB_PATH = './data/dispatch.db';
process.env.SESSIONS_DIR = './data/dispatch-sessions';

const fs = require('fs');
for (const p of [process.env.DB_PATH, `${process.env.DB_PATH}-wal`, `${process.env.DB_PATH}-shm`]) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

const db = require('../src/db');
const commands = require('../src/commands');
const config = require('../src/config');

let failures = 0;
const fail = (m) => { console.log(`  ✗ ${m}`); failures++; };
const pass = (m) => console.log(`  ✓ ${m}`);

/* ── fake socket ────────────────────────────────────────────────────── */

function makeSock({ botIsAdmin = true } = {}) {
  const sent = [];
  const sock = {
    sent,
    user: { id: '254700000000@s.whatsapp.net' },
    sendMessage: async (jid, content, opts) => {
      sent.push({ jid, content, opts });
      return { key: { id: `sent_${sent.length}` } };
    },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    groupMetadata: async (jid) => ({
      id: jid,
      subject: 'Test Group',
      desc: 'A group for testing',
      creation: 1700000000,
      participants: [
        { id: '254711111111@s.whatsapp.net', admin: 'superadmin' },
        { id: '254722222222@s.whatsapp.net', admin: 'admin' },
        { id: '254733333333@s.whatsapp.net', admin: null },
        { id: '254700000000@s.whatsapp.net', admin: botIsAdmin ? 'admin' : null },
      ],
    }),
    groupParticipantsUpdate: async (jid, targets, action) => {
      sent.push({ jid, content: { __action: action, targets } });
      return targets.map((t) => ({ status: '200', jid: t }));
    },
    groupSettingUpdate: async (jid, setting) => {
      sent.push({ jid, content: { __setting: setting } });
    },
    groupUpdateSubject: async (jid, name) => {
      sent.push({ jid, content: { __subject: name } });
    },
    groupUpdateDescription: async (jid, desc) => {
      sent.push({ jid, content: { __desc: desc } });
    },
    groupInviteCode: async () => 'TESTINVITECODE123',
    groupRevokeInvite: async () => 'NEWINVITECODE456',
    groupLeave: async (jid) => { sent.push({ jid, content: { __left: true } }); },
    updateBlockStatus: async (jid, action) => {
      sent.push({ jid, content: { __block: action } });
    },
    updateProfilePicture: async () => {},
    downloadMediaMessage: async () => Buffer.from('fake'),
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    requestPairingCode: async () => 'ABCD-1234',
    store: { chats: {} },
  };
  return sock;
}

/** Build a ctx the way the manager does, then dispatch. */
async function run({ text, isGroup = false, sender = '254711111111', fromMe = false, botIsAdmin = true }) {
  const sock = makeSock({ botIsAdmin });
  const chatJid = isGroup ? '120363000000000000@g.us' : `${sender}@s.whatsapp.net`;

  const user = db.users.create({ email: `u${Date.now()}${Math.random()}@x.com`, password: 'password123' });
  db.users.extendPlan(user.id, 30);

  const msg = {
    key: {
      remoteJid: chatJid,
      fromMe,
      id: `msg_${Date.now()}`,
      participant: isGroup ? `${sender}@s.whatsapp.net` : undefined,
    },
    message: { conversation: text },
  };

  // Real WhatsApp puts mentions in contextInfo, not in the text. Mirror that
  // so the harness exercises the same path the bot does.
  const mentioned = [...text.matchAll(/@(\d{6,})/g)].map((m) => `${m[1]}@s.whatsapp.net`);
  if (mentioned.length) {
    msg.message = {
      extendedTextMessage: {
        text,
        contextInfo: { mentionedJid: mentioned },
      },
    };
  }

  const settings = { ...config.defaults, prefix: '.' };

  const ran = await commands.dispatch({
    sock,
    msg,
    userId: user.id,
    settings,
    groupSettings: isGroup ? db.groups.get(user.id, chatJid) : null,
    groupMeta: () => sock.groupMetadata(chatJid),
    isGroupAdmin: async (jid) => {
      const meta = await sock.groupMetadata(chatJid);
      const p = meta.participants.find((x) => x.id === jid);
      return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
    },
    botIsAdmin: async () => botIsAdmin,
  });

  return { ran, sock, user, chatJid, sent: sock.sent };
}

const lastText = (sent) => {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].content?.text) return sent[i].content.text;
  }
  return '';
};

(async () => {
  console.log('\n── Dispatch: basic ───────────────────────────────────────');

  let r = await run({ text: '.menu' });
  if (r.ran) pass('.menu dispatched');
  else fail('.menu did not dispatch');

  const menu = lastText(r.sent);
  if (menu.includes('OWNER: Philo')) pass('menu shows OWNER');
  else fail('menu missing OWNER');
  if (menu.includes('PREFIX: .')) pass('menu shows PREFIX');
  else fail('menu missing PREFIX');
  if (!/CMDS|VERSION/.test(menu)) pass('menu header has no CMDS/VERSION');
  else fail('menu header still has CMDS/VERSION');
  if (menu.includes('GROUP MENU') && menu.includes('MAKER MENU')) pass('menu has all sections');
  else fail('menu missing sections');

  r = await run({ text: '.ping' });
  if (lastText(r.sent).includes('Pong')) pass('.ping replies Pong');
  else fail('.ping did not reply');

  r = await run({ text: '.alive' });
  if (lastText(r.sent).includes('alive')) pass('.alive replies');
  else fail('.alive did not reply');

  r = await run({ text: '.owner' });
  if (lastText(r.sent).includes('mokuaphilip779@gmail.com')) pass('.owner shows owner email');
  else fail('.owner missing email');

  r = await run({ text: '.fact' });
  if (lastText(r.sent).length > 20) pass('.fact returns content');
  else fail('.fact returned nothing');

  r = await run({ text: '.quote' });
  if (lastText(r.sent).includes('—')) pass('.quote returns a quote');
  else fail('.quote returned nothing');

  r = await run({ text: '.fancy bold Hello' });
  if (lastText(r.sent).includes('𝐇𝐞𝐥𝐥𝐨')) pass('.fancy renders bold');
  else fail(`.fancy produced: ${lastText(r.sent).slice(0, 60)}`);

  r = await run({ text: '.textmaker script Hi' });
  const tm = r.sent.find((s) => s.content?.image);
  if (tm && tm.content.image.length > 1000) pass('.textmaker renders a real PNG');
  else fail('.textmaker produced no image');

  console.log('\n── Dispatch: group admin gates ───────────────────────────');

  // Non-admin tries .kick → must be refused
  r = await run({ text: '.kick', isGroup: true, sender: '254733333333' });
  if (lastText(r.sent).includes('admin')) pass('non-admin .kick refused');
  else fail(`non-admin .kick was not refused: ${lastText(r.sent)}`);

  // Admin tries .kick with no target → usage error
  r = await run({ text: '.kick', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes('Mention')) pass('admin .kick asks for a target');
  else fail(`admin .kick: ${lastText(r.sent)}`);

  // Admin kicks someone
  r = await run({ text: '.kick @254733333333', isGroup: true, sender: '254711111111' });
  const kicked = r.sent.find((s) => s.content?.__action === 'remove');
  if (kicked) pass('admin .kick removes the target');
  else fail('admin .kick did not call groupParticipantsUpdate');

  // Admin tries to kick another admin → refused
  r = await run({ text: '.kick @254722222222', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes("Can't remove an admin")) pass('kicking an admin is blocked');
  else fail(`kicking an admin: ${lastText(r.sent)}`);

  // Bot not admin → .kick refused
  r = await run({ text: '.kick @254733333333', isGroup: true, sender: '254711111111', botIsAdmin: false });
  if (lastText(r.sent).includes('Make me a group admin')) pass('bot-not-admin .kick refused');
  else fail(`bot-not-admin .kick: ${lastText(r.sent)}`);

  // .promote
  r = await run({ text: '.promote @254733333333', isGroup: true, sender: '254711111111' });
  if (r.sent.find((s) => s.content?.__action === 'promote')) pass('.promote promotes');
  else fail('.promote did not promote');

  // .mute / .unmute
  r = await run({ text: '.mute', isGroup: true, sender: '254711111111' });
  if (r.sent.find((s) => s.content?.__setting === 'announcement')) pass('.mute closes the group');
  else fail('.mute did not close');

  r = await run({ text: '.unmute', isGroup: true, sender: '254711111111' });
  if (r.sent.find((s) => s.content?.__setting === 'not_announcement')) pass('.unmute opens the group');
  else fail('.unmute did not open');

  // .link
  r = await run({ text: '.link', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes('TESTINVITECODE123')) pass('.link returns the invite code');
  else fail('.link did not return a code');

  // .groupinfo
  r = await run({ text: '.groupinfo', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes('Test Group')) pass('.groupinfo shows the subject');
  else fail('.groupinfo did not show subject');

  // .tagall
  r = await run({ text: '.tagall hello', isGroup: true, sender: '254711111111' });
  const tagMsg = r.sent.find((s) => s.content?.mentions?.length >= 4);
  if (tagMsg) pass('.tagall mentions everyone');
  else fail('.tagall did not mention members');

  // .listadmin
  r = await run({ text: '.listadmin', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes('Group admins')) pass('.listadmin lists admins');
  else fail('.listadmin failed');

  // Group-only command in a DM → refused
  r = await run({ text: '.kick @254733333333', isGroup: false, sender: '254711111111' });
  if (lastText(r.sent).includes('only works in a group')) pass('group-only command refused in DM');
  else fail(`group-only in DM: ${lastText(r.sent)}`);

  console.log('\n── Dispatch: moderation toggles ──────────────────────────');

  for (const cmd of ['antilink', 'antispam', 'antibadword', 'antistatus', 'antitag',
                     'antigroupstatus', 'antibot', 'antiporn']) {
    r = await run({ text: `.${cmd}`, isGroup: true, sender: '254711111111' });
    const on = lastText(r.sent).includes('enabled');
    if (on) pass(`.${cmd} toggles on`);
    else fail(`.${cmd} did not toggle: ${lastText(r.sent)}`);
  }

  // Verify it persisted
  r = await run({ text: '.antilink', isGroup: true, sender: '254711111111' });
  const gs = db.groups.get(r.user.id, r.chatJid);
  if (gs.antilink === true) pass('antilink persisted to the database');
  else fail('antilink did not persist');

  // .add badword
  r = await run({ text: '.add stupidword', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes('Added')) pass('.add stores a badword');
  else fail(`.add: ${lastText(r.sent)}`);

  // .welcome
  r = await run({ text: '.welcome Hi {user}, welcome to {group}', isGroup: true, sender: '254711111111' });
  if (lastText(r.sent).includes('Welcome message set')) pass('.welcome sets a message');
  else fail(`.welcome: ${lastText(r.sent)}`);

  console.log('\n── Dispatch: owner gates ─────────────────────────────────');

  // Non-owner tries an owner command
  r = await run({ text: '.report', sender: '254733333333' });
  if (lastText(r.sent).includes('Owner only')) pass('non-owner .report refused');
  else fail(`non-owner .report: ${lastText(r.sent)}`);

  // Owner runs it
  r = await run({ text: '.report', sender: '254115417774' });
  if (lastText(r.sent).includes('Bot report')) pass('owner .report works');
  else fail(`owner .report: ${lastText(r.sent)}`);

  // Owner .sudo add
  r = await run({ text: '.sudo add 254799999999', sender: '254115417774' });
  if (lastText(r.sent).includes('sudo')) pass('.sudo add works');
  else fail(`.sudo add: ${lastText(r.sent)}`);

  // Sudo user can then run owner commands
  r = await run({ text: '.report', sender: '254799999999' });
  if (lastText(r.sent).includes('Bot report')) pass('sudo user can run owner commands');
  else fail(`sudo user .report: ${lastText(r.sent)}`);

  // .autoreactch
  r = await run({ text: '.autoreactch 🔥', sender: '254115417774' });
  if (lastText(r.sent).includes('🔥')) pass('.autoreactch sets the emoji');
  else fail(`.autoreactch: ${lastText(r.sent)}`);

  // .prefix
  r = await run({ text: '.prefix !', sender: '254711111111' });
  if (lastText(r.sent).includes('Prefix changed')) pass('.prefix changes the prefix');
  else fail(`.prefix: ${lastText(r.sent)}`);

  // .lang
  r = await run({ text: '.lang sw', sender: '254711111111' });
  if (lastText(r.sent).includes('Kiswahili')) pass('.lang sets a language');
  else fail(`.lang: ${lastText(r.sent)}`);

  // .speed
  r = await run({ text: '.speed', sender: '254711111111' });
  if (lastText(r.sent).includes('Commands loaded: 112')) pass('.speed reports 112 commands');
  else fail(`.speed: ${lastText(r.sent).slice(0, 80)}`);

  console.log('\n── Dispatch: AI commands fail cleanly without a key ──────');

  // No GEMINI_API_KEY in this environment → must give a clear message, not crash
  r = await run({ text: '.ai what is 2+2', sender: '254711111111' });
  const aiMsg = lastText(r.sent);
  if (aiMsg.includes('GEMINI_API_KEY') || aiMsg.includes('OPENAI_API_KEY')) {
    pass('.ai reports the missing key clearly');
  } else {
    fail(`.ai did not report a missing key: ${aiMsg.slice(0, 100)}`);
  }

  r = await run({ text: '.imagine a cat', sender: '254711111111' });
  if (lastText(r.sent).includes('API_KEY')) pass('.imagine reports the missing key');
  else fail(`.imagine: ${lastText(r.sent).slice(0, 100)}`);

  console.log('\n── Dispatch: unknown command ─────────────────────────────');

  r = await run({ text: '.notacommand' });
  if (!r.ran) pass('unknown command is ignored (no reply)');
  else fail('unknown command produced a reply');

  r = await run({ text: 'hello there' });
  if (!r.ran) pass('plain text is ignored');
  else fail('plain text triggered a command');

  console.log('\n──────────────────────────────────────────────────────────');
  if (failures === 0) {
    console.log('  ✅ All dispatch checks passed\n');
    process.exit(0);
  } else {
    console.log(`  ❌ ${failures} dispatch check(s) failed\n`);
    process.exit(1);
  }
})();
