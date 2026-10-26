# Shiori plan

Where the project stands and what comes next. Start here when picking the work
back up. For how the app works, see [DESIGN.md](DESIGN.md).

## Status (2026-10-26)

- **v0.1 is merged into `main`** (PR #1, squashed as 6dd130e; history on
  `main` was rewritten on 25 Oct so every commit is Mikita's with an emoji
  subject). It includes import, the check pass, pages, FSRS review, audio,
  furigana with peeks, and furigana settings synced across devices. New work
  starts from `main` on a new branch.
- **Not production yet.** Mikita imported his Renshuu words and tries the app
  casually, but doesn't rely on it.
- **Deployed on Cloudflare** (25 Oct) at `https://shiori.nikagra.workers.dev`,
  behind Cloudflare Access (all traffic, Mikita's Cloudflare account, 7-day
  sessions). Preview URLs are off (`preview_urls: false`). D1 database
  `shiori` holds the 450 manga words copied from the laptop. The iPhone uses it
  from the Home Screen; furigana settings sync between phone and laptop.
- **Deploy on merge**: `.github/workflows/ci.yml` tests every PR and deploys
  `main` after each merge, using the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` repository secrets. The first automatic deploy ran
  on 25 Oct (run 40244891019). Actions are pinned to commit SHAs (required in the repo
  settings) and Dependabot bumps them monthly.
- **The laptop is the development copy.** `npm run dev` uses its own database
  in `.wrangler/state`, separate from the cloud one. An old database holding
  only test data is kept in `.wrangler/state-test-backup-20261025` and can be
  deleted.
- Tests: 99 unit tests, 48 end-to-end runs (24 tests at iPhone and laptop
  sizes), and `tsc -b` all pass.
- **Backup and export** (26 Oct): Home › Backup downloads all study data as
  one JSON file, a nightly cron saves the same file to the private R2 bucket
  `shiori-backups` (30 days kept), and `npm run backup:sql` turns a file back
  into SQL. A restore through local D1 was checked by hand. See "Backup and
  restore" in DESIGN.md. Mikita enabled R2 and created the bucket on 26 Oct.
- **Lists you manage** (26 Oct): a `lists` table (migration `0003_lists`)
  with the four starting lists; existing words and pages moved onto them.
  Lists (a new tab) adds, renames, merges, archives and deletes lists and sets
  each one's weight, weekly target, pause and focus. Every page comes from one
  list; "New page" asks which, or picks the one furthest behind its pace.
  Check has a list picker too (Mikita, 26 Oct: one big import blocked the
  others), and across lists it follows priority.
  Today's 20 new review cards are shared by weight. Older backups still load
  and get their lists. See "Lists" in DESIGN.md. After pulling on the laptop,
  run `npm run db:migrate:local`; the deploy applies it to D1.
- First iPhone feedback (25 Oct) is in: "Don't know" on review and drill
  cards, next words hidden in the in-order drill, "Study the page again",
  whole words on the grid, safer iOS speech. Sound on the iPhone still needs
  a recheck (silent switch off, volume up).

## Next steps, in order

1. ~~**Backup and export**~~: done (26 Oct). Check that the first nightly copy
   shows on Home the morning after the deploy.
2. ~~**Lists you manage, with their own pace**~~: done (26 Oct). Try it on
   the iPhone: the Lists tab, then a page from School and one from Manga.
   Capture (v0.2) should file new words into a list the same way.
3. **v0.2: capture while reading.** Matches the original plan
   ([plan doc](https://claude.ai/artifact/1J233eFb8H61zr7WbEZXas)):
   - Photo of a manga panel → Claude (called only from the Worker, with its own
     API key; Pro doesn't include API access) explains it and proposes words,
     each tagged with `source` / `source_list`. New words go to the inbox.
     Roughly $0.05 per panel.
   - JMdict (via jmdict-simplified) for kana and meanings, and per-kanji
     furigana from JmdictFurigana. Mikita asked for this (25 Oct): readings
     over a run of kanji (冬眠, 日本) don't line up with each kanji today.
   - Cloze cards using the sentence the word came from.
   - Keep several related sentences per word (Mikita, 25 Oct), especially from
     manga, for extra context: a word → sentences table (sentence, source,
     panel) instead of one sentence column. Cloze and the v0.3 new-context
     cards pick from it.
   - Show "usually written in kana" forms.
4. **v0.3: kanji, school, leeches.**
   - Kanji reading cards (on and kun) as their own study vector, seeded from
     `kanji_hints` and the Still learning list, with separate grades.
   - School focus: Marugoto batches of 10 kanji over about 6 weeks, and topic
     blocks of about 3 months, get priority before tests.
   - Leeches: `LEECH_LAPSES` (6) is defined in `shared/scheduler.ts` but unused.
     Decide what happens to one, for example a new page, a flag or a suspend.
   - New-context cards: the same word in a fresh sentence once it's mature.
5. **v0.4: listening** from YouTube clips, if feasible; otherwise keep it
   separate.
6. **v0.5: grammar map**, one structure that ties grammar points together. It
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
- `NEW_PER_DAY` is fixed at 20 (now shared between lists by weight). Should
  the total be a setting?
- Should a device's page size and audio defaults depend on the device, for
  example audio off on the laptop?
- Should FSRS parameters be refit from `review_log` once there's enough
  history?

## Working agreements

- Development happens on a branch with a PR into `main`. Run `/code-review-ad`
  (on the Mac, through Remote Control) and check its findings before merging.
- Commit subject lines and PR titles start with a Conventional Commits
  prefix (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`...) and end with an emoji
  that fits the change (prefixes from 25 Oct on). Don't rewrite
  pushed commits.
- Don't change or skip tests to make them pass. Report failures with their
  output.
- Keep this file current: update **Status** and tick off **Next steps** in the
  same PR that changes them.
