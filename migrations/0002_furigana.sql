-- Settings that describe you rather than the device, shared by phone and laptop.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Each time you peeked at furigana over a kanji you're meant to know.
-- Cleared (not deleted) when you mark the kanji known again, so the history
-- can later feed kanji cards.
CREATE TABLE kanji_hints (
  id INTEGER PRIMARY KEY,
  kanji TEXT NOT NULL,
  word_id INTEGER NOT NULL REFERENCES words (id),
  cleared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX kanji_hints_kanji ON kanji_hints (kanji, cleared);
