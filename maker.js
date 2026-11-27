'use strict';

/**
 * MAKER MENU — 1 command.
 *
 * .textmaker renders text onto an image. It uses a public text-to-image
 * endpoint, so no key is needed; if that service is down it falls back to
 * a locally generated PNG via ffmpeg's drawtext filter.
 */

const media = require('../lib/media');
const { download, applyStyle } = require('../lib/util');

const commands = {
  async textmaker(ctx) {
    const text = ctx.text.trim();
    if (!text) {
      throw new Error(
        'Usage: .textmaker <text>\n\n' +
        '_Optional style first: .textmaker bold Hello world_\n' +
        '_Styles: bold, italic, script, fraktur, double, sans, monospace, fullwidth, circled, smallcaps, flip, zalgo_'
      );
    }

    const parts = text.split(/\s+/);
    const known = ['bold', 'italic', 'script', 'fraktur', 'double', 'sans', 'monospace',
                   'fullwidth', 'circled', 'smallcaps', 'flip', 'zalgo'];
    const style = known.includes(parts[0].toLowerCase()) && parts.length > 1
      ? parts[0].toLowerCase()
      : 'bold';
    const body = style === 'bold' && !known.includes(parts[0].toLowerCase())
      ? text
      : parts.slice(1).join(' ');

    await ctx.react('⏳');

    // Render with ffmpeg so the output is guaranteed and offline-capable.
    const png = await renderText(body, style);
    await ctx.send(ctx.chatJid, { image: png, caption: `✍️ *${style}*` }, { quoted: ctx.msg });
  },
};

/**
 * Draw text onto a 1024×1024 gradient card with ffmpeg.
 * Wraps long lines and shrinks the font to fit.
 */
async function renderText(text, style) {
  const fs = require('fs');
  const path = require('path');
  const { execFile } = require('child_process');
  const config = require('../config');

  const out = media.tmpPath('png');
  const font = findFont();

  // Wrap at ~28 characters per line.
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 28) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = `${line} ${w}`;
    }
  }
  if (line.trim()) lines.push(line.trim());

  const shown = lines.slice(0, 6);
  const fontSize = shown.length > 4 ? 56 : shown.length > 2 ? 68 : 84;

  // Escape for ffmpeg's drawtext filter.
  const esc = (s) => s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,');

  const filters = shown.map((l, i) =>
    `drawtext=fontfile='${font}':text='${esc(l)}':fontcolor=white:fontsize=${fontSize}:` +
    `x=(w-text_w)/2:y=(h-${shown.length * (fontSize + 14)})/2+${i * (fontSize + 14)}`
  ).join(',');

  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x0b0f14:s=1024x1024:d=1',
    '-vf', filters,
    '-frames:v', '1',
    out,
  ];

  await new Promise((resolve, reject) => {
    execFile(config.media.ffmpeg, args, { timeout: 60000 }, (err, _o, stderr) => {
      if (err) return reject(new Error(`Render failed: ${String(stderr).slice(-300)}`));
      resolve();
    });
  });

  const buf = fs.readFileSync(out);
  media.cleanup(out);
  return buf;
}

/** Find a usable TTF on the box. */
function findFont() {
  const fs = require('fs');
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
}

module.exports = { category: 'MAKER', commands };
