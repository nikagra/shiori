-- Leeches: a word whose card lapses LEECH_LAPSES (4) times leaves review until
-- you act on it. leech_base is the lapse count it was last let back in at, so
-- it isn't flagged again on the next lapse. hook is your own memory hook.
ALTER TABLE words ADD COLUMN leech_at TEXT;
ALTER TABLE words ADD COLUMN leech_base INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN hook TEXT;

-- Words that already lapsed that often are leeches from now on.
UPDATE words SET leech_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE status = 'graduated' AND id IN (SELECT word_id FROM cards WHERE lapses >= 4);
