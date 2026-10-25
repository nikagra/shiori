# Shiori plan

Where the project stands and what comes next. Start here when picking the work
back up. For how the app works, see [DESIGN.md](DESIGN.md).

## Status (2026-10-25)

- **v0.1 is merged into `main`** (PR #1, squashed as 99b782a; the
  `v0.1-core-loop` branch is deleted). It includes import, the check pass,
  pages, FSRS review, audio, furigana with peeks, and furigana settings synced
  across devices. New work starts from `main` on a new branch.
- **Not production yet.** Mikita imported his Renshuu words and tries the app
  casually, but doesn't rely on it.
- **Runs only on Mikita's laptop** (`~/Projects/shiori`). The dev server is
  started in the background with
  `nohup npm run dev -- --host > /tmp/shiori-dev.log 2>&1 &` and the iPhone
  opens `http://<laptop Wi-Fi IP>:5173/` on the same Wi-Fi. Nothing is deployed
  to Cloudflare yet. After a reboot, start the server again.
- Study data is in `.wrangler/state`. An old database holding only test data is
  kept in `.wrangler/state-test-backup-20261025` and can be deleted.
- Tests on `main`: 56 unit tests, 34 end-to-end runs (17 tests at iPhone and laptop sizes), and `tsc -b` all
  pass.
- First iPhone feedback (25 Oct) is in: "Don't know" on review and drill
  cards, next words hidden in the in-order drill, "Study the page again",
  whole words on the grid, safer iOS speech. Sound on the iPhone still needs
  a recheck (silent switch off, volume up).

## Next steps, in order

1. **Finish checking v0.1 on the iPhone.** Mikita ticked the PR #1 checklist
   before merging; only the furigana check wasn't on it:
   - [x] Add to Home Screen opens full screen.
   - [x] The audio button speaks Japanese.
   - [x] The Japanese keyboard works in the kana answer box.
   - [x] The page grid is readable.
   - [ ] Furigana and "Show furigana" work.

   Fix whatever turns up in a new PR.
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
4. **v0.2: capture while reading.** Matches the original plan
   ([plan doc](https://claude.ai/artifact/1J233eFb8H61zr7WbEZXas)):
   - Photo of a manga panel → Claude (called only from the Worker, with its own
     API key; Pro doesn't include API access) explains it and proposes words,
     each tagged with `source` / `source_list`. New words go to the inbox.
     Roughly $0.05 per panel.
   - JMdict (via jmdict-simplified) for kana and meanings, and per-kanji
     furigana from JmdictFurigana. Mikita asked for this (25 Oct): readings
     over a run of kanji (冬眠, 日本) don't line up with each kanji today.
   - Cloze cards using the sentence the word came from.
   - Show "usually written in kana" forms.
5. **v0.3: kanji, school, leeches.**
   - Kanji reading cards (on and kun) as their own study vector, seeded from
     `kanji_hints` and the Still learning list, with separate grades.
   - School focus: Marugoto batches of 10 kanji over about 6 weeks, and topic
     blocks of about 3 months, get priority before tests.
   - Leeches: `LEECH_LAPSES` (6) is defined in `shared/scheduler.ts` but unused.
     Decide what happens to one, for example a new page, a flag or a suspend.
   - New-context cards: the same word in a fresh sentence once it's mature.
6. **v0.4: listening** from YouTube clips, if feasible; otherwise keep it
   separate.
7. **v0.5: grammar map**, one structure that ties grammar points together. It
   needs its own design pass before any code.

## Open questions

- Grading isn't obvious from the buttons alone (Mikita, 25 Oct). DESIGN.md now
  has a "Buttons and what they do" guide. Should the app show it too, for
  example a one-line hint under the grade buttons, or the next interval on
  each button the way Anki does?
- A hint system for review cards (beyond the page hint and furigana), asked
  for on 25 Oct as a future improvement: what hints, and what they cost.
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
