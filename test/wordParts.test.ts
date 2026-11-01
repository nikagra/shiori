import { describe, expect, it } from 'vitest';
import { partCandidates, partInfo, splitParts } from '../shared/wordParts';
import type { DictEntry } from '../shared/dictEntry';

const entry = (seq: number, kanji: string, kana: string, gloss: string): DictEntry => ({
  seq,
  common: true,
  kanji: [{ text: kanji }],
  kana: [{ text: kana }],
  senses: [{ pos: ['n'], gloss: [gloss] }],
});

const known = partInfo([
  entry(1, '行方', 'ゆくえ', 'whereabouts'),
  entry(2, '不明', 'ふめい', 'unknown'),
  entry(3, '行', 'ぎょう', 'line'),
  entry(4, '生き', 'いき', 'living'),
  entry(5, '残る', 'のこる', 'to remain'),
  entry(6, '間髪', 'かんはつ', "a hair's breadth"),
  entry(7, '鼾', 'いびき', 'snoring'),
  entry(8, '掻く', 'かく', 'to scratch'),
  entry(9, '入れる', 'いれる', 'to put in'),
  entry(10, '入れ', 'いれ', 'container'),
  entry(12, '口', 'くち', 'mouth'),
  entry(13, '利く', 'きく', 'to be effective'),
  entry(14, '利', 'り', 'advantage'),
  entry(15, '目', 'め', 'eye'),
  entry(16, '覚る', 'さとる', 'to understand'),
]);

describe('word parts', () => {
  it('looks up every shorter run with a kanji, not the word itself or kana alone', () => {
    const c = partCandidates('生き残る');
    expect(c).toContain('生き');
    expect(c).toContain('残る');
    expect(c).not.toContain('生き残る');
    expect(c).not.toContain('き');
    expect(partCandidates('逆')).toEqual([]);
  });

  it('splits a compound into the longest dictionary words, left to right', () => {
    expect(splitParts('行方不明', known)).toEqual([
      { text: '行方', reading: 'ゆくえ', gloss: 'whereabouts' },
      { text: '不明', reading: 'ふめい', gloss: 'unknown' },
    ]);
    expect(splitParts('生き残る', known).map((p) => p.text)).toEqual(['生き', '残る']);
  });

  it('keeps the pieces between words as parts with no meaning', () => {
    expect(splitParts('鼾を掻く', known)).toEqual([
      { text: '鼾', reading: 'いびき', gloss: 'snoring' },
      { text: 'を', reading: null, gloss: null },
      { text: '掻く', reading: 'かく', gloss: 'to scratch' },
    ]);
  });

  it('reads a conjugated verb at the end in its dictionary form', () => {
    expect(partCandidates('間髪入れず')).toContain('入れる');
    expect(splitParts('間髪入れず', known)).toEqual([
      { text: '間髪', reading: 'かんはつ', gloss: "a hair's breadth" },
      { text: '入れず', base: '入れる', reading: 'いれる', gloss: 'to put in' },
    ]);
  });

  it('reads a godan negative back to its dictionary form, and never a bare kanji plus る', () => {
    expect(splitParts('口を利かず', known).map((p) => p.base ?? p.text)).toEqual(['口', 'を', '利く']);
    // 覚 + る would be 覚る "to understand": not what 目覚まし is made of.
    expect(partCandidates('目覚まし')).not.toContain('覚る');
  });

  it('gives nothing when fewer than two parts are words', () => {
    expect(splitParts('間髪', known)).toEqual([]);
    expect(splitParts('逆', known)).toEqual([]);
  });

  it('another spelling of the word itself is not a part', () => {
    const own = { ...entry(11, '夜明け', 'よあけ', 'dawn'), kanji: [{ text: '夜明け' }, { text: '夜明' }] };
    expect(partInfo([own], '夜明け').has('夜明')).toBe(false);
  });

  it('the most common entry gives a form its reading and meaning', () => {
    const info = partInfo([entry(1, '本', 'ほん', 'book'), entry(2, '本', 'もと', 'origin')]);
    expect(info.get('本')).toEqual({ reading: 'ほん', gloss: 'book' });
  });
});

describe('word parts from the dictionary database', () => {
  it('splits a word from the sample, and leaves a plain word whole', async () => {
    const { createDictDb } = await import('./d1');
    const { wordParts } = await import('../worker/dict');
    const dict = createDictDb();
    expect(await wordParts(dict, '夜明け')).toEqual([
      { text: '夜', reading: 'よる', gloss: 'night' },
      { text: '明け', reading: 'あけ', gloss: 'dawn' },
    ]);
    expect(await wordParts(dict, '鼾を掻く')).toEqual([
      { text: '鼾', reading: 'いびき', gloss: 'snoring' },
      { text: 'を', reading: null, gloss: null },
      { text: '掻く', reading: 'かく', gloss: 'to scratch' },
    ]);
    expect(await wordParts(dict, '残酷')).toEqual([]);
    expect(await wordParts(dict, '')).toEqual([]);
  });
});
