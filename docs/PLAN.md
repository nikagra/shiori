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

## Direction (26 Oct)

Mikita, 26 Oct: Shiori first becomes a **complete word learning tool**, and
only then a Japanese reading assistant. Each step should leave a feature you
can fully use, not several half-usable ones. So the Claude API (photo
capture) moves to the end of the word work, and the next steps fill the gaps
in the everyday loop: finding, adding, editing and arranging words.

What the word loop can't do yet:

- See what's in a list, or find, edit or move a word. Only its meaning can
  be changed (from a review answer), and a word can only be set aside
  during the check pass ("not worth learning").
- Add one word. Import only takes a pasted or uploaded Renshuu export.
- Shape a page: drop a word with a similar meaning, pick the words yourself,
  or delete a page.
- Find settings in one place. Audio, furigana, page size, backup and import are spread
  over Home and the screens.
- Handle leeches, show what each grade button does, or change the 20 new
  cards a day.

## Next steps, in order

Done: v0.1 core loop (import, check pass, pages, FSRS review, audio,
furigana), deploy on merge, backup and export (26 Oct; check the first
nightly copy shows on Home), lists you manage with their own pace (26 Oct;
try it on the iPhone: the Lists tab, then a page from School and one from
Manga).

### v0.2: a complete word tool

1. **Settings.** One Settings screen for audio, furigana, page size, backup
   and import (Mikita, 26 Oct), so Home, Pages, Review and Lists are only
   about studying. Small, and it gives the later steps a place to live.
2. **Words you can see and change.** Each list opens to its words, with a
   search box (kana, romaji, kanji or meaning) and filters by state (to
   check, waiting, on a page, learning, set aside). Edit a word's kanji,
   kana and meaning, move it to another list, set it aside or delete it, and
   check it again. This is the "review and edit list contents after the
   check" feedback (26 Oct).
3. **Pages you shape** (Mikita, 26 Oct).
   - Build a page by picking words from a list, with the same search box.
   - On a new page, swap out a word (for example one too close in meaning
     to another); the next waiting word takes its place.
   - Delete a page. Decide what happens to its words: back to waiting if it
     isn't graduated, and keep review history if it is.
4. **Dictionary** (Mikita, 26 Oct: simpler import and word search).
   - Data: English JMdict from jmdict-simplified (about 210k entries, updated
     weekly) and JmdictFurigana, both CC BY-SA 4.0, so the app needs a
     credits line. No Jisho API: it's unofficial and has no uptime promise.
   - Storage: a separate D1 database `shiori-dict`, so backups stay small and
     the dictionary can be rebuilt any time. Search uses SQLite FTS5. The full
     set fits the free plan's 500 MB, but the free plan allows only 100k row
     writes a day, so the loader is resumable and fills it over a few nights
     (or at once on Workers Paid). The ~23k common entries load first, in a
     day. The loader can start during steps 1 to 3.
   - Add a word: search by kana, romaji (WanaKana), kanji or English, then
     tap a result to put it in a list. This replaces the Renshuu Reading
     Buddy step on the iPhone.
   - Import: match each Renshuu word to a dictionary entry; the check pass
     flags words with no match. Editing a word (step 2) can pick another
     entry.
   - Per-kanji furigana from JmdictFurigana (Mikita, 25 Oct): readings over a
     run of kanji (冬眠, 日本) don't line up with each kanji today. Also show
     "usually written in kana" forms.
5. **Finish review.**
   - Leeches: `LEECH_LAPSES` (6) is defined in `shared/scheduler.ts` but
     unused. A leech gets flagged and shown in its list (step 2), where you
     can edit it, put it on a fresh page or set it aside.
   - What each grade does, shown in the app (open question below).
   - New cards a day as a setting (open question below).
6. **Use it for real.** Study only in Shiori for about two weeks, add words
   from reading with the dictionary, and fix what gets in the way. Then
   decide how much care study data needs once you rely on it (for example
   checking a restore now and then) before moving on.

### v0.3: deeper word knowledge

- **Sentences per word** (Mikita, 25 Oct): a word → sentences table
  (sentence, source, note) instead of one sentence column. Sentences are
  typed or pasted by hand, or picked from the Tatoeba examples that
  jmdict-simplified ships.
- **Cloze cards** from those sentences, and **new-context cards** (the same
  word in a fresh sentence once it's mature).
- **Kanji reading cards** (on and kun) as their own study vector, seeded from
  `kanji_hints` and the Still learning list, with separate grades. Marugoto
  batches of 10 kanji over about 6 weeks become a kanji list with a focus
  date. (Focus and weekly targets for school vocabulary already work through
  Lists. Topic blocks of about 3 months, before a test, use the same focus.)

### v0.4: reading assistant

- **Capture while reading** (original
  [plan doc](https://claude.ai/artifact/1J233eFb8H61zr7WbEZXas)): a photo of
  a manga panel goes to Claude (called only from the Worker, with its own API
  key; Pro doesn't include API access), which explains it and proposes
  words. Words are matched to dictionary entries, go into a list and are
  tagged with their `source` (the manga and panel), and the panel's
  sentence is saved with each word. Roughly $0.05 per panel. This is
  the first paid service, so it needs its own decision.

### Later

- **Listening** from YouTube clips, if feasible; otherwise keep it separate.
- **Grammar map**: one structure that ties grammar points together. It needs
  its own design pass before any code.

## Open questions

- Grading isn't obvious from the buttons alone (Mikita, 25 Oct). DESIGN.md now
  has a "Buttons and what they do" guide. In v0.2 step 5, should the app show
  a one-line hint under the grade buttons, or the next interval on each button
  the way Anki does?
- A hint system for review cards (beyond the page hint and furigana), asked
  for on 25 Oct as a future improvement: what hints, and what they cost.
- Should the N5/N4 kanji lists be editable in bulk, or are "Also known" and
  "Still learning" enough?
- `NEW_PER_DAY` is fixed at 20 (now shared between lists by weight). In v0.2
  step 5 it becomes a setting: one total, or a number per list?
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
