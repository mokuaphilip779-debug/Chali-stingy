'use strict';

/**
 * DOWNLOAD MENU — 4 commands. All use yt-dlp, so they return real files.
 */

const media = require('../lib/media');
const { get } = require('../lib/util');

const commands = {
  async play(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .play <song name or YouTube link>');

    await ctx.react('⏳');

    const info = /^https?:\/\//.test(query)
      ? { url: query, title: 'audio', durationText: '—', channel: '—' }
      : await media.ytSearch(query);

    const file = await media.ytAudio(info.url, { bitrate: '128k' });
    try {
      const buf = require('fs').readFileSync(file);
      await ctx.send(ctx.chatJid, {
        audio: buf,
        mimetype: 'audio/mpeg',
        fileName: `${(info.title || 'audio').replace(/[^\w\s-]/g, '').slice(0, 60)}.mp3`,
        caption: `🎵 *${info.title}*\n⏱️ ${info.durationText}`,
      }, { quoted: ctx.msg });
    } finally {
      media.cleanup(file);
    }
  },

  async song(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .song <song name>');

    await ctx.react('⏳');
    const info = await media.ytSearch(query);

    const caption =
      `🎵 *${info.title}*\n\n` +
      `👤 ${info.channel}\n` +
      `⏱️ ${info.durationText}\n` +
      `👁️ ${info.views ? info.views.toLocaleString() : '—'} views\n\n` +
      `${info.url}`;

    try {
      const thumb = await media.fetchImage(info.thumbnail);
      await ctx.send(ctx.chatJid, { image: thumb, caption }, { quoted: ctx.msg });
    } catch {
      await ctx.reply(caption);
    }
  },

  async lyrics(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .lyrics <song name>');

    await ctx.react('⏳');

    // lyrics.ovh is free and needs no key.
    let data;
    try {
      const res = await get(`https://api.lyrics.ovh/v1/${encodeURIComponent(query)}`, { timeout: 20000 });
      data = res.data;
    } catch {
      // The endpoint wants "artist/title"; try splitting the query.
      const parts = query.split(/\s+-\s+|\s+by\s+/i);
      if (parts.length === 2) {
        const res = await get(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`,
          { timeout: 20000 }
        );
        data = res.data;
      }
    }

    if (!data?.lyrics) {
      throw new Error(
        `No lyrics found for "${query}".\n\n` +
        '_Try the format: .lyrics Artist - Title_'
      );
    }

    const lyrics = data.lyrics.trim();
    const body = lyrics.length > 3500 ? `${lyrics.slice(0, 3500)}\n\n_…truncated_'` : lyrics;
    await ctx.reply(`🎤 *${query}*\n\n${body}`);
  },

  async tiktok(ctx) {
    const url = ctx.text.trim();
    if (!/^https?:\/\//.test(url)) throw new Error('Usage: .tiktok <tiktok link>');

    await ctx.react('⏳');

    // TikTok's oEmbed endpoint gives the author and title without a key.
    let meta = {};
    try {
      const res = await get('https://www.tiktok.com/oembed', { params: { url }, timeout: 20000 });
      meta = res.data || {};
    } catch { /* ignore — we can still try the video */ }

    // yt-dlp handles TikTok natively and is far more reliable than scraping.
    const file = await media.ytVideo(url, { quality: '720' });
    try {
      const buf = require('fs').readFileSync(file);
      const caption =
        `🎵 *${meta.title || 'TikTok'}*\n` +
        (meta.author_name ? `👤 ${meta.author_name}\n` : '') +
        `\n${url}`;
      await ctx.send(ctx.chatJid, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: ctx.msg });
    } finally {
      media.cleanup(file);
    }
  },
};

module.exports = { category: 'DOWNLOAD', commands };
