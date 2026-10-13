# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @tg-cal/shared build \
 && pnpm --filter @tg-cal/db generate \
 && pnpm --filter @tg-cal/db build \
 && pnpm --filter @tg-cal/bot build \
 && pnpm --filter @tg-cal/api build \
 && pnpm --filter @tg-cal/server build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@tg-cal/server", "start"]
