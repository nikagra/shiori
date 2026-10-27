-- The dictionary database (binding DICT, database shiori-dict): JMdict
-- entries for search and for matching your words. It holds no study data, so
-- it can be dropped and loaded again any time (scripts/dict-load.ts).

-- One row per entry, as JSON (shared/dictEntry.ts DictEntry). The id is the
-- search order: common words first. seq is JMdict's own entry number, which
-- stays the same across dictionary versions; words store that.
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);

-- Full-text search over written forms and readings, meanings, and seq (so an
-- entry is found by its number without a second index, which would cost a
-- row write per entry on load). Contentless: the text lives in entries.
CREATE VIRTUAL TABLE entries_fts USING fts5(
  forms, glosses, seq,
  content = '', contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- What has been loaded: the version, the number of chunks, and one row per
-- chunk loaded, so a load can stop and carry on another day.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
