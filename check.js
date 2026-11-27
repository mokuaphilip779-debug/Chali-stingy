'use strict';

/**
 * Self-check. Run with: npm run check
 *
 * Verifies that every command in the spec is registered, that the menu
 * renders with the right header, and that the DB layer works. Exits non-zero
 * on any failure so it can gate a deploy.
 */

process.env.DB_PATH = process.env.DB_PATH || './data/check.db';
process.env.SESSIONS_DIR = process.env.SESSIONS_DIR || './data/check-sessions';

const fs = require('fs');
const path = require('path');

// Fresh DB each run.
for (const p of [process.env.DB_PATH, `${process.env.DB_PATH}-wal`, `${process.env.DB_PATH}-shm`]) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

const EXPECTED = {
  GROUP: ['add', 'antibadword', 'antibot', 'antigroupstatus', 'antilink', 'antiporn', 'antispam',
    'antistatus', 'antitag', 'bye', 'del', 'ppgroup', 'groupinfo', 'groupname', 'kick', 'left',
    'link', 'listadmin', 'mute', 'promote', 'purge', 'resetlink', 'revoke', 'setgdesc', 'staff',
    'tag', 'tagall', 'unmute', 'welcome'],
  FUN: ['blague', 'character', 'compliment', 'dare', 'fact', 'flirt', 'gif', 'goodnight', 'meme',
    'news', 'quote', 'roseday', 'ship', 'stupid', 'trivia', 'truth', 'valentine'],
  OWNER: ['allkaya', 'autoreact', 'autoreactch', 'autostatus', 'ban', 'block', 'blockinbox',
    'getpp', 'private', 'recording', 'report', 'sudo', 'typing', 'unban', 'update'],
  MEDIA: ['instagram', 'video', 'apk', 'capcut', 'facebook', 'img', 'mediafire', 'movie',
    'pinterest', 'wallpapers'],
  GENERAL: ['alive', 'antidelete', 'channelid', 'fancy', 'menu', 'owner', 'pair', 'ping', 'repo', 'voice'],
  SYSTEM: ['allprefix', 'botimage', 'botname', 'delprefix', 'lang', 'online', 'prefix', 'speed'],
  AI: ['tts', 'ai', 'chatbot', 'imagine', 'pixelart', 'gsticker', 'traduc'],
  TOOLS: ['attp', 'photo', 'sticker', 'tg', 'take', 'url', 'vv'],
  DOWNLOAD: ['lyrics', 'play', 'song', 'tiktok'],
  ADMIN: ['autochannel', 'ram', 'supportch'],
  ANIME: ['ppcp'],
  MAKER: ['textmaker'],
};

let failures = 0;
const fail = (msg) => { console.log(`  ✗ ${msg}`); failures++; };
const pass = (msg) => console.log(`  ✓ ${msg}`);

console.log('\n── Command registry ──────────────────────────────────────');

const commands = require('../src/commands');
const registered = new Set(commands.allCommandNames());
const byCat = commands.commandsByCategory();

let expectedTotal = 0;
for (const [cat, names] of Object.entries(EXPECTED)) {
  expectedTotal += names.length;
  const actual = byCat.get(cat) || [];
  const missing = names.filter((n) => !registered.has(n));
  const extra = actual.filter((n) => !names.includes(n));

  if (missing.length) fail(`${cat}: missing ${missing.join(', ')}`);
  else if (extra.length) fail(`${cat}: unexpected ${extra.join(', ')}`);
  else pass(`${cat} — ${names.length} commands`);
}

console.log(`\n  Total expected: ${expectedTotal}`);
console.log(`  Total registered: ${registered.size}`);
if (registered.size !== expectedTotal) {
  fail(`count mismatch: expected ${expectedTotal}, got ${registered.size}`);
} else {
  pass(`all ${expectedTotal} commands registered`);
}

console.log('\n── Menu rendering ────────────────────────────────────────');

const { buildMenu } = require('../src/commands/menu');
const menu = buildMenu({ ownerName: 'Philo', prefix: '.', botName: 'BUG BOT' });

if (menu.includes('OWNER: Philo')) pass('header shows OWNER');
else fail('header missing OWNER');

if (menu.includes('PREFIX: .')) pass('header shows PREFIX');
else fail('header missing PREFIX');

if (!/CMDS/i.test(menu)) pass('header has no CMDS line');
else fail('header still contains CMDS');

if (!/VERSION/i.test(menu)) pass('header has no VERSION line');
else fail('header still contains VERSION');

for (const cat of Object.keys(EXPECTED)) {
  if (menu.includes(`${cat} MENU`)) pass(`section: ${cat} MENU`);
  else fail(`section missing: ${cat} MENU`);
}

if (menu.includes('╭') && menu.includes('╰') && menu.includes('│')) pass('box-drawing characters present');
else fail('box-drawing characters missing');

console.log('\n── Database ──────────────────────────────────────────────');

const db = require('../src/db');

const u = db.users.create({ email: 'check@example.com', password: 'password123' });
if (u && u.id) pass('user created');
else fail('user creation failed');

if (db.verifyPassword('password123', u.password_hash)) pass('password verifies');
else fail('password verification failed');

if (!db.verifyPassword('wrong', u.password_hash)) pass('wrong password rejected');
else fail('wrong password accepted');

if (!db.users.isActive(u.id)) pass('new user is inactive (paywall holds)');
else fail('new user is active — paywall broken');

db.users.extendPlan(u.id, 30);
if (db.users.isActive(u.id)) pass('plan activates after payment');
else fail('plan did not activate');

// Group settings persist
const gid = '120363000000000000@g.us';
db.groups.toggle(u.id, gid, 'antilink');
if (db.groups.get(u.id, gid).antilink === true) pass('group toggle persists');
else fail('group toggle did not persist');

db.groups.toggle(u.id, gid, 'antilink');
if (db.groups.get(u.id, gid).antilink === false) pass('group toggle flips back');
else fail('group toggle did not flip');

// Badwords
db.badwords.add(u.id, gid, 'BadWord');
if (db.badwords.list(u.id, gid).includes('badword')) pass('badword stored lowercase');
else fail('badword not stored');

// Welcome
db.welcomes.set(u.id, gid, 'Hi {user}');
if (db.welcomes.get(u.id, gid) === 'Hi {user}') pass('welcome message stored');
else fail('welcome message not stored');

// Sudo
db.sudo.add(u.id, '254700000000');
if (db.sudo.has(u.id, '254700000000')) pass('sudo user added');
else fail('sudo user not added');

// Payments
const p = db.payments.create({ userId: u.id, provider: 'sendmoney', amount: 100, currency: 'KES' });
if (p.status === 'pending') pass('payment starts pending');
else fail('payment status wrong');

db.payments.markPaid(p.id, 'SLK7XQ2M9P');
if (db.payments.byId(p.id).status === 'paid') pass('payment marks paid');
else fail('payment did not mark paid');

if (db.payments.byProviderRef('SLK7XQ2M9P')) pass('payment findable by M-Pesa code');
else fail('payment not findable by code');

console.log('\n── Config ────────────────────────────────────────────────');

const config = require('../src/config');
if (config.plan.priceKes === 100) pass('plan price is KES 100');
else fail(`plan price is ${config.plan.priceKes}, expected 100`);

if (config.payment.sendMoney.display === '0115417774') pass('Send Money number is 0115417774');
else fail(`Send Money number is ${config.payment.sendMoney.display}`);

if (config.owner.email === 'mokuaphilip779@gmail.com') pass('owner email correct');
else fail(`owner email is ${config.owner.email}`);

if (config.owner.name === 'Philo') pass('owner name is Philo');
else fail(`owner name is ${config.owner.name}`);

console.log('\n── Utilities ─────────────────────────────────────────────');

const util = require('../src/lib/util');

const bold = util.applyStyle('Hello', 'bold');
// Mathematical bold letters are astral-plane, so each is 2 UTF-16 units.
if (bold !== 'Hello' && [...bold].length === 5) pass('fancy bold transforms');
else fail(`fancy bold produced "${bold}"`);

const flip = util.flip('abc');
if (flip === 'ɔqɐ') pass('flip reverses and maps');
else fail(`flip produced "${flip}"`);

if (util.num('254712345678@s.whatsapp.net') === '254712345678') pass('jid → number');
else fail('jid → number failed');

if (util.jidOf('+254 712 345 678') === '254712345678@s.whatsapp.net') pass('number → jid');
else fail('number → jid failed');

// .ship must be deterministic
const a = util.hash32('254700000001-254700000002');
const b = util.hash32('254700000001-254700000002');
if (a === b) pass('ship score is deterministic');
else fail('ship score is not deterministic');

console.log('\n── Message helpers ───────────────────────────────────────');

const msgLib = require('../src/lib/msg');

if (msgLib.extractText({ conversation: 'hi' }) === 'hi') pass('plain text extracted');
else fail('plain text extraction failed');

if (msgLib.extractText({ extendedTextMessage: { text: 'yo' } }) === 'yo') pass('extended text extracted');
else fail('extended text extraction failed');

if (msgLib.extractText({ imageMessage: { caption: 'pic' } }) === 'pic') pass('image caption extracted');
else fail('image caption extraction failed');

if (msgLib.extractText({ ephemeralMessage: { message: { conversation: 'wrapped' } } }) === 'wrapped') {
  pass('ephemeral wrapper unwrapped');
} else fail('ephemeral unwrap failed');

if (msgLib.mediaType({ imageMessage: {} }) === 'image') pass('media type detected');
else fail('media type detection failed');

if (msgLib.isRevoke({ message: null })) pass('revoke detected (null message)');
else fail('revoke detection failed');

console.log('\n── Server routes ─────────────────────────────────────────');

const app = require('../src/server');
const routes = [];
for (const layer of app._router?.stack || []) {
  if (layer.route) {
    routes.push(`${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  }
}

const needed = [
  'GET /', 'GET /register', 'POST /register', 'GET /login', 'POST /login',
  'GET /subscribe', 'POST /subscribe/sendmoney', 'GET /dashboard',
  'POST /wa/start', 'POST /wa/pair', 'GET /wa/state', 'GET /settings', 'POST /settings',
  'GET /deleted', 'POST /webhook/mpesa', 'POST /webhook/stripe', 'GET /admin',
  'POST /admin/approve', 'GET /health',
];

for (const r of needed) {
  if (routes.includes(r)) pass(r);
  else fail(`route missing: ${r}`);
}

console.log('\n──────────────────────────────────────────────────────────');
if (failures === 0) {
  console.log(`  ✅ All checks passed (${expectedTotal} commands, ${routes.length} routes)\n`);
  process.exit(0);
} else {
  console.log(`  ❌ ${failures} check(s) failed\n`);
  process.exit(1);
}
