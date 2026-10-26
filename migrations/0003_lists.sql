-- Lists you manage. A word belongs to one list and a page holds words from
-- one list. Each list has its own share of new cards and of new pages.
CREATE TABLE lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  weight INTEGER NOT NULL DEFAULT 2,     -- share of new cards and pages (1 low, 2 normal, 4 high)
  pages_per_week INTEGER,                -- optional target: new pages come from it first until met
  paused INTEGER NOT NULL DEFAULT 0,     -- no new pages or new cards; due reviews still come
  focus_until TEXT,                      -- boosted until this time (one list at a time)
  archived_at TEXT,                      -- hidden from import, check and new pages; reviews still come
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE words ADD COLUMN list_id INTEGER REFERENCES lists (id);
ALTER TABLE pages ADD COLUMN list_id INTEGER REFERENCES lists (id);
CREATE INDEX words_list ON words (list_id, status, source_order);

-- The starting lists, then one for every other label words were imported
-- with, then each word and page moves to its list. A page takes the list most
-- of its words share. shared/backup.ts runs the same SQL after loading a
-- backup from before this migration.
INSERT OR IGNORE INTO lists (name, created_at, updated_at) VALUES
  ('Manga', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Books', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('School', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Other', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO lists (name, created_at, updated_at)
  SELECT TRIM(source_list), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM words WHERE TRIM(IFNULL(source_list, '')) != '' GROUP BY TRIM(source_list) ORDER BY MIN(source_order);
UPDATE words SET list_id = (SELECT id FROM lists WHERE name = IFNULL(NULLIF(TRIM(words.source_list), ''), 'Other'))
  WHERE list_id IS NULL;
UPDATE pages SET list_id = (
    SELECT w.list_id FROM page_words pw JOIN words w ON w.id = pw.word_id
    WHERE pw.page_id = pages.id GROUP BY w.list_id ORDER BY COUNT(*) DESC, MIN(pw.position) LIMIT 1
  ) WHERE list_id IS NULL;
