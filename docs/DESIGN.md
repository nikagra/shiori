# Shiori design

How Shiori works and why. For where the project stands and what comes next,
see [PLAN.md](PLAN.md).

## Goal

A personal Japanese app for one learner moving from N5 to N4 (kanji around
N4). It covers two things:

1. **Vocabulary**: words learned on small, fixed pages, where a word's position
   and its neighbours act as memory anchors. Spaced retrieval then keeps them
   alive. Words come from manga, books, school and Renshuu.
2. **Grammar map** (not built yet): one coherent structure for grammar points
   that were learned in isolation.

## Principles

- **Study vectors stay separate** (an idea taken from Renshuu). Vocabulary
  grades measure vocabulary only. Not being able to read a kanji is a kanji
  problem, so a furigana peek counts against that kanji, not against the
  word's grade.
- **Honest grading.** Help lowers the grade it can earn. Peeking at the page
  grid during review caps the grade at Hard. Typed kana answers are checked,
  and a typo can be counted as correct only by an explicit tap.
- **Position is a cue that fades on purpose.** A page is drilled in grid order
  first, then shuffled, then left to FSRS.
- **Phone first.** The app is installable to the iPhone home screen and works
  with the Japanese keyboard. A laptop works too.
- **No paid services.** Audio uses the device's own Japanese voices.

## The learning loop

```
Renshuu export ─► import (unverified)
                   │
                   ▼
        Check pass: one recall per word
          │ knew it               │ didn't
          ▼                       ▼
     FSRS review            inbox ─► page (10/12/15 words, 3-column grid)
                                       │ step 1: grid order, jp→en then en→jp
                                       │ step 2: shuffled, positions only
                                       ▼
                                  graduated ─► FSRS review (first one next day)
```

### Import (`shared/renshuu.ts`)

The app parses both Renshuu export formats: Basic (`漢字/かな - meanings`) and
Custom (all fields, with POS and mastery). Words are deduplicated on
`(kana, kanji)`. In the Custom format, a mastery of `--` or `255` counts as
unknown. Every imported word starts as `unverified`.

### Check pass (Triage screen)

Each imported word gets one recall attempt. "From list" picks one list to
check (remembered on the device), or all lists by priority: a focused list
first, then by weight, paused lists last (`triageNext`). Within a list, words
with the lowest Renshuu mastery come first; words with unknown mastery sit in
the middle. "I knew it" sends the word to review. Otherwise the word goes to
the inbox, where it waits for a page. When the chosen list is done, the check
moves on to all lists.

### Lists (`shared/lists.ts`, Lists screen)

Every word belongs to one list, picked at import. The app starts with Manga,
Books, School and Other; Lists adds, renames, merges, archives and deletes
them (only a list with no words at all, set-aside ones included, can be
deleted). Names are unique, ignoring the case of Latin letters.
`words.source_list` keeps the name the word was imported under, as history.

Each list has its own pace:

| Setting | What it does |
|---|---|
| Weight (Low 1, Normal 2, High 4) | The list's share of new pages and of today's new review cards |
| Weekly target (optional, pages a week) | Until it's met (pages started in the last 7 days), "Pick for me" takes this list first |
| Pause | No new pages from "Pick for me" and no new review cards. You can still start a page from it by hand |
| Focus until a date | Before a test: "Pick for me" takes this list first, and its weight counts `FOCUS_BOOST` (3) times for new cards. One list at a time; it ends by itself after the date |
| Archive | No new pages (not even by hand) and no new review cards. Hidden from import and the check pass, and its words to check or waiting leave the counts on Home. Its learned words still come up for review |

- **One list per page**, so the word group stays a clean memory anchor
  (a learned word moved to another list later leaves its page as it was). "New
  page" asks which list. "Pick for me" (`pickList`) takes a focused list
  first, then the list furthest behind its weekly target, then the list with
  the fewest pages in the last 28 days for its weight.
- **New review cards** (`shareNewCards`): today's `NEW_PER_DAY` (20) are
  handed out one at a time to the list furthest below its share (cards so far
  today ÷ weight). A list that runs out of new cards passes its share on, so
  the budget isn't wasted.
- **Due reviews always come**, from every list, paused and archived ones too.
  FSRS stays per card: memory doesn't care which list a word came from.

### A list's words (`shared/wordSearch.ts`, ListWords, WordFilter)

Each list opens to its words (`#/lists/<id>`), in the order they came in.

- **Search**: one box for kana, romaji, kanji or meaning. Katakana and
  hiragana match each other. Kana or kanji match the written form and the
  reading. Latin letters are first a meaning (the core meaning, then the
  other senses, whole words first) and then romaji, because English often
  reads as kana too ("home" is ほめ, "cat" starts か): only a reading that is
  exactly the romaji comes before the meanings. Unfinished romaji matches
  the start of a reading: "tab" finds たべる, and "kan" finds かな as well
  as かんじ.
- **Filters** by state: to check, waiting, on a page, learned, set aside.
- **Edit** the kanji, kana (romaji turns into kana) and core meaning. The
  imported senses stay. Kanji and kana must stay unique across all lists.
- **Move** to another list, **set aside** (out of the check pass, pages and
  review; cards and history kept), **bring back** (to review if it has
  cards, otherwise to the check pass) and **delete** (with its cards,
  reviews and furigana peeks; a learned page keeps its other words).
- **Check again** undoes a check pass answer: its cards and the check's log
  row go, and the word is unchecked. Only while it has no page and no real
  reviews; after that, Again in review is the honest way back.
- A word on an unfinished page can only be edited, so the page keeps its
  words and its one list. A learned word can move: its learned page stays
  in its old list, as history.

### Pages (`shared/pageSession.ts`, PageView, PageGrid)

- A new page takes 10, 12 or 15 words (`PAGE_SIZES`), all from one list
  (fewer if that list has fewer waiting). The size is a per-device setting
  and defaults to 12. A page you shape can hold fewer, and adding words
  stops at the page size on this device (`MAX_PAGE_WORDS`, 20, on the
  server; a page doesn't store its size).
- The grid always has 3 columns and looks the same on phone and laptop.
- Stage `ordered`: every word in grid order, Japanese→meaning, then
  meaning→Japanese.
- Stage `shuffled`: the same steps mixed together, with only grid positions
  shown.
- A missed step goes to the back of the queue until it's answered correctly.
- Graduating a page counts as one Good review per card. The first real review
  is scheduled for the next day at the latest (`graduate`).

### Pages you shape (PagePicker, PageView, `shared/similar.ts`)

- **Pick the words** (`#/pages/new`, or `#/pages/new/<list>`): the list's
  search box and filters, over its waiting words and then its words still to
  check (picking one says you don't know it yet, the same as "I didn't know").
  Up to the page size, from one list, in the order you pick them.
- **Change words** on a page still in step 1: swap a word for the list's next
  waiting word or one you pick (it takes the same spot), take it off without
  a replacement (the others close up), or add one at the end. The word taken
  off goes back to waiting, or is set aside. Step 2 has drilled the page, so
  its words stay.
- **Close in meaning**: words whose core meanings share a meaning word
  (fillers like "to", "be", "something" don't count) are pointed out while
  you pick and on a page in step 1, since they compete for the same spot in
  memory.
- **Delete a page**: an unfinished page's words go back to waiting. A learned
  page's words keep their cards and review history; only the page goes, so
  review can't show it any more. Page numbers aren't reused, except that the
  newest page's number comes back if it's deleted.
- Every change is one D1 batch guarded on what was checked. A word put on
  the page that changed meanwhile (set aside or put on another page on the
  other device) fails the batch. A swap puts the new word in the old one's
  spot wherever it is now, an add goes at the end of the page as it is now,
  and a word already taken off (or moved) on the other device changes
  nothing ("reload and try again").

### Review (`shared/scheduler.ts`, `shared/queue.ts`)

- FSRS via ts-fsrs with desired retention 0.9. Short-term steps are off,
  because same-day practice happens on pages. Fuzz is on.
- Each word has two cards: `jp_en` (recognise) and `en_jp` (produce, answered
  by typing kana; on a laptop, romaji is turned into kana with WanaKana).
- Only one card per word per day, so answering one direction never gives away
  the other. Due cards come first, most overdue first, then up to
  `NEW_PER_DAY` (20) new cards, shared between lists by weight (see Lists).
- A peek at the word's page caps the grade at Hard.
- The core meaning can be edited from the answer. `senses` keeps the full
  dictionary list.
- Optional listening practice: Japanese→meaning cards are heard before they're
  shown.

### Furigana (`shared/furigana.ts`, `src/furigana.ts`)

- Known kanji are the N5+N4 lists (or N5 only, or none), plus "Also known",
  minus "Still learning". The lists are the common unofficial JLPT ones.
- Furigana are shown only over kanji runs that contain an unknown kanji. The
  reading is lined up with the written form around okurigana (食べ物 → 食(た)
  べ 物(もの)). If the reading can't be lined up, it goes over the whole word.
- On a question, "Show furigana" (shortcut F) reveals the hidden readings. Each
  peek is logged against those kanji in `kanji_hints`, not against the word's
  grade. After `HINTS_TO_LEARNING` (2) peeks, a kanji moves to Still learning.
  Taking it off that list clears its count; the rows are kept as history for
  future kanji cards.
- Furigana settings are stored on the server, so the phone and the laptop
  agree. Audio and page size stay per device, in localStorage. All of them
  are on the Settings screen, which says which kind each one is.

## Buttons and what they do

A guide for the learner. Only **Review** changes when you see a word again.
The check pass and the page drill decide where a word goes, but your answers
there never change review dates.

### Check pass (imported words)

Say the meaning to yourself first, then tap **Show answer**.

| Button | Use it when | What happens |
|---|---|---|
| I knew it | The meaning came right away, without guessing | The word goes to review. Japanese → meaning counts as one Good review. Meaning → Japanese becomes a new card, because you haven't produced the word yet. |
| I didn't know | Anything less than that | The word goes to the inbox and waits for a page |
| Not worth learning — remove it | You don't want this word | The word is set aside and never shown again |

If you aren't sure, choose "I didn't know". A page costs a few minutes. A
falsely "known" word fails in review, and that does more harm.

### Page drill

| Button | What happens |
|---|---|
| Show answer (Space) | Reveals the meaning or reading |
| Don't know yet (1) | Shows the answer and counts the step as missed |
| Missed (1) / Got it (2) | Missed puts the step at the back of the queue. Got it removes it. |
| Study the page again | Counts the current step as missed and goes back to the full page; the drill continues afterwards |

Misses only make the drill longer. Nothing about them reaches FSRS. When both
steps are done, the page graduates: each card counts as one Good review, and
the first real review comes the next day.

### Review

Answer first:

- **Japanese → meaning:** say the meaning, then tap **Show answer**.
- **Meaning → Japanese:** type the kana. The app checks it.

Then grade how the recall felt:

| Grade | Choose it when | Effect on the card |
|---|---|---|
| **Again** (1) | You didn't recall it, or you recalled it wrongly | Counts as a lapse. Stability drops sharply, so the word comes back in about a day, and difficulty rises a lot. |
| **Hard** (2) | You recalled it, but slowly, with effort, or unsure | A pass. The interval is shorter than Good, and difficulty rises a little. |
| **Good** (3) | You recalled it normally | The normal choice for a correct answer. The interval grows, and difficulty eases slightly. |
| **Easy** (4) | Instant and effortless, and you'd be fine seeing it much later | A pass with a much longer interval. Difficulty drops a lot. |

The app limits some choices:

- **Don't know (1):** shows the answer and leaves only Again.
- **Wrong typed answer:** leaves only Again. "It was a typo — count it as correct" unlocks the other grades.
- **"Where did I learn this?" (page hint):** caps the grade at Hard.
- **"Show furigana" (F):** doesn't limit the grade. The peek counts against the kanji instead.

**Rules of thumb**

- **Good is the default for a correct answer.** Most correct answers should be
  Good.
- **Hard means correct but effortful.** It isn't a softer Again. If you didn't
  recall the word, press Again.
- **Use Easy rarely.** It pushes the word far away, and an Easy you didn't
  deserve costs a forgotten word later.
- **Be honest rather than kind.** Grading Good on a guess makes FSRS think you
  know the word, and the word disappears for weeks. Again only brings it back
  sooner.

**Example intervals.** These come from the current settings (retention 0.9,
default FSRS weights). The app adds a little random jitter, so real dates vary
by a day or so.

| Situation | Again | Hard | Good | Easy |
|---|---|---|---|---|
| First review the day after a page | 1 day | 5 days | 7 days | 12 days |
| Well-known word, stability around 4 months | 4 days | ~9 months | ~12 months | ~20 months |

On a well-known word, Again costs a lot: about 4 months of stability drops to
about 4 days, and the higher difficulty slows its growth afterwards. That's
why an honest Again early on is cheaper than a lucky Good.

## Backup and restore (`shared/backup.ts`, `worker/backup.ts`)

- **The file.** One JSON file holds every row of every table (`lists`,
  `words`, `pages`, `page_words`, `cards`, `review_log`, `settings`,
  `kanji_hints`), read in one
  D1 batch so it's consistent. It records the format version and the latest
  migration it fits (`BACKUP_SCHEMA`); a unit test fails when a new migration
  or table isn't reflected there.
- **Download.** Settings › Backup › Download backup saves
  `shiori-backup-YYYY-MM-DD.json` from `GET /api/backup`. The app checks the
  file before saving it, so an error or a Cloudflare Access sign-in page is
  reported instead of being saved as a backup.
- **Nightly copy.** A cron trigger (03:30 UTC, `wrangler.jsonc`) saves the same
  file to the private R2 bucket `shiori-backups` as
  `nightly/shiori-backup-YYYY-MM-DD.json` and deletes copies older than
  `KEEP_DAYS` (30) days, so a missed night leaves a gap. Settings › Backup
  shows when the last one was saved, and turns red when it's more than a day
  and a half old, because that means the nightly runs are failing (see the
  Worker logs). Home then shows a red warning too, so it isn't missed. Until
  the first copy exists it can't tell a failing run from one that hasn't
  happened yet, so check Settings the morning after a deploy that touches this.
  The bucket must exist before a deploy:
  `npx wrangler r2 bucket create shiori-backups`.
- **Time Travel.** D1 also keeps its own point-in-time history (7 days on the
  free plan, 30 on paid), which is the quickest undo while the database exists.
  The files are for everything else: a deleted database, a lost account, or
  keeping a copy off Cloudflare.

**Restoring from a file**

1. Get a file: download one, or fetch a nightly copy with
   `npx wrangler r2 object get shiori-backups/nightly/shiori-backup-2026-10-25.json --remote --file backup.json`.
2. Turn it into SQL: `npm run backup:sql -- backup.json --replace > restore.sql`.
   `--replace` deletes the rows already in the database first; leave it out
   for an empty one.
3. If the database is gone, create it again (`npx wrangler d1 create shiori`,
   put the new id in `wrangler.jsonc`) and apply the migrations
   (`npx wrangler d1 migrations apply shiori --remote`).
4. Load it: `npx wrangler d1 execute shiori --remote --file restore.sql`.

The script checks the backup's schema against `migrations/`: it refuses a
backup from code newer than the checkout, and notes an older one. An older
backup still loads: each INSERT names its columns, so new columns take their
defaults, and a table added after the backup (`TABLE_SINCE`) starts empty.
A backup from before lists gets them the way the lists migration made them
(`LISTS_FROM_LABELS`): the starting lists plus one per import label, each word
on its label's list and each page on its words' list. A current backup
replaces the starting lists with its own.
If a `--replace` load fails partway, fix the cause and run the same file
again (its deletes come first), or rewind with Time Travel.

## Architecture

| Part | Where | Notes |
|---|---|---|
| UI | `src/` (React 19, Vite) | Screens: Home, Triage (Check), Pages, PagePicker, PageView, Lists (with ListWords under it), Review, Settings (with Import under it) |
| Shared logic | `shared/` | Pure TypeScript used by both UI and worker; unit tested |
| API | `worker/index.ts` (Hono on Cloudflare Workers) | Under `/api/*`; the rest is the single-page app. Also the nightly cron (`scheduled`) |
| Data access | `worker/db.ts` | Multi-row changes run as one D1 batch, so a failed or repeated request can't leave half-done state |
| Database | D1 (SQLite), `migrations/` | `0001_init.sql`, `0002_furigana.sql`, `0003_lists.sql` |
| Backups | R2 bucket `shiori-backups` | Nightly JSON copies, 30 days (`worker/backup.ts`) |

### Data model

- `lists`: name, `weight`, `pages_per_week`, `paused`, `focus_until`,
  `archived_at`.
- `words`: kana, kanji, `senses` (JSON), `core_meaning`, pos, source,
  `source_list` (the import label), `list_id`, `source_order`,
  `renshuu_mastery`, `status` (`unverified` → `inbox` → `on_page` →
  `graduated`, or `ignored`).
- `pages` and `page_words`: page number, stage, `list_id`, and each word's
  fixed position.
- `cards`: one per word and direction, with the full FSRS state as JSON plus
  `due` / `state` / `lapses` for queries.
- `review_log`: every review, triage and graduation, with the hint flag, typed
  answer and duration. This is enough to refit FSRS parameters later.
- `settings`: key-value pairs for settings that describe the learner
  (furigana).
- `kanji_hints`: one row per furigana peek, per kanji.

## Development and testing

- `npm run dev -- --host` serves the app and the API on port 5173, with local
  D1 in `.wrangler/state`.
- `npm test` runs Vitest over `test/`: pure logic and the database layer
  against a local D1.
- `npm run test:e2e` runs Playwright at iPhone and laptop sizes, on port 5174
  with its own database (and R2 copies) in `.wrangler/e2e`. The test-only
  endpoints (`/api/test/reset`, `/api/test/make-due`, `/api/test/nightly`)
  are on only for that server. Never point the end-to-end tests at
  `.wrangler/state`: an early run wiped real study data that way.
- Commits end their subject line with an emoji that fits the change.
