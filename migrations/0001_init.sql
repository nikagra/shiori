-- Shiori v0.1 schema

CREATE TABLE words (
  id INTEGER PRIMARY KEY,
  kana TEXT NOT NULL,
  kanji TEXT,
  senses TEXT NOT NULL,              -- JSON array of sense strings
  core_meaning TEXT NOT NULL,
  pos TEXT,
  source TEXT NOT NULL,              -- 'renshuu', later 'capture', ...
  source_list TEXT,                  -- e.g. 'manga', 'school'
  source_order INTEGER NOT NULL,     -- keeps words from one source together
  renshuu_mastery INTEGER,           -- 0..100, NULL when unknown
  status TEXT NOT NULL CHECK (status IN ('unverified', 'inbox', 'on_page', 'graduated', 'ignored')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX words_identity ON words (kana, IFNULL(kanji, ''));
CREATE INDEX words_status ON words (status, source_order);

CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  stage TEXT NOT NULL CHECK (stage IN ('ordered', 'shuffled', 'graduated')),
  created_at TEXT NOT NULL,
  graduated_at TEXT
);

CREATE TABLE page_words (
  page_id INTEGER NOT NULL REFERENCES pages (id),
  word_id INTEGER NOT NULL UNIQUE REFERENCES words (id),
  position INTEGER NOT NULL,
  PRIMARY KEY (page_id, position)
);

CREATE TABLE cards (
  id INTEGER PRIMARY KEY,
  word_id INTEGER NOT NULL REFERENCES words (id),
  direction TEXT NOT NULL CHECK (direction IN ('jp_en', 'en_jp')),
  due TEXT NOT NULL,
  state INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  fsrs TEXT NOT NULL,                -- full FSRS card as JSON
  created_at TEXT NOT NULL,
  UNIQUE (word_id, direction)
);
CREATE INDEX cards_due ON cards (due);

CREATE TABLE review_log (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards (id),
  word_id INTEGER NOT NULL REFERENCES words (id),
  kind TEXT NOT NULL CHECK (kind IN ('review', 'triage', 'graduation')),
  rating INTEGER NOT NULL,
  state_before INTEGER NOT NULL,
  hint_used INTEGER NOT NULL DEFAULT 0,
  answer TEXT,
  correct INTEGER,
  duration_ms INTEGER,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX review_log_time ON review_log (reviewed_at);
