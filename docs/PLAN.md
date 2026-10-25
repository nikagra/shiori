# Shiori plan

Where the project stands and what comes next. Start here when picking the work
back up. For how the app works, see [DESIGN.md](DESIGN.md).

## Status (2026-10-25)

- **v0.1 is in PR #1** (`v0.1-core-loop` → `main`, not merged yet). It
  includes import, the check pass, pages, FSRS review, audio, furigana with
  peeks, and furigana settings synced across devices.
- **Not production yet.** Mikita imported his Renshuu words and tries the app
  casually, but doesn't rely on it.
- **Runs only on Mikita's laptop** (`~/Projects/shiori`). The dev server is
  started in the background with
  `nohup npm run dev -- --host > /tmp/shiori-dev.log 2>&1 &` and the iPhone
  opens `http://<laptop Wi-Fi IP>:5173/` on the same Wi-Fi. Nothing is deployed
  to Cloudflare yet. After a reboot, start the server again.
- Study data is in `.wrangler/state`. An old database holding only test data is
  kept in `.wrangler/state-test-backup-20261025` and can be deleted.
- Tests on the branch: 56 unit tests, 16 end-to-end tests, and `tsc -b` all
  pass.

## Next steps, in order

1. **Finish v0.1.** Do the "Try on iPhone" checklist in PR #1:
   - [ ] Add to Home Screen opens full screen.
   - [ ] The audio button speaks Japanese.
   - [ ] The Japanese keyboard works in the kana answer box.
   - [ ] The page grid is readable.
   - [ ] Furigana and "Show furigana" work.

   Fix whatever turns up, then merge PR #1 into `main`.
2. **Deploy**, so the phone works without the laptop:
   - Mikita runs `npx wrangler login` (it needs his Cloudflare account).
   - `wrangler d1 create shiori`, then put the id into `wrangler.jsonc`.
   - Apply the migrations with `--remote`.
   - `npm run deploy`.
   - Put Cloudflare Access in front of the app so only Mikita can open it.
   - Decide whether to move the laptop's study data over
     (`wrangler d1 export` / `execute --file`) or re-import from Renshuu.
3. **Backup and export**: a way to download all study data, plus a scheduled
   D1 export once deployed.
4. **Capture words while reading** (manga, books, school): quick add from the
   phone with a dictionary lookup for kana and meanings (JMdict-based), tagged
   with `source` / `source_list`. New words go to the inbox.
5. **Leeches**: `LEECH_LAPSES` (6) is defined in `shared/scheduler.ts` but not
   used yet. Decide what happens to a leech, for example: put it back on a new
   page, flag it, or suspend it.
6. **Kanji study vector**: kanji reading cards built from `kanji_hints` and the
   Still learning list, with their own grades, separate from vocabulary.
7. **Grammar map**: one structure that ties grammar points together (the
   second half of the project goal). It needs its own design pass before any
   code.

## Open questions

- Should the N5/N4 kanji lists be editable in bulk, or are "Also known" and
  "Still learning" enough?
- `NEW_PER_DAY` is fixed at 20. Should it be a setting?
- Should a device's page size and audio defaults depend on the device, for
  example audio off on the laptop?
- Should FSRS parameters be refit from `review_log` once there's enough
  history?

## Working agreements

- Development happens on a branch with a PR into `main`. Run `/code-review`
  and check its findings before merging.
- Commit subject lines end with an emoji that fits the change. Don't rewrite
  pushed commits.
- Don't change or skip tests to make them pass. Report failures with their
  output.
- Keep this file current: update **Status** and tick off **Next steps** in the
  same PR that changes them.
