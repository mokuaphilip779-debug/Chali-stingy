# WA Bot Suite — v3

A multi-tenant WhatsApp automation bot with **112 commands**, group moderation,
auto status view, auto react, anti-delete, and a monthly subscription paywall.
Deployable on **Render**, stored on **GitHub**.

> ## ⚠️ Read this first
>
> This bot drives **WhatsApp Web automation** (via [Baileys](https://github.com/WhiskeySockets/Baileys)),
> which is **not** an official WhatsApp API. **WhatsApp can and does ban numbers
> that use it** — permanently, without warning, and without appeal.
>
> Auto-viewing statuses and auto-reacting are exactly the high-volume automated
> patterns their abuse detection looks for. **Use a spare number you can afford
> to lose.** Do not run this on your primary number.
>
> If you need a ban-proof setup, use the official WhatsApp Cloud API instead —
> it is free for low volume, but it cannot view statuses or react to them.

---

## Contents

- [What it does](#what-it-does)
- [The paywall](#the-paywall)
- [Quick start](#quick-start)
- [Deploy to Render](#deploy-to-render)
- [Push to GitHub](#push-to-github)
- [Environment variables](#environment-variables)
- [Payment setup](#payment-setup)
- [Full command list](#full-command-list)
- [How the automation works](#how-the-automation-works)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

---

## What it does

| Feature | Detail |
|---|---|
| **Auto view status** | Views every contact status the moment it arrives |
| **Auto react to status** | Reacts to statuses with your chosen emoji |
| **Auto react to messages** | Reacts to incoming DMs with your emoji |
| **Auto read** | Blue ticks on incoming messages |
| **Anti-delete** | Captures deleted messages and DMs them back to you |
| **Auto reply** | Your text, DMs only or DMs + groups |
| **Always online** | Keeps presence set to `available` |
| **Group moderation** | 8 per-group protections, enforced on every message |
| **112 commands** | 12 menus — see [the full list](#full-command-list) |
| **Multi-user** | One WhatsApp session per user, own settings, own billing |
| **Paywall** | Monthly subscription required before a number can be linked |

**Stack:** Node 20 · Express · Baileys · SQLite (`better-sqlite3`) · ffmpeg · yt-dlp.
No build step, no bundler, no frontend framework.

---

## The paywall

One function enforces it — `requireActive` in `src/server.js`. It guards
`/wa/start` and `/wa/pair`, the only two routes that can open a WhatsApp
session. It checks `plan_status === 'active'` **and** `plan_expires > now`,
and downgrades expired plans on read.

Every payment provider funnels into `payments.markPaid()`, the single place a
plan gets extended. One audit point, no drift.

**Plan:** KES 100 for 30 days.

---

## Quick start

```bash
git clone https://github.com/YOU/wa-bot-suite.git
cd wa-bot-suite
npm install
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET and ADMIN_TOKEN
npm start
```

Open <http://localhost:3000>, register, pay, then link your number.

**Requirements:** Node 20+, `ffmpeg` and `yt-dlp` on `PATH` (needed by the media
commands). On Debian/Ubuntu:

```bash
sudo apt install ffmpeg python3-pip
pip install yt-dlp
```

The included `Dockerfile` installs both, which is why Render uses the Docker
runtime.

**Verify the build:**

```bash
npm run check                    # 112 commands registered, menu renders, DB works
node scripts/dispatch-test.js    # commands actually execute and reply
```

---

## Deploy to Render

### Option A — Blueprint (recommended)

1. Push the repo to GitHub (below).
2. Render Dashboard → **New** → **Blueprint**.
3. Pick the repo. Render reads `render.yaml` and creates the service, the
   1 GB disk, and every environment variable.
4. Fill the `sync: false` variables when prompted — at minimum `BASE_URL`,
   `ADMIN_TOKEN`, and `GEMINI_API_KEY`.
5. Deploy.

### Option B — Manual

1. **New** → **Web Service** → connect the repo.
2. **Runtime:** Docker. **Dockerfile path:** `./Dockerfile`.
3. **Plan:** Starter or higher — **not Free** (see below).
4. **Health check path:** `/health`.
5. **Add a disk:** name `wa-bot-data`, mount path `/var/data`, 1 GB.
6. Add the environment variables from the table below.

### Three things that will bite you

1. **Mount the disk at `/var/data`.** Without it, every deploy wipes all users
   and all WhatsApp logins. `render.yaml` does this; if you go manual, add it
   yourself.
2. **The Free tier will not work.** It sleeps after 15 minutes idle, which drops
   every WhatsApp socket and forces a re-scan. Use Starter or above.
3. **Run exactly one instance.** Sessions live in memory. Do not scale
   horizontally without moving state to Redis.

### After the first deploy

Set `BASE_URL` to your real URL, e.g. `https://wa-bot-suite.onrender.com`.
Payment callbacks are built from it, so a wrong value breaks M-Pesa and Stripe.

---

## Push to GitHub

```bash
cd wa-bot-suite
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOU/wa-bot-suite.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `data/`, and `sessions/`.

> **A committed `sessions/` folder is a committed WhatsApp login.** Never push
> it. If you ever do, log the number out of WhatsApp → Linked devices
> immediately.

---

## Environment variables

### Core

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | Render sets this |
| `BASE_URL` | **yes** | — | Public URL, no trailing slash |
| `SESSION_SECRET` | **yes** | insecure dev value | `openssl rand -hex 32` |
| `ADMIN_TOKEN` | **yes** | — | Password for `/admin`. Empty disables it |
| `DB_PATH` | **yes** on Render | `./data/bot.db` | Use `/var/data/bot.db` |
| `SESSIONS_DIR` | **yes** on Render | `./data/sessions` | Use `/var/data/sessions` |
| `TMP_DIR` | no | `./data/tmp` | Use `/var/data/tmp` |

### Owner and bot identity

| Variable | Default | Notes |
|---|---|---|
| `OWNER_NUMBER` | `254115417774` | Digits only, full international |
| `OWNER_NAME` | `Philo` | Shown in `.menu` and `.owner` |
| `OWNER_EMAIL` | `mokuaphilip779@gmail.com` | Shown on the subscribe page |
| `BOT_NAME` | `BUG BOT` | |
| `BOT_VERSION` | `v3` | |
| `BOT_PREFIX` | `.` | |
| `BOT_REPO` | repo URL | Shown by `.repo` |
| `BOT_CHANNEL` | empty | WhatsApp channel link |
| `SUPPORT_GROUP` | empty | Group invite link |

### Plan

| Variable | Default |
|---|---|
| `PLAN_DAYS` | `30` |
| `PLAN_PRICE_KES` | `100` |
| `PLAN_PRICE_USD` | `1` |

### Payment

| Variable | Default | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | `sendmoney` | `sendmoney` \| `mpesa` \| `stripe` \| `manual` |
| `MPESA_SEND_MONEY_NUMBER` | `0115417774` | Where users send money |
| `MPESA_SEND_MONEY_DISPLAY` | `0115417774` | What they see on the page |
| `MPESA_SEND_MONEY_NAME` | `Philo` | Name shown next to the number |

### AI

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `gemini` | `gemini` or `openai` |
| `GEMINI_API_KEY` | — | Free at <https://aistudio.google.com/apikey> |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Text |
| `GEMINI_IMAGE_MODEL` | `gemini-2.0-flash-preview-image-generation` | Images |
| `OPENAI_API_KEY` | — | Only if `AI_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-4o-mini` | |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | |

**Without an AI key**, `.ai`, `.chatbot`, `.imagine`, `.pixelart`, and
`.gsticker` reply with a clear "key not set" message instead of failing
silently. `.tts` and `.traduc` work without a key (they use free endpoints).

### Media

| Variable | Default | Notes |
|---|---|---|
| `YTDLP_PATH` | `yt-dlp` | |
| `FFMPEG_PATH` | `ffmpeg` | |
| `MAX_DOWNLOAD_MB` | `64` | Cap per download |
| `TMDB_API_KEY` | — | Only needed for `.movie` |

---

## Payment setup

### `sendmoney` — the default, no credentials needed

The user sends **KES 100** via **M-Pesa → Send Money** to **0115417774**
(Philo), then pastes the M-Pesa confirmation code into the subscribe page.

1. The code is stored against a pending payment.
2. You open `/admin?token=YOUR_ADMIN_TOKEN`.
3. You check the money actually arrived in your M-Pesa statement.
4. You click **Approve** — the plan activates for 30 days.

This is the honest flow: nothing activates until a human confirms the money
landed. Codes are checked by hand, usually within a few hours.

**Duplicate protection:** a code can only be submitted once. Approving a
payment does not overwrite the stored code, so a replay is rejected.

### `mpesa` — Daraja STK Push (needs a paybill/till)

1. Create an app at <https://developer.safaricom.co.ke>.
2. Set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`.
3. Set `MPESA_SHORTCODE` (paybill or till) and `MPESA_PASSKEY`.
4. Set `MPESA_CALLBACK_URL` to `https://YOUR-APP.onrender.com/webhook/mpesa`.
5. Set `PAYMENT_PROVIDER=mpesa`.

The user enters their phone, gets a PIN prompt, and the plan activates on the
callback. Callbacks are idempotent — a replayed success does not double-extend.

### `stripe` — international cards

1. Create a one-off Price in Stripe, copy its ID to `STRIPE_PRICE_ID`.
2. Set `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint `https://YOUR-APP.onrender.com/webhook/stripe`
   for `checkout.session.completed`, copy the signing secret to
   `STRIPE_WEBHOOK_SECRET`.
4. Set `PAYMENT_PROVIDER=stripe`.

Signatures are verified with a timing-safe comparison; forged requests are
rejected with 400.

### `manual` — admin approval, no payment page

Creates a pending payment the user can see; you approve it in `/admin`.
Useful for testing.

---

## Full command list

Prefix is `.` by default (change per-user with `.prefix`, globally with
`.allprefix`). **112 commands across 12 menus.**

### 👥 GROUP MENU — 29

| Command | What it does |
|---|---|
| `.add <number>` | Add a member (bot must be admin) |
| `.antibadword` | Toggle badword filter for this group |
| `.antibot` | Toggle bot-talk filter |
| `.antigroupstatus` | Toggle group-status blocking |
| `.antilink` | Toggle link blocking |
| `.antiporn` | Toggle explicit-content filter |
| `.antispam` | Toggle rate-limit spam filter |
| `.antistatus` | Toggle status blocking |
| `.antitag` | Toggle mass-mention blocking |
| `.bye` | Bot leaves the group |
| `.del` | Delete the replied-to message |
| `.ppgroup` | Set group photo (reply to an image) |
| `.groupinfo` | Group name, ID, member count, active protections |
| `.groupname <name>` | Rename the group |
| `.kick` | Remove a member (mention or reply) |
| `.left` | List members who have left |
| `.link` | Get the group invite link |
| `.listadmin` | List admins |
| `.mute` | Close the group (admins only can send) |
| `.promote` | Make a member admin |
| `.purge` | Delete the replied-to message |
| `.resetlink` | Reset the invite link |
| `.revoke` | Revoke the old link, issue a new one |
| `.setgdesc <text>` | Set the group description |
| `.staff` | List owner and admins |
| `.tag <note>` | Mention everyone with a note |
| `.tagall <note>` | Mention everyone, formatted |
| `.unmute` | Open the group |
| `.welcome [text]` | Set/enable the welcome message (`{user}`, `{group}`) |

**Admin checks are real.** `.kick`, `.promote`, `.mute`, `.unmute`, `.add`,
`.del`, `.purge`, `.revoke`, `.resetlink` require the sender to be a group
admin **and** the bot to be an admin. Admins cannot be kicked. Non-admins get
a refusal, not silence.

### 🎉 FUN MENU — 17

`.blague` `.character` `.compliment` `.dare` `.fact` `.flirt` `.gif` `.goodnight`
`.meme` `.news` `.quote` `.roseday` `.ship` `.stupid` `.trivia` `.truth` `.valentine`

`.ship` is deterministic — the same pair always gets the same score.
`.gif` and `.meme` fetch real media. `.news` reads live BBC RSS.

### 👑 OWNER MENU — 15

| Command | What it does |
|---|---|
| `.allkaya <msg>` | Broadcast to every chat the bot has seen |
| `.autoreact` | Toggle auto-react to messages |
| `.autoreactch <emoji>` | Set the message reaction emoji |
| `.autostatus` | Toggle auto-view + auto-react to statuses |
| `.ban` | Block and remove a user |
| `.block` | Block a user |
| `.blockinbox` | Block every direct chat |
| `.getpp` | Fetch someone's profile picture |
| `.private` | Toggle auto-reply |
| `.recording` | Send recording presence |
| `.report` | Bot stats: users, plans, memory, uptime |
| `.sudo add\|del <number>` | Manage sudo users |
| `.typing` | Send typing presence |
| `.unban` | Unblock a user |
| `.update` | How to update the deployment |

**Owner-only.** Gated to `OWNER_NUMBER` plus anyone added with `.sudo`.
Sudo is bot-wide, so a sudo user can run owner commands from any chat.

### 🎬 MEDIA MENU — 10

`.instagram` `.video` `.apk` `.capcut` `.facebook` `.img` `.mediafire` `.movie`
`.pinterest` `.wallpapers`

`.video` and `.capcut` download real video. `.img`, `.pinterest`, and
`.wallpapers` return real images. `.movie` needs `TMDB_API_KEY`.

> **Honest note:** Instagram, Facebook, Pinterest, and CapCut actively block
> server-side requests. Where a service refuses, the command says so plainly
> rather than sending a broken file. `.img` and `.pinterest` fall back to
> openly-licensed image search (Openverse) and label the result as such.

### ⚙️ GENERAL MENU — 9

`.alive` `.antidelete` `.channelid` `.fancy` `.menu` `.owner` `.pair` `.ping` `.repo` `.voice`

`.menu` renders the styled box-drawing menu. `.pair <number>` generates a
pairing code. `.voice` sends a real voice note.

### 🛠️ SYSTEM MENU — 8

`.allprefix` `.botimage` `.botname` `.delprefix` `.lang` `.online` `.prefix` `.speed`

### 🤖 AI MENU — 7

| Command | What it does |
|---|---|
| `.ai <question>` | Ask the model |
| `.chatbot <msg>` | Casual chat persona |
| `.imagine <prompt>` | Generate an image |
| `.pixelart <prompt>` | Generate pixel art |
| `.gsticker <prompt>` | Generate an image, convert to sticker |
| `.tts <text>` | Text to speech (no key needed) |
| `.traduc <lang> <text>` | Translate (no key needed) |

### 🧰 TOOLS MENU — 7

| Command | What it does |
|---|---|
| `.attp <text>` | Text → animated sticker |
| `.photo` | Sticker → image |
| `.sticker` | Image/video → sticker |
| `.tg <pack link>` | Telegram sticker pack → WhatsApp stickers |
| `.take <packname>` | Re-pack a sticker with your name |
| `.url <link>` | Link preview with title, description, image |
| `.vv` | Open a view-once message |

### 📥 DOWNLOAD MENU — 4

`.lyrics` `.play` `.song` `.tiktok`

`.play` downloads real audio via yt-dlp. `.song` returns metadata + thumbnail.
`.lyrics` fetches real lyrics. `.tiktok` downloads the video.

### 🔐 ADMIN MENU — 3

`.autochannel` `.ram` `.supportch`

### 🌸 ANIME MENU — 1

`.ppcp` — anime couple picture.

### ✍️ MAKER MENU — 1

`.textmaker [style] <text>` — renders text onto a 1080×1080 card with ffmpeg.
Styles: `bold` `italic` `script` `fraktur` `double` `sans` `monospace`
`fullwidth` `circled` `smallcaps` `flip` `zalgo`.

---

## How the automation works

### Auto view status

Every message on `status@broadcast` triggers `readMessages([key])`. That is
what marks a status as viewed.

### Auto react

Statuses: a reaction is sent to `status@broadcast` with the poster's JID in
`statusJidList`. Messages: a reaction is sent to the chat with the message key.

### Anti-delete

Incoming messages are cached in memory (5,000 entries, FIFO). When a revoke
arrives, the cached body is looked up, written to SQLite, and DM'd to you.
**Only messages the bot saw while running can be recovered** — it cannot
recover history from before it started.

### Group moderation

Each protection is a per-group boolean in `group_settings`. On every group
message the manager loads the group's settings and runs the enabled checks.
Admins and the owner are never moderated. A violation deletes the message and
posts a warning mentioning the sender.

| Protection | Triggers on |
|---|---|
| `antilink` | Any `http(s)://`, `www.`, or `chat.whatsapp.com` link |
| `antispam` | More than 6 messages in 10 seconds |
| `antibadword` | Any word on the group's list (`.add <word>`) |
| `antistatus` | A status posted into the group |
| `antitag` | 5 or more mentions in one message |
| `antigroupstatus` | A group status |
| `antibot` | Bot/auto-reply/broadcast talk |
| `antiporn` | Explicit keywords |

---

## Project layout

```
wa-bot-suite/
├── Dockerfile              # Node 20 + ffmpeg + yt-dlp
├── render.yaml             # Blueprint: service, disk, env vars
├── package.json
├── .env.example
├── scripts/
│   ├── check.js            # registry + menu + DB + routes
│   └── dispatch-test.js    # commands actually execute
└── src/
    ├── index.js            # entry point
    ├── config.js           # env → config
    ├── db.js               # SQLite: users, payments, groups, badwords, sudo
    ├── payments.js         # sendmoney / mpesa / stripe / manual
    ├── server.js           # Express: auth, paywall, dashboard, webhooks
    ├── lib/
    │   ├── util.js         # HTTP, fancy text, JID helpers
    │   ├── media.js        # yt-dlp, ffmpeg, image search
    │   ├── ai.js           # Gemini / OpenAI, TTS, translate
    │   └── msg.js          # message unwrapping, quoted, mentions
    ├── wa/
    │   └── manager.js      # Baileys sessions, automation, moderation
    └── commands/
        ├── index.js        # registry + dispatcher + permission gates
        ├── menu.js         # .menu renderer
        ├── group.js        # 29
        ├── fun.js          # 17
        ├── owner.js        # 15
        ├── media.js        # 10
        ├── general.js      # 9
        ├── system.js       # 8
        ├── ai.js           # 7
        ├── tools.js        # 7
        ├── download.js     # 4
        ├── admin.js        # 3
        ├── anime.js        # 1
        └── maker.js        # 1
```

---

## Troubleshooting

**QR code never appears.** The dashboard polls `/wa/state` every 2.5 s. If
nothing shows, check the Render logs for a Baileys error — usually a stale
`creds.json` in `SESSIONS_DIR`. Delete that user's session folder and retry.

**"Make me a group admin first."** The bot needs admin rights for `.kick`,
`.promote`, `.mute`, `.add`, `.del`, `.purge`, `.revoke`, `.resetlink`.

**Commands do nothing.** Check the prefix — `.prefix` shows the current one.
Also confirm the plan is active; the paywall blocks the session, not the
commands, so a disconnected bot answers nothing.

**Media commands fail.** `ffmpeg` and `yt-dlp` must be on `PATH`. The Docker
image has both; a bare Node runtime does not.

**`.movie` says TMDB_API_KEY is not set.** Get a free key at
<https://www.themoviedb.org/settings/api>.

**Everything resets after a deploy.** The disk is not mounted at `/var/data`,
or `DB_PATH` / `SESSIONS_DIR` do not point into it.

**The number got banned.** Expected risk — see the warning at the top. There is
no recovery; use a new number.

---

## Licence

MIT. Provided as-is. You are responsible for how you use it and for complying
with WhatsApp's Terms of Service.
