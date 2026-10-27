-- Leeches: a word whose card lapses LEECH_LAPSES (4) times leaves review until
-- you act on it. A card's lapse_base is its lapse count when the word was last
-- let back in, so it isn't flagged again on the next lapse. hook is your own
-- memory hook.
ALTER TABLE words ADD COLUMN leech_at TEXT;
ALTER TABLE words ADD COLUMN hook TEXT;
ALTER TABLE cards ADD COLUMN lapse_base INTEGER NOT NULL DEFAULT 0;

-- Words in review that already lapsed that often are leeches from now on.
UPDATE words SET leech_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE status = 'graduated' AND id IN (SELECT word_id FROM cards WHERE lapses >= 4);
