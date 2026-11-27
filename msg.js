'use strict';

/**
 * Message shape helpers. Baileys nests content in several wrappers
 * (ephemeral, view-once, edited, document-with-caption), so every reader
 * here unwraps first and then looks at the real payload.
 */

/** Peel off the wrapper layers Baileys adds. */
function unwrap(message) {
  if (!message) return null;
  let m = message;
  for (let i = 0; i < 4; i++) {
    const next =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message;
    if (!next) break;
    m = next;
  }
  return m;
}

/** Readable text out of any message, with a placeholder for media. */
function extractText(message) {
  const m = unwrap(message);
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    (m.stickerMessage ? '[sticker]' : '') ||
    (m.audioMessage ? '[voice note]' : '') ||
    (m.imageMessage ? '[image]' : '') ||
    (m.videoMessage ? '[video]' : '') ||
    (m.documentMessage ? '[document]' : '') ||
    (m.contactMessage ? '[contact]' : '') ||
    (m.locationMessage ? '[location]' : '') ||
    ''
  );
}

/** Which media kind the message carries, or null. */
function mediaType(message) {
  const m = unwrap(message);
  if (!m) return null;
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.stickerMessage) return 'sticker';
  if (m.documentMessage) return 'document';
  return null;
}

/** The media node itself (imageMessage, videoMessage, …). */
function mediaNode(message) {
  const m = unwrap(message);
  if (!m) return null;
  return m.imageMessage || m.videoMessage || m.audioMessage ||
         m.stickerMessage || m.documentMessage || null;
}

/** contextInfo, wherever it lives. */
function contextInfo(message) {
  const m = unwrap(message);
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    null
  );
}

/** The message this one replies to, as { key, message, text, sender }. */
function getQuoted(msg) {
  const ctx = contextInfo(msg.message);
  if (!ctx?.quotedMessage) return null;
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      fromMe: ctx.participant === msg.key.remoteJid ? false : undefined,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
    text: extractText(ctx.quotedMessage),
    sender: ctx.participant || null,
  };
}

/** Every JID mentioned in the message. */
function mentionedJids(message) {
  const ctx = contextInfo(message);
  return ctx?.mentionedJid || [];
}

/** True when the message is a revoke (delete-for-everyone) stub. */
function isRevoke(update) {
  if (!update) return false;
  const stub = update.messageStubType;
  return (
    update.message === null ||
    stub === 1 ||
    update.message?.protocolMessage?.type === 0
  );
}

/** True when the message is a group-status (status sent into a group). */
function isGroupStatus(message) {
  const m = unwrap(message);
  return !!(m?.groupStatusMessage || m?.groupStatusMessageV2);
}

module.exports = {
  unwrap, extractText, mediaType, mediaNode, contextInfo,
  getQuoted, mentionedJids, isRevoke, isGroupStatus,
};
