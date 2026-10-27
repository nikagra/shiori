import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  chunkSql,
  dictInfo,
  entryCoreMeaning,
  headPair,
  indexText,
  matchWord,
  pairs,
  posLabel,
  searchSteps,
  senseStrings,
  sensesFor,
  toChunks,
  toEntry,
  toRuby,
  usuallyKana,
  type DictEntry,
  type JmdictWord,
} from '../shared/dictionary';
import { furigana, hiddenKanji, readingParts } from '../shared/furigana';
import { parseRenshuuExport } from '../shared/renshuu';
import * as repo from '../worker/db';
import { dictStatus, entryBySeq, lookUpWords, matchWords, searchDict } from '../worker/dict';
import { createDictDb, createTestDb } from './d1';

const sample = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'dict_sample.json'), 'utf8')) as { version: string; entries: DictEntry[] };
const bySeq = (seq: number) => sample.entries.find((e) => e.seq === seq)!;
const TABERU = 1358280;
const HIYOKO = 1373400;
const now = new Date('2026-10-27T10:00:00Z');

describe('building entries', () => {
  const word: JmdictWord = {
    id: '1373400',
    kanji: [
      { common: true, text: '雛', tags: [] },
      { common: false, text: 'ひよっ子', tags: ['sK'] },
    ],
    kana: [
      { common: true, text: 'ひよこ', tags: [], appliesToKanji: ['*'] },
      { common: false, text: 'ヒヨコ', tags: [], appliesToKanji: [] },
    ],
    sense: [{ partOfSpeech: ['n'], appliesToKanji: ['*'], appliesToKana: ['*'], misc: ['uk'], info: [], gloss: [{ lang: 'eng', text: 'chick' }] }],
  };

  it('keeps what the app needs, and readings that go with no kanji', () => {
    const e = toEntry(word, (w, r) => (w === '雛' && r === 'ひよこ' ? [['雛', 'ひよこ']] : undefined));
    expect(e).toEqual({
      seq: 1373400,
      common: true,
      kanji: [{ text: '雛', common: true }, { text: 'ひよっ子', tags: ['sK'] }],
      kana: [{ text: 'ひよこ', common: true }, { text: 'ヒヨコ', kanji: [] }],
      senses: [{ pos: ['n'], gloss: ['chick'], misc: ['uk'] }],
      furigana: { '雛|ひよこ': [['雛', 'ひよこ']] },
    });
    // Search-only forms are left out of what's shown; ヒヨコ is kana only.
    expect(pairs(e)).toEqual([
      ['雛', 'ひよこ'],
      [null, 'ヒヨコ'],
    ]);
    expect(pairs(e, true)).toContainEqual(['ひよっ子', 'ひよこ']);
    expect(usuallyKana(e, '雛', 'ひよこ')).toBe(true);
  });

  it('merges kana in JmdictFurigana segments', () => {
    expect(toRuby({ text: '見知らぬ', reading: 'みしらぬ', furigana: [{ ruby: '見', rt: 'み' }, { ruby: '知', rt: 'し' }, { ruby: 'ら' }, { ruby: 'ぬ' }] })).toEqual([
      ['見', 'み'],
      ['知', 'し'],
      ['らぬ'],
    ]);
  });

  it('indexes every form and meaning', () => {
    expect(indexText(bySeq(TABERU))).toEqual({ forms: '食べる 喰べる たべる', glosses: expect.stringContaining('to eat ; to live on') });
  });

  it('puts common words first and makes SQL that can run twice', () => {
    const chunks = toChunks(sample.entries, 30);
    expect(chunks.map((c) => c.name)).toEqual(['0001', '0002', '0003']);
    expect(chunks[0].entries.every((e) => e.common)).toBe(true);
    expect(chunks.at(-1)!.entries.at(-1)!.common).toBe(false);
    const sql = chunkSql(chunks[1], 'v1', 3);
    expect(sql.startsWith('DELETE FROM entries_fts WHERE rowid BETWEEN 31 AND 60;')).toBe(true);
    expect(sql.trimEnd().endsWith(`('loaded:0002', '30');`)).toBe(true);
  });

  it('indexes full-width forms as typed too', () => {
    const shirt: DictEntry = { seq: 9, common: true, kanji: [{ text: 'Ｔシャツ' }], kana: [{ text: 'ティーシャツ' }], senses: [{ pos: ['n'], gloss: ['T-shirt'] }] };
    expect(indexText(shirt).forms.split(' ')).toEqual(expect.arrayContaining(['Ｔシャツ', 'Tシャツ', 'ティーシャツ']));
  });

  it('reads parts of speech and a first meaning', () => {
    const e = bySeq(TABERU);
    expect(posLabel(e.senses[0].pos)).toBe('Ichidan verb · transitive');
    expect(entryCoreMeaning(e.senses)).toBe('to eat');
    expect(senseStrings(e.senses)[1]).toBe('to live on (e.g. a salary), to live off, to subsist on');
    expect(headPair(bySeq(HIYOKO))).toEqual(['雛', 'ひよこ']);
  });
});

describe('search steps', () => {
  it('reads kana as hiragana and katakana, and kanji as written', () => {
    expect(searchSteps('てれび')).toEqual(['forms : ("てれび"* OR "テレビ"*)']);
    expect(searchSteps('食べ')).toEqual(['forms : ("食べ"* OR "食ベ"*)']);
    // Letters with kana are a written form, full-width or not.
    expect(searchSteps('Ｔシャツ')).toEqual(searchSteps('Tシャツ'));
    expect(searchSteps('Tシャツ')[0]).toMatch(/^forms : /);
  });

  it('reads Latin letters as romaji and as English', () => {
    expect(searchSteps('taberu')).toEqual([
      'forms : ("たべる" OR "タベル")',
      'glosses : ("taberu" OR "to taberu")',
      'glosses : ("taberu"*)',
      'forms : ("たべる"* OR "タベル"*)',
    ]);
    // Several words: English only. The phrase first (as a verb too), then
    // every word, the last one unfinished when it's long enough.
    expect(searchSteps('to ea')).toEqual(['glosses : ("to ea")', 'glosses : ("to" "ea")']);
    expect(searchSteps('cat')).toEqual(['glosses : ("cat" OR "to cat")', 'glosses : ("cat"*)']);
  });

  it('quotes what it is given, so nothing typed breaks the query', () => {
    expect(searchSteps('"eat')).toEqual(['glosses : ("eat" OR "to eat")', 'glosses : ("eat"*)']);
    expect(searchSteps('  ')).toEqual([]);
    expect(searchSteps('!!')).toEqual([]);
  });
});

describe('matching your words', () => {
  const m = (kanji: string | null, kana: string, senses: string[] = []) => matchWord({ kanji, kana, senses }, sample.entries);

  it('matches the written form and reading', () => {
    expect(m('食べる', 'たべる')?.entry.seq).toBe(TABERU);
    expect(m('雛', 'ひよこ')?.entry.seq).toBe(HIYOKO);
    // A spelling the entry doesn't have.
    expect(m('食る', 'たべる')).toBeNull();
    expect(m('食べる', 'くう')).toBeNull();
  });

  it('matches kana-only words, and katakana against hiragana', () => {
    expect(m(null, 'くらくら')?.entry.seq).toBe(1003940);
    expect(m(null, 'うっかり')).toMatchObject({ kanji: null, kana: 'うっかり' });
    // Renshuu writes some kana words in the kanji field too.
    expect(m('みたい', 'みたい')?.entry.seq).toBe(2016410);
  });

  it('matches full-width letters and digits as written', () => {
    const futari: DictEntry = { seq: 9, common: true, kanji: [{ text: '２人' }], kana: [{ text: 'ふたり' }], senses: [{ pos: ['n'], gloss: ['two people'] }] };
    expect(matchWord({ kanji: '2人', kana: 'ふたり', senses: [] }, [futari])?.entry.seq).toBe(9);
    expect(matchWord({ kanji: '２人', kana: 'ふたり', senses: [] }, [futari])?.entry.seq).toBe(9);
  });

  it('tells entries with one spelling apart by meaning, then by which is common', () => {
    expect(m(null, 'コート', ['court (e.g. tennis)'])?.entry.seq).toBe(2842174);
    expect(m(null, 'コート', ['coat'])?.entry.seq).toBe(1049000);
    expect(m(null, 'する', ['to do, to carry out'])?.entry.seq).toBe(1157170);
    expect(m(null, 'する', ['to shave'])?.entry.seq).toBe(1581900);
  });

  it('keeps readings per kanji when they spell the word', () => {
    const info = (kanji: string, kana: string) => dictInfo({ kanji, kana }, m(kanji, kana));
    expect(info('冬眠', 'とうみん').furigana).toEqual([
      ['冬', 'とう'],
      ['眠', 'みん'],
    ]);
    expect(info('腹一杯', 'はらいっぱい')).toEqual({ dictSeq: 1611290, furigana: [['腹', 'はら'], ['一', 'いっ'], ['杯', 'ぱい']], usuallyKana: false });
    expect(info('雛', 'ひよこ').usuallyKana).toBe(true);
    expect(dictInfo({ kanji: null, kana: 'ねこ' }, null)).toEqual({ dictSeq: null, furigana: null, usuallyKana: false });
  });
});

describe('furigana per kanji', () => {
  const known = new Set(['冬']);
  it('puts the reading over each kanji, so only the unknown one gets furigana', () => {
    const ruby: [string, string?][] = [
      ['冬', 'とう'],
      ['眠', 'みん'],
    ];
    expect(furigana('冬眠', 'とうみん', known)).toEqual([{ text: '冬眠', ruby: 'とうみん' }]);
    expect(furigana('冬眠', 'とうみん', known, ruby)).toEqual([{ text: '冬' }, { text: '眠', ruby: 'みん' }]);
    expect(hiddenKanji('冬眠', 'とうみん', known, ruby)).toBe('冬');
  });

  it('ignores readings that spell another form', () => {
    expect(readingParts('食べ物', 'たべもの', [['食', 'た'], ['べもの']])).toEqual([{ text: '食', reading: 'た' }, { text: 'べ' }, { text: '物', reading: 'もの' }]);
  });
});

describe('the dictionary database', () => {
  let dict: D1Database;
  beforeEach(() => {
    dict = createDictDb(30);
  });

  const heads = async (q: string) => (await searchDict(dict, q)).map((e) => headPair(e)[0] ?? headPair(e)[1]);

  it('says what is loaded', async () => {
    expect(await dictStatus(dict)).toEqual({ version: sample.version, chunks: 3, loaded: 3, complete: true });
    expect(await dictStatus(createTestDb())).toEqual({ version: null, chunks: 0, loaded: 0, complete: false });
  });

  it('finds words by kana, romaji, kanji and English, best first', async () => {
    expect((await heads('たべ')).slice(0, 2)).toEqual(['食べる', '食べ物']);
    expect((await heads('taberu'))[0]).toBe('食べる');
    expect(await heads('食べ物')).toEqual(['食べ物']);
    expect((await heads('てれび'))[0]).toBe('テレビ');
    expect((await heads('eat'))[0]).toBe('食べる');
    expect(await heads('hibernation')).toEqual(['冬眠']);
    expect(await heads('nothing like it')).toEqual([]);
  });

  it('loads a chunk again without doubling it', async () => {
    const chunks = toChunks(sample.entries, 30);
    await dict.exec(chunkSql(chunks[0], sample.version, chunks.length));
    expect((await searchDict(dict, 'たべる')).filter((e) => e.seq === TABERU)).toHaveLength(1);
    expect(await dictStatus(dict)).toMatchObject({ loaded: 3, complete: true });
  });

  it('says when it is still loading', async () => {
    expect(await dictStatus(createDictDb(30, 1))).toEqual({ version: sample.version, chunks: 3, loaded: 1, complete: false });
  });

  it('finds an entry by its JMdict number', async () => {
    expect((await entryBySeq(dict, TABERU))?.kanji[0].text).toBe('食べる');
    expect(await entryBySeq(dict, 1)).toBeNull();
  });

  it('matches every word of the Renshuu sample', async () => {
    const words = parseRenshuuExport(readFileSync(join(import.meta.dirname, 'fixtures', 'renshuu_custom_sample.txt'), 'utf8')).words;
    const matches = await matchWords(dict, words);
    const missing = words.filter((_, i) => !matches[i]).map((w) => w.kanji ?? w.kana);
    expect(missing).toEqual([]);
  });
});

describe('your words and the dictionary', () => {
  let db: D1Database;
  let dict: D1Database;
  const MANGA = 1;
  beforeEach(() => {
    db = createTestDb();
    dict = createDictDb();
  });
  const word = async (kana: string) => (await repo.listWords(db, MANGA)).find((w) => w.kana === kana)!;

  it('looks up imported words, and again once more of the dictionary is in', async () => {
    const words = parseRenshuuExport('冬眠/とうみん - hibernation\n変な言葉/へんなことば - made up').words;
    await repo.importWords(db, words, MANGA, now);
    expect((await word('とうみん')).dict).toBe('unchecked');
    expect(await lookUpWords(db, dict)).toEqual({ looked: 2, matched: 1, remaining: 0 });
    expect(await word('とうみん')).toMatchObject({ dict: 'linked', dictSeq: 1446150, furigana: [['冬', 'とう'], ['眠', 'みん']] });
    expect((await word('へんなことば')).dict).toBe('none');
    // Nothing new to look up until the dictionary grows.
    expect(await lookUpWords(db, dict)).toEqual({ looked: 0, matched: 0, remaining: 0 });
    expect(await repo.dictCounts(db)).toEqual({ linked: 1, none: 1, unchecked: 0 });
  });

  it('looks a word with no match up again once the dictionary has grown', async () => {
    // 猫/ねこま isn't common, so it's in the last part loaded.
    const partial = createDictDb(30, 1);
    await repo.importWords(db, parseRenshuuExport('猫/ねこま - cat').words, MANGA, now);
    expect(await lookUpWords(db, partial)).toEqual({ looked: 1, matched: 0, remaining: 0 });
    expect((await word('ねこま')).dict).toBe('none');
    expect(await lookUpWords(db, partial)).toEqual({ looked: 0, matched: 0, remaining: 0 });
    expect(await lookUpWords(db, createDictDb(30))).toEqual({ looked: 1, matched: 1, remaining: 0 });
    expect(await word('ねこま')).toMatchObject({ dict: 'linked', dictSeq: 2698030 });
  });

  it('looks a word up again when its spelling changes', async () => {
    await repo.importWords(db, parseRenshuuExport('冬眠/とうみん - hibernation').words, MANGA, now);
    await lookUpWords(db, dict);
    const w = await word('とうみん');
    const edited = await repo.updateWord(db, w.id, { kanji: '冬ミン' }, now);
    expect(edited).toMatchObject({ dict: 'unchecked', dictSeq: null, furigana: null });
    await repo.updateWord(db, w.id, { kanji: '冬眠' }, now);
    await lookUpWords(db, dict, w.id);
    expect((await word('とうみん')).dict).toBe('linked');
    // Editing the meaning keeps the link.
    expect((await repo.updateWord(db, w.id, { coreMeaning: 'winter sleep' }, now)).dictSeq).toBe(1446150);
  });

  it('links the entry you pick, and keeps your choice', async () => {
    await repo.importWords(db, parseRenshuuExport('コート - court').words, MANGA, now);
    await lookUpWords(db, dict);
    const w = await word('コート');
    expect(w.dictSeq).toBe(2842174);
    const coat = (await entryBySeq(dict, 1049000))!;
    expect((await repo.linkEntry(db, w.id, coat, now)).dictSeq).toBe(1049000);
    expect((await repo.linkEntry(db, w.id, null, now)).dict).toBe('none');
    // Your "none of these" isn't undone by the next look-up.
    await lookUpWords(db, dict);
    expect((await word('コート')).dict).toBe('none');
  });

  it('adds a word from the dictionary, waiting for a page', async () => {
    const entry = (await entryBySeq(dict, TABERU))!;
    const w = await repo.addFromDict(db, MANGA, entry, { kanji: '食べる', kana: 'たべる' }, now);
    expect(w).toMatchObject({
      kanji: '食べる',
      kana: 'たべる',
      coreMeaning: 'to eat',
      pos: 'Ichidan verb · transitive',
      status: 'inbox',
      dict: 'linked',
      dictSeq: TABERU,
      furigana: [['食', 'た'], ['べる']],
      listId: MANGA,
    });
    expect(w.senses).toEqual(senseStrings(sensesFor(entry, '食べる', 'たべる')));
    await expect(repo.addFromDict(db, 2, entry, { kanji: '食べる', kana: 'たべる' }, now)).rejects.toThrow('you already have this word in Manga');
    await expect(repo.addFromDict(db, MANGA, entry, { kanji: '食る', kana: 'たべる' }, now)).rejects.toThrow('not in this dictionary entry');
  });

  it('adds a usually-kana word in kana, with your meaning', async () => {
    const entry = (await entryBySeq(dict, HIYOKO))!;
    const w = await repo.addFromDict(db, MANGA, entry, { kanji: null, kana: 'ひよこ', coreMeaning: 'chick' }, now);
    expect(w).toMatchObject({ kanji: null, kana: 'ひよこ', coreMeaning: 'chick', usuallyKana: true, furigana: null });
  });
});
