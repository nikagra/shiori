# Shiori 栞

A personal Japanese vocabulary app. Words are learned on small, fixed **pages**
(their position is a memory anchor), drilled in order and then shuffled, and
then kept alive with **FSRS** spaced review. Words come from manga, books,
school and Renshuu imports.

Design: [docs/DESIGN.md](docs/DESIGN.md) · Status and next steps: [docs/PLAN.md](docs/PLAN.md)

## Stack

- React + TypeScript + Vite, installable to the iPhone home screen
- Cloudflare Workers (Hono) + D1 (SQLite)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) for scheduling, [WanaKana](https://github.com/WaniKani/WanaKana) for romaji → kana typing

## Develop

```sh
npm install
npm run db:migrate:local
npm run dev            # http://localhost:5173
```

## Test

```sh
npm test               # unit tests (Vitest)
npx playwright install chromium   # once
npm run test:e2e       # end-to-end tests at iPhone and laptop sizes
```

End-to-end tests use their own database in `.wrangler/e2e`; they never touch
your study data in `.wrangler/state`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create shiori   # put the printed id into wrangler.jsonc
npm run deploy
```

Put Cloudflare Access in front of the deployed app so only you can open it.
