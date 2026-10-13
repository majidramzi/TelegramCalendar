# Telegram Calendar

Shared calendar bot + Mini App for Telegram groups and channels.

## Stack

- TypeScript monorepo (pnpm)
- Bot: grammY (`apps/bot`)
- API: Fastify (`apps/api`)
- Mini App: React + Vite (`apps/miniapp`)
- DB: PostgreSQL + Prisma (`packages/db`)
- Shared utils (`packages/shared`)
- Reminders: BullMQ + Redis

## Quick start

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

### BotFather setup

1. Create a bot and set `BOT_TOKEN` / `BOT_USERNAME`.
2. Create a Mini App with short name matching `MINIAPP_SHORT_NAME` (e.g. `calendar`).
3. Point the Mini App URL to your HTTPS host (tunnel in dev).

## Packages

| Path | Role |
|------|------|
| `apps/bot` | Commands, conversations, reminders, RSVP callbacks |
| `apps/api` | REST API, initData auth, ICS feed |
| `apps/miniapp` | Telegram Web App UI |
| `packages/db` | Prisma schema + client |
| `packages/shared` | startapp tokens, initData validation, types |
