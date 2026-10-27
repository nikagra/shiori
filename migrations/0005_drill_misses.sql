-- Drill misses per word and direction, for each step of the page drill.
-- Step 2 (shuffled, no cue) sets how each card starts review.
ALTER TABLE page_words ADD COLUMN ordered_misses_jp_en INTEGER NOT NULL DEFAULT 0;
ALTER TABLE page_words ADD COLUMN ordered_misses_en_jp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE page_words ADD COLUMN shuffled_misses_jp_en INTEGER NOT NULL DEFAULT 0;
ALTER TABLE page_words ADD COLUMN shuffled_misses_en_jp INTEGER NOT NULL DEFAULT 0;
