# ─────────────────────────────────────────────────────────────────────────────
#  WA Bot Suite — production image
#
#  ffmpeg and yt-dlp are baked in because the media commands (.play, .video,
#  .sticker, .tts, .tiktok …) shell out to them. A plain Node runtime on
#  Render does not have either, so the Docker path is the reliable one.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

# ffmpeg for media conversion, python3+pip for yt-dlp, curl for health checks.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      ca-certificates \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp from pip — the standalone binary lags behind YouTube changes.
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Install dependencies first so the layer caches across code changes.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Persistent disk mount point (Render mounts the disk here at runtime).
RUN mkdir -p /var/data/sessions /var/data/tmp

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
