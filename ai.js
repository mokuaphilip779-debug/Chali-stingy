'use strict';

/**
 * AI MENU — 7 commands. All call a real model through lib/ai.js.
 */

const ai = require('./ai-lib');
const media = require('./media');
const { num } = require('./util');

const PERSONA =
  'You are a helpful WhatsApp assistant. Answer in the language the user writes in. ' +
  'Be concise — this is a chat, not an essay. Use plain text, no markdown headings.';

const commands = {
  async ai(ctx) {
    const prompt = ctx.text.trim();
    if (!prompt) throw new Error('Usage: .ai <your question>');

    await ctx.react('🤔');
    const answer = await ai.chat(prompt, { system: PERSONA, maxTokens: 900 });
    await ctx.reply(answer);
  },

  async chatbot(ctx) {
    const prompt = ctx.text.trim();
    if (!prompt) throw new Error('Usage: .chatbot <message>');

    await ctx.react('💬');
    const answer = await ai.chat(prompt, {
      system:
        'You are a friendly, casual chat partner on WhatsApp. Keep replies short (1–3 sentences), ' +
        'warm and natural. Never mention that you are an AI model unless asked directly.',
      maxTokens: 400,
      temperature: 0.95,
    });
    await ctx.reply(answer);
  },

  async imagine(ctx) {
    const prompt = ctx.text.trim();
    if (!prompt) throw new Error('Usage: .imagine <what to draw>');

    await ctx.react('🎨');
    const buf = await ai.image(prompt);
    await ctx.send(ctx.chatJid, { image: buf, caption: `🎨 *${prompt}*` }, { quoted: ctx.msg });
  },

  async pixelart(ctx) {
    const prompt = ctx.text.trim();
    if (!prompt) throw new Error('Usage: .pixelart <what to draw>');

    await ctx.react('👾');
    const buf = await ai.image(
      `pixel art, 16-bit retro game style, chunky visible pixels, limited palette, ` +
      `crisp edges, no anti-aliasing: ${prompt}`
    );
    await ctx.send(ctx.chatJid, { image: buf, caption: `👾 *${prompt}*` }, { quoted: ctx.msg });
  },

  async gsticker(ctx) {
    const prompt = ctx.text.trim();
    if (!prompt) throw new Error('Usage: .gsticker <what to draw>');

    await ctx.react('🎨');
    const png = await ai.image(
      `sticker design, bold clean outlines, flat colours, centred subject, ` +
      `plain white background, no text: ${prompt}`
    );
    const webp = await media.imageToSticker(png);
    await ctx.send(ctx.chatJid, { sticker: webp }, { quoted: ctx.msg });
  },

  async tts(ctx) {
    const text = ctx.text.trim();
    if (!text) throw new Error('Usage: .tts <text to speak>');

    await ctx.react('🔊');
    const mp3 = await ai.tts(text, 'en');
    await ctx.send(ctx.chatJid, { audio: mp3, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.msg });
  },

  async traduc(ctx) {
    const text = ctx.text.trim();
    if (!text) {
      throw new Error(
        'Usage: .traduc <lang> <text>\n\n' +
        '_Example: .traduc sw Hello, how are you?_\n' +
        '_Languages: en sw fr es de pt it ar hi zh ja ko ru tr nl id th vi pl sv_'
      );
    }

    const parts = text.split(/\s+/);
    const maybeLang = parts[0].toLowerCase();
    const known = Object.keys(ai.LANGS);

    let target = 'en';
    let body = text;
    if (known.includes(maybeLang) && parts.length > 1) {
      target = maybeLang;
      body = parts.slice(1).join(' ');
    }

    await ctx.react('🌍');
    const out = await ai.translate(body, target);
    await ctx.reply(`🌍 *${ai.LANGS[target] || target}*\n\n${out}`);
  },
};

module.exports = { category: 'AI', commands };
