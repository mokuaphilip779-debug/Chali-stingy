'use strict';

const axios = require('axios');
const config = require('../config');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** GET with a browser UA and a sane timeout. Returns the axios response. */
async function get(url, opts = {}) {
  return axios.get(url, {
    timeout: opts.timeout || 20000,
    maxRedirects: 5,
    responseType: opts.responseType || 'json',
    headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
    ...(opts.params ? { params: opts.params } : {}),
    ...(opts.data ? { data: opts.data } : {}),
  });
}

async function post(url, data, opts = {}) {
  return axios.post(url, data, {
    timeout: opts.timeout || 30000,
    responseType: opts.responseType || 'json',
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
  });
}

/** Download a URL into a Buffer, refusing anything over the size cap. */
async function download(url, maxMb = config.media.maxDownloadMb) {
  const res = await axios.get(url, {
    timeout: 60000,
    responseType: 'arraybuffer',
    maxContentLength: maxMb * 1024 * 1024,
    maxBodyLength: maxMb * 1024 * 1024,
    headers: { 'User-Agent': UA, Accept: '*/*' },
  });
  return Buffer.from(res.data);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Deterministic 32-bit hash — used by .ship so the same pair always matches. */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Strip a JID down to its bare number. */
function num(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function jidOf(number) {
  return `${String(number).replace(/\D/g, '')}@s.whatsapp.net`;
}

/** Human-readable byte size. */
function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

/* ── fancy text ───────────────────────────────────────────────────────
 * Unicode "font" maps. Each style is a set of 26 uppercase + 26 lowercase
 * code points (or a single offset for the mathematical alphanumerics).
 * ─────────────────────────────────────────────────────────────────── */

const STYLES = {
  bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
  italic: { upper: 0x1d434, lower: 0x1d44e, digit: null },
  bolditalic: { upper: 0x1d468, lower: 0x1d482, digit: null },
  script: { upper: 0x1d49c, lower: 0x1d4b6, digit: null },
  boldscript: { upper: 0x1d4d0, lower: 0x1d4ea, digit: null },
  fraktur: { upper: 0x1d504, lower: 0x1d51e, digit: null },
  double: { upper: 0x1d538, lower: 0x1d552, digit: 0x1d7d8 },
  sans: { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
  fullwidth: { upper: 0xff21, lower: 0xff41, digit: 0xff10 },
  circled: { upper: 0x24b6, lower: 0x24d0, digit: 0x2460 },
  squared: { upper: 0x1f130, lower: 0x1f130, digit: null },
};

// Mathematical alphanumeric blocks have holes where letters were already
// encoded elsewhere (e.g. script ℬ, ℰ, ℱ, ℋ, ℐ, ℒ, ℳ, ℛ). Patch them.
const HOLES = {
  script: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ' },
  fraktur: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
  double: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
};

function fancy(text, styleName) {
  const style = STYLES[styleName];
  if (!style) return text;
  const holes = HOLES[styleName] || {};
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (ch >= 'A' && ch <= 'Z') {
      out += holes[ch] || String.fromCodePoint(style.upper + (code - 65));
    } else if (ch >= 'a' && ch <= 'z') {
      out += String.fromCodePoint(style.lower + (code - 97));
    } else if (ch >= '0' && ch <= '9' && style.digit) {
      out += String.fromCodePoint(style.digit + (code - 48));
    } else {
      out += ch;
    }
  }
  return out;
}

const FANCY_NAMES = Object.keys(STYLES);

/** Small-caps, a style Unicode has no block for. */
function smallCaps(text) {
  const map = {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
    k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ',
    u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
  };
  return String(text).toLowerCase().split('').map((c) => map[c] || c).join('');
}

/** Upside-down text. */
function flip(text) {
  const map = {
    a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ',
    k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ',
    u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
    A: '∀', B: '𐐒', C: 'Ɔ', D: 'ᗡ', E: 'Ǝ', F: 'Ⅎ', G: '⅁', H: 'H', I: 'I', J: 'ſ',
    K: 'ʞ', L: '˥', M: 'W', N: 'N', O: 'O', P: 'Ԁ', Q: 'Ό', R: 'ᴚ', S: 'S', T: '⊥',
    U: '∩', V: 'Λ', W: 'M', X: 'X', Y: '⅄', Z: 'Z',
    '.': '˙', ',': "'", '?': '¿', '!': '¡', "'": ',', '"': '„',
    '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
  };
  return String(text).split('').reverse().map((c) => map[c] || c).join('');
}

/** Zalgo — combining marks stacked on each base character. */
function zalgo(text, intensity = 3) {
  const marks = [
    '\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0305', '\u0306', '\u0307',
    '\u0308', '\u0309', '\u030a', '\u030b', '\u030c', '\u030d', '\u030e', '\u030f',
    '\u0310', '\u0311', '\u0312', '\u0313', '\u0314', '\u0315', '\u031a', '\u031b',
    '\u0323', '\u0324', '\u0325', '\u0326', '\u0327', '\u0328', '\u0329', '\u032a',
    '\u032b', '\u032c', '\u032d', '\u032e', '\u032f', '\u0330', '\u0331', '\u0332',
    '\u0333', '\u0339', '\u033a', '\u033b', '\u033c', '\u0345', '\u0347', '\u0348',
    '\u0349', '\u034a', '\u034b', '\u034c', '\u0350', '\u0351', '\u0352', '\u0357',
  ];
  return String(text).split('').map((ch) => {
    if (ch === ' ') return ch;
    let out = ch;
    for (let i = 0; i < intensity; i++) out += rand(marks);
    return out;
  }).join('');
}

/** Apply a named style, falling back to bold. */
function applyStyle(text, style) {
  const s = String(style || '').toLowerCase();
  if (s === 'smallcaps' || s === 'small') return smallCaps(text);
  if (s === 'flip' || s === 'reverse') return flip(text);
  if (s === 'zalgo' || s === 'glitch') return zalgo(text);
  if (STYLES[s]) return fancy(text, s);
  return fancy(text, 'bold');
}

module.exports = {
  get, post, download, esc, sleep, rand, randInt, hash32, num, jidOf, bytes, uptime,
  fancy, smallCaps, flip, zalgo, applyStyle, FANCY_NAMES, STYLES, UA,
};
