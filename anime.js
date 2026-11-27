'use strict';

/**
 * ANIME MENU — 1 command.
 */

const media = require('../lib/media');
const { get, rand } = require('../lib/util');

const commands = {
  async ppcp(ctx) {
    // Couple / matching profile pictures, anime style.
    await ctx.react('⏳');
    const buf = await media.searchImage('anime couple', { animated: false });
    await ctx.send(ctx.chatJid, {
      image: buf,
      caption: '🌸 *Anime couple*',
    }, { quoted: ctx.msg });
  },
};

module.exports = { category: 'ANIME', commands };
