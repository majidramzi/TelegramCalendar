# Telegram Calendar

A shared calendar for Telegram **groups** and **channels**: a bot that posts event announcements, plus a Mini App for creating, browsing, and voting on events.

It is meant for communities that already live in Telegram and need a lightweight group calendar — meetups, classes, trips, office events — without a separate product or website.

## When it is useful

- **Group meetups** where people need to see date, place, photo, and who is coming in the same chat.
- **Channels** (bot must be admin) that publish public events and collect attendance from subscribers who can press the buttons.
- **Teams / classes** that want reminders in the group before start time, and an optional phone-calendar file after someone votes.
- **Admins-only planning** (default): members can browse and vote, but only admins create or edit events.

It is **not** a full calendar product (no recurrences, no guest lists, no personal calendars per member inside Telegram).

## Features

### Mini App (primary UI)

Open from the **Calendar** button the bot posts in the group. The Mini App is tied to that chat via a start-app token; opening it from a private chat without that token will not work.

- Month view and upcoming list
- Event detail: times, description, map link, photo, attendance buttons, public voter names (when enabled)
- Create / edit form (admins, or everyone if permissions are `all_members`)
- English UI, or Persian if Telegram language starts with `fa`

### Events

Each event can include:

- Required **title** and start time (end defaults to start + 1 hour; end cannot be before start)
- Optional description (shown directly under the title in the group post)
- Optional **photo** (JPEG/PNG/WebP/GIF, compressed, max ~2 MB)
- Optional **location**: searchable map pin (Leaflet + Photon); opens in Maps; no Telegram venue card
- Event **icon** (emoji) shown next to the title
- Optional group **reminders**: 1h, 2h, 1 day, 2 days, 1 week before start (any combination, or none)
- Chat timezone is stored from the Mini App / API (IANA timezone)

### Attendance (voting)

- **Yes** and **No** are always present; labels and icons are editable
- Extra options can be added, removed, reordered, with custom text and icon (icons picked from a scrollable list)
- **Public attendance**: names listed on the announcement and in the Mini App
- **Private attendance**: only counts on buttons
- **Lock first vote**: later changes blocked
- **Voting deadline** (one of, required; default = until event start):
  - until event start
  - until 12 hours before start
  - until 1 day before start
- After the deadline **or** after the event has started, votes are rejected (group buttons and Mini App)

A vote in the group or Mini App can send a **personal `.ics` file** in private chat so the user can add/update/cancel the event on their phone. The user must have started the bot in DM for that to succeed.

### Group announcements

- One Telegram post: photo (if any) + caption (title, description, times, location, attendance notes) + inline vote buttons
- Caption length is limited by Telegram (~1024 characters with a photo; longer text if there is no photo)
- Long public voter lists may be dropped from a photo caption so it still fits
- The bot does **not** pin messages

### Bot commands (in the group/channel)

| Command | What it does |
|---------|----------------|
| `/calendar` | Posts (or re-posts) the Mini App Calendar button |
| `/events` | Lists upcoming events |
| `/addevent` | Short create flow: title, date, time or all-day, optional description |
| `/deleteevent` | Delete (creator or admin); pick from a list or pass an id prefix |
| `/permissions` | Admins only: `admins_only` (default) or `all_members` |
| `/start` | Help in **private** chat |

`/addevent` is a **minimal** path. Photo, map, custom attendance options, deadlines, and reminder checkboxes are Mini App features.

### Calendar subscribe (ICS)

The Mini App can show a **group ICS URL** so Google/Apple Calendar can sync **all** group events. This is separate from the personal `.ics` file sent after a vote.

## Permissions

- Default: only Telegram **admins** (and the event creator for that event) can create, edit, or delete
- `all_members`: anyone in the chat can create events; edit/delete still require creator or admin
- In the Mini App, **New event** is hidden unless the current user may create
- **Channels**: the bot must be an **administrator** to post announcements

## Limitations

- **No recurring events**, no attendees who are not Telegram users, no waitlists.
- **One photo per event**, stored in Postgres (not a CDN). The photo HTTP URL is public if someone has the event id.
- **Telegram caption limit** (~1024 chars) when a photo is attached; very long descriptions or long public name lists may be truncated.
- **Mini App only works** when opened from the group Calendar button (valid start-app token).
- **Personal `.ics` DMs fail** if the user has never pressed Start on the bot in private chat (Telegram restriction).
- **One timezone per chat**, not per member. Times are stored in UTC and shown in that chat timezone.
- **Voting is one choice per Telegram user** per event; changing a vote is optional and can be locked or closed by deadline.
- **Map search** depends on Photon (third-party); it is not Telegram’s native location picker.
- **Bot command UI is English**; Mini App follows Telegram language (`en` / `fa`).
- **Reminders** need Redis (BullMQ). If Redis is down, events still save but reminders may not fire.
- **Hosting**: designed for a small community on Fly/Neon/Upstash free tiers. Large photos and many public voter lists increase DB size and Telegram message size.
- `/addevent` times are parsed in a simple UTC/all-day way; prefer the Mini App for accurate local times.

## Stack

- TypeScript monorepo (pnpm)
- Bot: grammY (`apps/bot`)
- API: Fastify (`apps/api`)
- Mini App: React + Vite (`apps/miniapp`)
- DB: PostgreSQL + Prisma (`packages/db`)
- Shared utils (`packages/shared`)
- Reminders: BullMQ + Redis
- Production process: `apps/server` (API + webhook + reminder worker)

## Quick start (local)

1. Copy env file and fill in secrets:

```bash
cp .env.example .env
```

2. Start Postgres + Redis:

```bash
pnpm docker:up
```

3. Install and migrate:

```bash
pnpm install
pnpm db:push
```

4. Run (bot + api + miniapp):

```bash
pnpm dev
```

Local Docker is **only for development**. Stop it with `pnpm docker:down`.

## Production

See **[DEPLOY.md](DEPLOY.md)** for the full guide:

- **Fly.io** — bot + API + reminders (`apps/server`)
- **Cloudflare Pages** — Mini App (or serve the Mini App from the same Fly app)
- **Neon** — Postgres
- **Upstash** — Redis

### BotFather

1. Create a bot and set `BOT_TOKEN` / `BOT_USERNAME`.
2. Create a Mini App with short name matching `MINIAPP_SHORT_NAME` (e.g. `calendar`).
3. Point the Mini App URL at your HTTPS Mini App (Fly or Cloudflare Pages).

## Packages

| Path | Role |
|------|------|
| `apps/bot` | Commands, conversations, reminders, attendance callbacks |
| `apps/api` | REST API, initData auth, ICS feed, event photos |
| `apps/server` | Production process: API + Telegram webhook + worker |
| `apps/miniapp` | Telegram Web App UI |
| `packages/db` | Prisma schema + client |
| `packages/shared` | Start-app tokens, initData validation, announcement formatting, types |
