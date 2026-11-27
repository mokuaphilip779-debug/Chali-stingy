'use strict';

/**
 * MEDIA MENU — 10 commands.
 *
 * Each one fetches a real file and sends it. Where a service needs an API
 * key that isn't configured, the command says so plainly instead of
 * pretending to work.
 */

const config = require('../config');
const media = require('../lib/media');
const { get, download, rand } = require('../lib/util');

/** Pull the first og:image / twitter:image out of a page. */
function ogImage(html) {
  return (
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    null
  );
}

function ogTitle(html) {
  return (
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    null
  );
}

const commands = {
  /* ── YouTube ────────────────────────────────────────────────────── */
  async video(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .video <search or YouTube link>');

    await ctx.react('⏳');
    const info = /^https?:\/\//.test(query)
      ? { url: query, title: 'video', durationText: '—' }
      : await media.ytSearch(query);

    const file = await media.ytVideo(info.url, { quality: '480' });
    try {
      const buf = require('fs').readFileSync(file);
      await ctx.send(ctx.chatJid, {
        video: buf,
        caption: `🎬 *${info.title}*\n⏱️ ${info.durationText}`,
        mimetype: 'video/mp4',
      }, { quoted: ctx.msg });
    } finally {
      media.cleanup(file);
    }
  },

  /* ── social image/video grabbers ────────────────────────────────── */
  async instagram(ctx) {
    const url = ctx.text.trim();
    if (!/^https?:\/\//.test(url)) throw new Error('Usage: .instagram <post or reel link>');

    await ctx.react('⏳');
    // Instagram blocks scrapers hard. Try the public embed endpoint, which
    // still exposes the media URL for public posts.
    const embed = `https://www.instagram.com/p/${(url.match(/\/(p|reel|tv)\/([^/?#]+)/) || [])[2] || ''}/embed/captioned/`;
    const html = await media.fetchHtml(embed);
    const img = html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/)?.[1] ||
                ogImage(html);

    if (!img) {
      throw new Error(
        'Instagram did not expose the media for that link. ' +
        'It only works on public posts, and Instagram blocks most server requests.'
      );
    }

    const buf = await media.fetchImage(img.replace(/&amp;/g, '&'));
    await ctx.send(ctx.chatJid, { image: buf, caption: '📸 Instagram' }, { quoted: ctx.msg });
  },

  async facebook(ctx) {
    const url = ctx.text.trim();
    if (!/^https?:\/\//.test(url)) throw new Error('Usage: .facebook <video link>');

    await ctx.react('⏳');
    // Facebook serves a mobile page with a direct mp4 for public videos.
    const html = await media.fetchHtml(url.replace('www.', 'm.'));
    const sd = html.match(/"sd_src":"([^"]+)"/)?.[1]?.replace(/\\\//g, '/');
    const hd = html.match(/"hd_src":"([^"]+)"/)?.[1]?.replace(/\\\//g, '/');
    const src = hd || sd;

    if (!src) {
      throw new Error(
        'Facebook did not expose a video file for that link. ' +
        'Only public videos work, and Facebook blocks most server requests.'
      );
    }

    const buf = await download(src);
    await ctx.send(ctx.chatJid, { video: buf, caption: '🎬 Facebook', mimetype: 'video/mp4' }, { quoted: ctx.msg });
  },

  /* ── images ─────────────────────────────────────────────────────── */
  async img(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .img <search term>');

    await ctx.react('⏳');
    const buf = await media.searchImage(query);
    await ctx.send(ctx.chatJid, { image: buf, caption: `🖼️ ${query}` }, { quoted: ctx.msg });
  },

  async pinterest(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .pinterest <search term>');

    await ctx.react('⏳');
    // Pinterest blocks server requests, so this searches openly-licensed
    // image sources instead. The caption says so rather than pretending.
    const buf = await media.searchImage(query);
    await ctx.send(ctx.chatJid, {
      image: buf,
      caption: `📌 ${query}\n_open image search — Pinterest blocks server requests_`,
    }, { quoted: ctx.msg });
  },

  async wallpapers(ctx) {
    const query = ctx.text.trim() || 'nature landscape';
    await ctx.react('⏳');

    // Wallhaven's public API — no key needed for SFW search.
    const res = await get('https://wallhaven.cc/api/v1/search', {
      params: { q: query, sorting: 'random', purity: '100', categories: '100' },
      timeout: 20000,
    });

    const items = res.data?.data || [];
    if (!items.length) throw new Error(`No wallpapers found for "${query}".`);

    const pick = rand(items);
    const buf = await media.fetchImage(pick.path);
    await ctx.send(ctx.chatJid, {
      image: buf,
      caption: `🖼️ *${query}*\n${pick.resolution || ''}\n${pick.url || ''}`,
    }, { quoted: ctx.msg });
  },

  /* ── files ──────────────────────────────────────────────────────── */
  async apk(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .apk <app name>');

    await ctx.react('⏳');
    // APKPure exposes a search page with direct download links.
    const html = await media.fetchHtml(`https://apkpure.com/search?q=${encodeURIComponent(query)}`);
    const first = html.match(/href="(\/[^"]+\/[^"]+)"/)?.[1];

    if (!first) throw new Error(`No APK found for "${query}".`);

    const page = await media.fetchHtml(`https://apkpure.com${first}`);
    const dl = page.match(/href="(https:\/\/[^"]+\.apk[^"]*)"/)?.[1] ||
               page.match(/id="download_link"[^>]+href="([^"]+)"/)?.[1];

    if (!dl) {
      throw new Error(
        'APKPure did not expose a direct download for that app. ' +
        'Try a different name, or download it manually.'
      );
    }

    const buf = await download(dl, 100);
    const name = (ogTitle(page) || query).replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'app';
    await ctx.send(ctx.chatJid, {
      document: buf,
      mimetype: 'application/vnd.android.package-archive',
      fileName: `${name}.apk`,
      caption: `📦 *${name}*`,
    }, { quoted: ctx.msg });
  },

  async mediafire(ctx) {
    const url = ctx.text.trim();
    if (!/^https?:\/\//.test(url)) throw new Error('Usage: .mediafire <mediafire link>');

    await ctx.react('⏳');
    const html = await media.fetchHtml(url);
    const direct = html.match(/href="(https:\/\/download[^"]+)"/)?.[1] ||
                   html.match(/id="downloadButton"[^>]+href="([^"]+)"/)?.[1];

    if (!direct) throw new Error('Could not find the download link on that page.');

    const buf = await download(direct, 100);
    const name = decodeURIComponent(direct.split('/').pop() || 'file');
    await ctx.send(ctx.chatJid, {
      document: buf,
      mimetype: 'application/octet-stream',
      fileName: name,
      caption: `📁 *${name}*`,
    }, { quoted: ctx.msg });
  },

  async movie(ctx) {
    const query = ctx.text.trim();
    if (!query) throw new Error('Usage: .movie <film name>');

    if (!config.media.tmdbKey) {
      throw new Error(
        'TMDB_API_KEY is not set on the server. ' +
        'Get a free key at themoviedb.org → Settings → API, then add it in Render.'
      );
    }

    const res = await get('https://api.themoviedb.org/3/search/movie', {
      params: { api_key: config.media.tmdbKey, query, include_adult: false },
      timeout: 20000,
    });

    const m = res.data?.results?.[0];
    if (!m) throw new Error(`No film found for "${query}".`);

    const poster = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
    const year = (m.release_date || '').slice(0, 4) || '—';
    const rating = m.vote_average ? `${m.vote_average.toFixed(1)}/10` : '—';

    const caption =
      `🎬 *${m.title}* (${year})\n\n` +
      `⭐ ${rating} · ${m.vote_count || 0} votes\n` +
      `🎭 ${(m.genre_ids || []).length ? 'see TMDB for genres' : '—'}\n\n` +
      `_${m.overview || 'No synopsis available.'}_\n\n` +
      `https://www.themoviedb.org/movie/${m.id}`;

    if (poster) {
      const buf = await media.fetchImage(poster);
      await ctx.send(ctx.chatJid, { image: buf, caption }, { quoted: ctx.msg });
    } else {
      await ctx.reply(caption);
    }
  },

  async capcut(ctx) {
    const url = ctx.text.trim();
    if (!/^https?:\/\//.test(url)) throw new Error('Usage: .capcut <capcut template link>');

    await ctx.react('⏳');
    const html = await media.fetchHtml(url);
    const video = html.match(/"videoUrl":"([^"]+)"/)?.[1]?.replace(/\\u002F/g, '/').replace(/\\\//g, '/') ||
                  ogImage(html);

    if (!video) {
      throw new Error(
        'CapCut did not expose a video for that template. ' +
        'Only public templates work, and CapCut blocks most server requests.'
      );
    }

    const buf = await download(video);
    await ctx.send(ctx.chatJid, { video: buf, caption: '🎬 CapCut template', mimetype: 'video/mp4' }, { quoted: ctx.msg });
  },
};

module.exports = { category: 'MEDIA', commands };
