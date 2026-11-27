'use strict';

/**
 * TOOLS MENU — 8 commands. Each produces a real file or a real lookup.
 */

const media = require('../lib/media');
const { get, download, applyStyle, num } = require('../lib/util');

/** Grab the media node from the quoted message, or throw a helpful error. */
function needQuotedMedia(ctx, what = 'an image, video or sticker') {
  if (!ctx.quoted) throw new Error(`Reply to ${what} with this command.`);
  const node = ctx.msgLib.mediaNode(ctx.quoted.message);
  if (!node) throw new Error(`The message you replied to has no media. Reply to ${what}.`);
  return node;
}

const commands = {
  async sticker(ctx) {
    const node = needQuotedMedia(ctx, 'an image, video or sticker');
    const type = ctx.msgLib.mediaType(ctx.quoted.message);

    await ctx.react('⏳');
    const buf = await ctx.sock.downloadMediaMessage(ctx.quoted);

    let webp;
    if (type === 'image') {
      webp = await media.imageToSticker(buf);
    } else if (type === 'video') {
      webp = await media.videoToSticker(buf);
    } else if (type === 'sticker') {
      // Already a sticker — re-send as-is.
      await ctx.send(ctx.chatJid, { sticker: buf }, { quoted: ctx.msg });
      return;
    } else {
      throw new Error('That media type cannot be turned into a sticker.');
    }

    await ctx.send(ctx.chatJid, { sticker: webp }, { quoted: ctx.msg });
  },

  async take(ctx) {
    const node = needQuotedMedia(ctx, 'a sticker');
    const type = ctx.msgLib.mediaType(ctx.quoted.message);
    if (type !== 'sticker') throw new Error('Reply to a sticker with .take');

    const packname = ctx.text.trim() || 'WA Bot Suite';
    const buf = await ctx.sock.downloadMediaMessage(ctx.quoted);

    // Baileys accepts an exif blob for sticker metadata.
    const { Sticker } = require('@whiskeysockets/baileys');
    try {
      const sticker = new Sticker(buf, {
        pack: packname,
        author: 'WA Bot Suite',
        type: Sticker.Type.FULL,
      });
      const out = await sticker.toBuffer();
      await ctx.send(ctx.chatJid, { sticker: out }, { quoted: ctx.msg });
    } catch {
      // Metadata rewrite failed — send the original rather than nothing.
      await ctx.send(ctx.chatJid, { sticker: buf }, { quoted: ctx.msg });
    }
  },

  async attp(ctx) {
    const text = ctx.text.trim();
    if (!text) throw new Error('Usage: .attp <text>');

    await ctx.react('⏳');
    // Text-on-transparent-PNG service, no key needed.
    const url = `https://api.lolhuman.xyz/api/attp?apikey=&text=${encodeURIComponent(text)}`;
    let png;
    try {
      png = await download(url, 8);
    } catch {
      // Fallback: render the text as a plain image via a second service.
      png = await download(
        `https://dummyimage.com/512x512/000000/ffffff.png&text=${encodeURIComponent(text.slice(0, 40))}`,
        8
      );
    }

    const webp = await media.imageToSticker(png);
    await ctx.send(ctx.chatJid, { sticker: webp }, { quoted: ctx.msg });
  },

  async photo(ctx) {
    const node = needQuotedMedia(ctx, 'a sticker');
    const type = ctx.msgLib.mediaType(ctx.quoted.message);
    if (type !== 'sticker') throw new Error('Reply to a sticker with .photo');

    await ctx.react('⏳');
    const buf = await ctx.sock.downloadMediaMessage(ctx.quoted);
    const png = await media.stickerToImage(buf);
    await ctx.send(ctx.chatJid, { image: png, caption: '🖼️ Sticker → image' }, { quoted: ctx.msg });
  },

  async vv(ctx) {
    // View-once media: re-send it as a normal, saveable message.
    if (!ctx.quoted) throw new Error('Reply to a view-once message with .vv');

    const raw = ctx.quoted.message;
    const inner =
      raw?.viewOnceMessage?.message ||
      raw?.viewOnceMessageV2?.message ||
      raw?.viewOnceMessageV2Extension?.message;

    if (!inner) throw new Error('That message is not view-once.');

    const type = ctx.msgLib.mediaType(inner);
    if (!type) throw new Error('No media inside that view-once message.');

    await ctx.react('⏳');
    const buf = await ctx.sock.downloadMediaMessage({ key: ctx.quoted.key, message: inner });

    if (type === 'image') {
      await ctx.send(ctx.chatJid, { image: buf, caption: '👁️ View-once opened' }, { quoted: ctx.msg });
    } else if (type === 'video') {
      await ctx.send(ctx.chatJid, { video: buf, caption: '👁️ View-once opened', mimetype: 'video/mp4' }, { quoted: ctx.msg });
    } else if (type === 'audio') {
      await ctx.send(ctx.chatJid, { audio: buf, mimetype: 'audio/mpeg' }, { quoted: ctx.msg });
    } else {
      throw new Error(`Cannot re-send a ${type}.`);
    }
  },

  async url(ctx) {
    const link = ctx.text.trim();
    if (!/^https?:\/\//.test(link)) throw new Error('Usage: .url <https://link>');

    await ctx.react('⏳');
    const html = await media.fetchHtml(link);

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '—';
    const desc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      '—';
    const image =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;

    const caption =
      `🔗 *${title}*\n\n` +
      `${desc.slice(0, 400)}\n\n` +
      `${link}`;

    if (image) {
      try {
        const buf = await media.fetchImage(image);
        await ctx.send(ctx.chatJid, { image: buf, caption }, { quoted: ctx.msg });
        return;
      } catch { /* fall through to text */ }
    }
    await ctx.reply(caption);
  },

  async tg(ctx) {
    // Telegram sticker pack → WhatsApp stickers.
    const link = ctx.text.trim();
    if (!/t\.me\//.test(link)) {
      throw new Error('Usage: .tg https://t.me/addstickers/PackName');
    }

    const pack = link.split('/').pop().split('?')[0];
    if (!pack) throw new Error('Could not read the pack name from that link.');

    await ctx.react('⏳');

    // Telegram's public sticker set page lists the sticker files.
    const html = await media.fetchHtml(`https://t.me/addstickers/${pack}`);
    const urls = [...html.matchAll(/https:\/\/cdn\d*\.telesco\.pe\/file\/[^"'\s]+/g)]
      .map((m) => m[0])
      .slice(0, 5);

    if (!urls.length) {
      throw new Error(
        'Could not read that Telegram pack. ' +
        'Only public packs work, and Telegram blocks some server requests.'
      );
    }

    let sent = 0;
    for (const u of urls) {
      try {
        const buf = await download(u, 8);
        const webp = await media.imageToSticker(buf);
        await ctx.send(ctx.chatJid, { sticker: webp }, { quoted: ctx.msg });
        sent++;
      } catch { /* skip this one */ }
    }

    if (!sent) throw new Error('Found the pack but could not convert any stickers.');
    await ctx.reply(`✅ Converted ${sent} sticker(s) from *${pack}*.`);
  },
};

module.exports = { category: 'TOOLS', commands };
