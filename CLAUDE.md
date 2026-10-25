# Shiori

Personal Japanese vocabulary app (React + Vite, Cloudflare Workers + D1, FSRS).

Before starting work, read:
- `docs/PLAN.md`: status, next steps, open questions, working agreements
- `docs/DESIGN.md`: how the app works and why

When a change moves the project forward, update `docs/PLAN.md` in the same PR.

Checks: `npm test`, `npx tsc -b`, `npm run test:e2e`. End-to-end tests use
`.wrangler/e2e`; study data is in `.wrangler/state`, so never reset it.

Commit subject lines (and PR titles, which become the squash commit) start
with a Conventional Commits prefix (`feat:`, `fix:`, `docs:`, `ci:`,
`chore:`, `refactor:`, `test:`) and end with an emoji that fits the change,
e.g. `fix: keep the review counter in sync 🐛`.
