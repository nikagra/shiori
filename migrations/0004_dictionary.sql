-- Each word's link to the dictionary (the separate shiori-dict database).
-- dict_seq is JMdict's entry number, which stays the same across dictionary
-- versions. dict_checked is how many dictionary chunks were loaded when the
-- word was last looked up (NULL: not yet; 1000000: an entry you chose), so a
-- word with no match is looked up again as the dictionary fills.
ALTER TABLE words ADD COLUMN dict_seq INTEGER;
ALTER TABLE words ADD COLUMN dict_checked INTEGER;
-- Readings per kanji from the dictionary, as JSON [[text, reading?], ...].
ALTER TABLE words ADD COLUMN furigana TEXT;
-- The dictionary says it's usually written in kana.
ALTER TABLE words ADD COLUMN usually_kana INTEGER NOT NULL DEFAULT 0;
