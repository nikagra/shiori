# Shiori plan

Where the project stands and what comes next. Start here when picking the work
back up. For how the app works, see [DESIGN.md](DESIGN.md).

## Status (2026-10-27)

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
- Tests: 166 unit tests, 70 end-to-end runs (35 tests at iPhone and laptop
  sizes), and `tsc -b` all pass.
- **Backup and export** (26 Oct): Settings › Backup downloads all study data as
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
  Today's new review cards are shared by weight. Older backups still load
  and get their lists. See "Lists" in DESIGN.md. After pulling on the laptop,
  run `npm run db:migrate:local`; the deploy applies it to D1.
- **Settings** (26 Oct): a Settings tab replaces the Import tab and holds
  words per page, audio, furigana, links to Import (`#/settings/import`; old
  `#/import` links still work) and Lists, and Backup. Home keeps the tiles
  and the welcome note, plus a red warning when the nightly backup has
  stopped (it links to `#/settings/backup`). Pages shows the page size and
  links to Settings. No data or API changes.
- **Words you can see and change** (26 Oct): each list opens to its words
  (`#/lists/<id>`: the "See all N words" link on its card, or the word count
  of an archived list), with one search box for kana, romaji, kanji or
  meaning and filters by state (to check, waiting, on a page, learned, set
  aside). Tap a word to edit its kanji, kana and core
  meaning, move it to another list, set it aside (or bring it back), check it
  again, or delete it. A word on an unfinished page can only be edited. The
  search and filters (`shared/wordSearch.ts`, `WordFilter`) are ready for
  picking words into a page (step 3). No migration.
- **Pages you shape** (26 Oct): Pages › "Pick the words yourself" builds a
  page from words you pick in one list (waiting, or still to check), with the
  list's search box. On a page still in step 1, "Change words" swaps a word
  for the next waiting one or one you pick, takes it off or adds one; the
  word taken off goes back to waiting or is set aside. Words close in meaning
  are pointed out. Any page can be deleted: an unfinished page's words wait
  again, a learned page's words keep their reviews. No migration.
- **Dictionary** (27 Oct): English JMdict with per-kanji readings, in its
  own D1 database `shiori-dict` (created 27 Oct, id in `wrangler.jsonc`).
  "Add a word" (Home, or a list) searches it by kana, romaji, kanji or
  English and adds the word to a list, waiting for a page. Imported words
  are matched to entries (all 450 manga words match) without changing your
  meanings; a word with no match is flagged in the check pass, and a
  word's editor shows the dictionary's meanings and can pick another
  entry. Furigana go over each unknown kanji (冬眠: only 眠). Settings ›
  Dictionary shows what's loaded and the credits. Migration
  `0004_dictionary`. The **Dictionary** GitHub workflow fills the cloud
  dictionary over six nights (common words on the first); on the
  laptop, `npm run dict:download && npm run dict:build && npm run
  dict:load` loads all of it in a few minutes. See "Dictionary" in
  DESIGN.md.
- **Finish review, part 1** (27 Oct): a line under the grade buttons shows
  roughly when the word comes back ("~7d"), with a "How grading works" guide
  in Settings that can also turn the line off. The daily limit moved to where new words come from: Settings ›
  New words sets **new words a day** on pages (default 12, shared by
  devices), and Pages asks before starting more. The check pass's typing
  cards keep their own fixed 10 a day (was 20). No migration. The plan for
  the rest of step 5 is in the
  [plan doc](https://claude.ai/artifact/Q2JWAKtgYbekKkHi9yjNmZ), agreed
  with Mikita on 27 Oct.
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

- ~~See what's in a list, or find, edit or move a word.~~ Done in step 2.
- ~~Add one word.~~ Done in step 4 (from the dictionary).
- ~~Shape a page: drop a word with a similar meaning, pick the words yourself,
  or delete a page.~~ Done in step 3.
- Handle leeches, ~~show what each grade button does, or change the 20 new
  cards a day~~ (done in step 5, part 1).

## Next steps, in order

Done: v0.1 core loop (import, check pass, pages, FSRS review, audio,
furigana), deploy on merge, backup and export (26 Oct; check the first
nightly copy shows in Settings), lists you manage with their own pace (26 Oct;
try it on the iPhone: the Lists tab, then a page from School and one from
Manga), Settings (26 Oct), words you can see and change (26 Oct), pages you shape
(26 Oct), dictionary (27 Oct; after the merge, run the Dictionary workflow
once by hand or wait for the night, then try Add a word on the iPhone).

### v0.2: a complete word tool

1. ~~**Settings.**~~ Done (26 Oct): one Settings screen for audio,
   furigana, page size, backup and import, so Home, Pages, Review and Lists
   are only about studying. Later settings (new cards a day, step 5) go here.
2. ~~**Words you can see and change.**~~ Done (26 Oct). Each list opens to
   its words, with a search box (kana, romaji, kanji or meaning) and filters
   by state (to check, waiting, on a page, learned, set aside). Edit a
   word's kanji, kana and meaning, move it to another list, set it aside or
   delete it, and check it again. This is the "review and edit list contents after the
   check" feedback (26 Oct). "Check again" undoes a check pass answer while
   the word has no page and no real reviews; after that, Again in review is
   the way back.
3. ~~**Pages you shape**~~ Done (26 Oct; Mikita's feedback). Pick a
   page's words from a list with the same search box (words still to check
   too), swap or take off a word on a page in step 1 (the next waiting word
   or one you pick takes its place), and delete a page (unfinished: its words
   wait again; learned: they keep their reviews). Words close in meaning are
   pointed out while picking and on a new page.
4. ~~**Dictionary**~~ Done (27 Oct; Mikita, 26 Oct: simpler import and word
   search). JMdict (jmdict-simplified) and JmdictFurigana, CC BY-SA 4.0,
   credited in Settings; no Jisho API. A separate D1 database with FTS5,
   loaded in resumable chunks within the free plan's 100k row writes a day.
   Add a word by kana, romaji, kanji or English (replacing Renshuu's
   Reading Buddy step); imports are matched to entries, keeping your
   meanings (Mikita, 27 Oct: imported translations stay as they are, added
   words take the dictionary's); words with no match are flagged in the
   check pass and their entry can be picked in the word's editor; furigana
   per kanji and "usually written in kana". Later: example sentences
   (v0.3) and kanji info (KANJIDIC) come from the same sources.
5. **Finish review.** Plan agreed with Mikita (27 Oct,
   [plan doc](https://claude.ai/artifact/Q2JWAKtgYbekKkHi9yjNmZ)), in three
   PRs: (1) grade intervals and new words a day, done; (2) drill misses that
   count: type the kana after a miss, the retry comes after at least 5 other
   cards (with fillers near the end), and step 2 misses start a card at Hard
   (one miss) or Again (two or more), per direction; the drill is kept on the
   device across Stop; (3) leeches: 4 lapses take a word out of review until
   you put it on a fresh page, write a memory hook, edit it or set it aside.
   - Why drill misses (Mikita, 26 Oct): Renshuu repeats a missed question
     until you get it right, so you answer from short-term memory without
     learning the word. Today `answerStep` in `shared/pageSession.ts` does
     the same, and the drill's `misses` are dropped when the page
     graduates.
   - Why leeches: the same problem in review, a word that isn't being
     learned, so the fix is more effort, not another look. A leech is
     listed in its list's words (step 2). `LEECH_LAPSES` in
     `shared/scheduler.ts` (6, unused) becomes 4.
   - ~~What each grade does, shown in the app.~~ Done: intervals on the
     buttons and a guide in Settings.
   - ~~New cards a day as a setting.~~ Done: new words a day, for pages.
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

- A hint system for review cards (beyond the page hint and furigana), asked
  for on 25 Oct as a future improvement: what hints, and what they cost.
- Should the N5/N4 kanji lists be editable in bulk, or are "Also known" and
  "Still learning" enough?
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
