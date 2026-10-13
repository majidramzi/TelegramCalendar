# Deploy (free): Fly.io + Cloudflare Pages + Neon + Upstash

Goal: nothing needs to stay running on your laptop.

```text
Telegram ──webhook──► Fly.io (@tg-cal/server = API + Bot + reminders)
Telegram Mini App ──► Cloudflare Pages (React)
Fly.io ──► Neon (Postgres)
Fly.io ──► Upstash (Redis)
```

## 0) Accounts to create (all free tiers)

1. [GitHub](https://github.com) — host the code  
2. [Neon](https://neon.tech) — Postgres  
3. [Upstash](https://upstash.com) — Redis  
4. [Fly.io](https://fly.io) — bot + API  
5. [Cloudflare](https://dash.cloudflare.com) — Mini App hosting  

Also keep your BotFather token and Mini App short name ready.

---

## 1) Push this repo to GitHub

```bash
cd C:\Users\majid\Projects\telegram-calendar
gh auth login
gh repo create telegram-calendar --private --source=. --remote=origin --push
```

(Or create an empty private repo on GitHub and `git remote add origin …` then `git push -u origin main`.)

---

## 2) Neon (Postgres)

1. Create a project (region close to Fly, e.g. Frankfurt / EU if available).  
2. Copy the **connection string** (use the pooled or direct URL with `sslmode=require`).  
3. Example shape:

```text
postgresql://USER:PASS@HOST/neondb?sslmode=require
```

You will set this as `DATABASE_URL` on Fly.

After Fly secrets exist, run schema push once:

```bash
# from your PC, with DATABASE_URL pointing at Neon:
pnpm db:push
```

---

## 3) Upstash (Redis)

1. Create a Redis database.  
2. Copy the **Redis URL** (`rediss://…`).  
3. Set as `REDIS_URL` on Fly.

---

## 4) Fly.io (bot + API)

### Install CLI (Windows PowerShell)

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Restart the terminal, then:

```bash
fly auth login
cd C:\Users\majid\Projects\telegram-calendar
fly apps create telegram-calendar
```

If the name is taken, change `app = "…"` in `fly.toml` and create that name instead.

### Set secrets

Generate a random webhook secret and startapp secret (do not commit them).

```bash
fly secrets set BOT_TOKEN="YOUR_BOT_TOKEN" BOT_USERNAME="YourBotUsername" MINIAPP_SHORT_NAME="calendar" STARTAPP_SECRET="long-random-string" WEBHOOK_SECRET="another-long-random" DATABASE_URL="postgresql://...neon.../neondb?sslmode=require" REDIS_URL="rediss://...upstash..." PUBLIC_API_URL="https://telegram-calendar.fly.dev" PUBLIC_MINIAPP_URL="https://YOUR_PAGES_DOMAIN" BOT_MODE="webhook" API_HOST="0.0.0.0" API_PORT="3000"
```

After first deploy, `PUBLIC_API_URL` must match your real Fly URL  
(`https://<app-name>.fly.dev`).

### Deploy

```bash
fly deploy
```

Check health:

```bash
curl https://telegram-calendar.fly.dev/health
```

Webhook endpoint (set automatically on boot):

`https://telegram-calendar.fly.dev/telegram/webhook`

### Apply DB schema (once)

```bash
# local .env DATABASE_URL = Neon URL, then:
pnpm db:push
```

---

## 5) Cloudflare Pages (Mini App)

1. Cloudflare Dashboard → **Workers & Pages** → your Pages project → **Settings** → **Builds & deployments**.  
2. Build settings (important: this must be **Pages**, not Workers):

| Setting | Value |
|--------|--------|
| Framework preset | None |
| Build command | `corepack enable && pnpm install && pnpm --filter @tg-cal/miniapp build` |
| **Deploy command** | **leave EMPTY** (do not use `npx wrangler deploy`) |
| Build output directory | `apps/miniapp/dist` |
| Root directory | `/` (repo root) |

If Deploy command is set to `npx wrangler deploy`, the build can succeed and then fail on deploy. Clear it and **Retry deployment**.

3. Environment variable (Production):

| Name | Value |
|------|--------|
| `VITE_API_URL` | `https://telegram-calendar-2026-10-13.fly.dev` |

4. Deploy. Copy the HTTPS URL, e.g. `https://telegram-calendar.pages.dev`.

5. Update Fly secret:

```bash
fly secrets set PUBLIC_MINIAPP_URL="https://YOUR_PROJECT.pages.dev"
```

### Upstash Redis URL (common mistake)

BullMQ needs a **Redis** URL, not the REST/HTTP URL.

- Wrong: `https://xxxxx.upstash.io`
- Right: `rediss://default:PASSWORD@xxxxx.upstash.io:6379`

In Upstash console → your database → **Connect** → copy **Redis** / **Node.js (ioredis)** URL.

---

## 6) BotFather Mini App URL

1. [@BotFather](https://t.me/BotFather) → `/mybots` → your bot  
2. **Bot Settings** → **Configure Mini App** (or Menu Button / Web App)  
3. Set URL to your Cloudflare Pages HTTPS URL  
4. Short name must match `MINIAPP_SHORT_NAME` (default `calendar`)

Direct link form:

`https://t.me/<BOT_USERNAME>/calendar?startapp=...`

---

## 7) Smoke test

1. Open a private chat with the bot → `/start`  
2. Add the bot to a test group  
3. Confirm pinned **Calendar** message  
4. Open the button → Mini App loads  
5. Create an event with `/addevent`  

---

## Cost / free-tier notes

- **Fly:** keep `auto_stop_machines = "off"` and `min_machines_running = 1` so the bot does not sleep (uses free allowance).  
- **Neon / Upstash:** free quotas are enough for small groups.  
- **Cloudflare Pages:** free for static Mini App.  

If Fly free allowance runs out later, options are a tiny paid Fly machine or moving the server to another host; the Mini App/DB/Redis can stay as-is.

---

## Local Docker (optional, only for laptop dev)

You can stop local containers anytime:

```bash
pnpm docker:down
```

Production does **not** use your PC Docker.
