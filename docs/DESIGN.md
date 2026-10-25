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

Each imported word gets one recall attempt. Words with the lowest Renshuu
mastery come first; words with unknown mastery sit in the middle
(`triageOrder`). "I knew it" sends the word to review. Otherwise the word goes
to the inbox, where it waits for a page.

### Pages (`shared/pageSession.ts`, PageView, PageGrid)

- Each page has a fixed size of 10, 12 or 15 words (`PAGE_SIZES`). The size is
  a per-device setting and defaults to 12.
- The grid always has 3 columns and looks the same on phone and laptop.
- Stage `ordered`: every word in grid order, Japanese→meaning, then
  meaning→Japanese.
- Stage `shuffled`: the same steps mixed together, with only grid positions
  shown.
- A missed step goes to the back of the queue until it's answered correctly.
- Graduating a page counts as one Good review per card. The first real review
  is scheduled for the next day at the latest (`graduate`).

### Review (`shared/scheduler.ts`, `shared/queue.ts`)

- FSRS via ts-fsrs with desired retention 0.9. Short-term steps are off,
  because same-day practice happens on pages. Fuzz is on.
- Each word has two cards: `jp_en` (recognise) and `en_jp` (produce, answered
  by typing kana; on a laptop, romaji is turned into kana with WanaKana).
- Only one card per word per day, so answering one direction never gives away
  the other. Due cards come first, most overdue first, then up to
  `NEW_PER_DAY` (20) new cards.
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
  agree. Audio and page size stay per device, in localStorage.

## Architecture

| Part | Where | Notes |
|---|---|---|
| UI | `src/` (React 19, Vite) | Screens: Home, Import, Triage (Check), Pages, PageView, Review |
| Shared logic | `shared/` | Pure TypeScript used by both UI and worker; unit tested |
| API | `worker/index.ts` (Hono on Cloudflare Workers) | Under `/api/*`; the rest is the single-page app |
| Data access | `worker/db.ts` | Multi-row changes run as one D1 batch, so a failed or repeated request can't leave half-done state |
| Database | D1 (SQLite), `migrations/` | `0001_init.sql`, `0002_furigana.sql` |

### Data model

- `words`: kana, kanji, `senses` (JSON), `core_meaning`, pos, source,
  `source_list`, `source_order`, `renshuu_mastery`, `status` (`unverified` →
  `inbox` → `on_page` → `graduated`, or `ignored`).
- `pages` and `page_words`: page number, stage, and each word's fixed
  position.
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
  with its own database in `.wrangler/e2e`. The test-only endpoints
  (`/api/test/reset`, `/api/test/make-due`) are on only for that server. Never
  point the end-to-end tests at `.wrangler/state`: an early run wiped real
  study data that way.
- Commits end their subject line with an emoji that fits the change.
