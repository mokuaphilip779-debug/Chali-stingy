'use strict';

require('dotenv').config();

const path = require('path');

function bool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: int(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`).replace(/\/+$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
  adminToken: process.env.ADMIN_TOKEN || '',

  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db'),
  sessionsDir: process.env.SESSIONS_DIR || path.join(process.cwd(), 'data', 'sessions'),
  tmpDir: process.env.TMP_DIR || path.join(process.cwd(), 'data', 'tmp'),

  /* ── owner / bot identity ─────────────────────────────────────────── */
  owner: {
    number: (process.env.OWNER_NUMBER || '254115417774').replace(/\D/g, ''),
    name: process.env.OWNER_NAME || 'Philo',
    email: process.env.OWNER_EMAIL || 'mokuaphilip779@gmail.com',
  },

  bot: {
    name: process.env.BOT_NAME || 'BUG BOT',
    version: process.env.BOT_VERSION || 'v3',
    prefix: process.env.BOT_PREFIX || '.',
    repo: process.env.BOT_REPO || 'https://github.com/mokuaphilip779/wa-bot-suite',
    channel: process.env.BOT_CHANNEL || '',
    supportGroup: process.env.SUPPORT_GROUP || '',
  },

  /* ── subscription ─────────────────────────────────────────────────── */
  plan: {
    days: int(process.env.PLAN_DAYS, 30),
    priceKes: int(process.env.PLAN_PRICE_KES, 100),
    priceUsd: int(process.env.PLAN_PRICE_USD, 1),
  },

  /* ── payment ──────────────────────────────────────────────────────── */
  payment: {
    provider: (process.env.PAYMENT_PROVIDER || 'manual').toLowerCase(),

    // M-Pesa Send Money (person-to-person). Default flow: user sends KES to
    // this number, then submits the M-Pesa confirmation code on the site.
    sendMoney: {
      number: (process.env.MPESA_SEND_MONEY_NUMBER || '0115417774').replace(/\D/g, ''),
      display: process.env.MPESA_SEND_MONEY_DISPLAY || '0115417774',
      name: process.env.MPESA_SEND_MONEY_NAME || 'Philo',
    },

    // Daraja STK Push (optional — only if you have a paybill/till)
    mpesa: {
      env: process.env.MPESA_ENV || 'sandbox',
      consumerKey: process.env.MPESA_CONSUMER_KEY || '',
      consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
      shortcode: process.env.MPESA_SHORTCODE || '',
      passkey: process.env.MPESA_PASSKEY || '',
      callbackUrl: process.env.MPESA_CALLBACK_URL || '',
    },

    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      priceId: process.env.STRIPE_PRICE_ID || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },
  },

  /* ── AI ───────────────────────────────────────────────────────────── */
  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation',
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  },

  /* ── media ────────────────────────────────────────────────────────── */
  media: {
    ytdlp: process.env.YTDLP_PATH || 'yt-dlp',
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    maxDownloadMb: int(process.env.MAX_DOWNLOAD_MB, 64),
    tmdbKey: process.env.TMDB_API_KEY || '',
  },

  /* ── bot defaults (per-user, editable in the dashboard) ───────────── */
  defaults: {
    autoViewStatus: bool(process.env.DEFAULT_AUTO_VIEW_STATUS, true),
    autoReactStatus: bool(process.env.DEFAULT_AUTO_REACT_STATUS, true),
    statusReaction: process.env.DEFAULT_STATUS_REACTION || '❤️',
    autoRead: bool(process.env.DEFAULT_AUTO_READ, true),
    autoReactMessage: bool(process.env.DEFAULT_AUTO_REACT_MESSAGE, false),
    messageReaction: process.env.DEFAULT_MESSAGE_REACTION || '👍',
    antiDelete: bool(process.env.DEFAULT_ANTI_DELETE, true),
    autoReply: bool(process.env.DEFAULT_AUTO_REPLY, false),
    autoReplyText: process.env.DEFAULT_AUTO_REPLY_TEXT || "Thanks for your message! I'll get back to you soon.",
    autoReplyGroups: false,
    alwaysOnline: bool(process.env.DEFAULT_ALWAYS_ONLINE, false),
  },
};

module.exports = config;
