import { describe, expect, it } from 'vitest';
import { deinflect, inflectionLine, posFits, type WordKind } from '../shared/deinflect';

/** The reasons `word` comes from `base` (a word of `kind`), or undefined when it can't. */
const how = (word: string, base: string, kind: WordKind) => deinflect(word).find((d) => d.base === base && d.kind === kind)?.reasons;

describe('reading inflected forms back to the dictionary form', () => {
  it('ichidan verbs', () => {
    expect(how('食べた', '食べる', 'v1')).toEqual(['past']);
    expect(how('食べて', '食べる', 'v1')).toEqual(['te-form']);
    expect(how('食べない', '食べる', 'v1')).toEqual(['negative']);
    expect(how('食べなかった', '食べる', 'v1')).toEqual(['negative', 'past']);
    expect(how('食べないで', '食べる', 'v1')).toEqual(['negative', 'te-form']);
    expect(how('食べます', '食べる', 'v1')).toEqual(['polite']);
    expect(how('食べませんでした', '食べる', 'v1')).toEqual(['polite negative past']);
    expect(how('食べたい', '食べる', 'v1')).toEqual(['want to']);
    expect(how('食べたくなかった', '食べる', 'v1')).toEqual(['want to', 'negative', 'past']);
    expect(how('食べれば', '食べる', 'v1')).toEqual(['conditional (ば)']);
    expect(how('食べよう', '食べる', 'v1')).toEqual(['volitional']);
    expect(how('食べられない', '食べる', 'v1')).toEqual(['potential or passive', 'negative']);
    expect(how('食べさせられた', '食べる', 'v1')).toEqual(['causative', 'potential or passive', 'past']);
    expect(how('入れず', '入れる', 'v1')).toEqual(['negative']);
  });

  it('godan verbs, by their last kana', () => {
    expect(how('構わない', '構う', 'v5')).toEqual(['negative']);
    expect(how('書いた', '書く', 'v5')).toEqual(['past']);
    expect(how('泳いで', '泳ぐ', 'v5')).toEqual(['te-form']);
    expect(how('話した', '話す', 'v5')).toEqual(['past']);
    expect(how('待って', '待つ', 'v5')).toEqual(['te-form']);
    expect(how('死んだ', '死ぬ', 'v5')).toEqual(['past']);
    expect(how('遊んで', '遊ぶ', 'v5')).toEqual(['te-form']);
    expect(how('読みます', '読む', 'v5')).toEqual(['polite']);
    expect(how('帰らなかった', '帰る', 'v5')).toEqual(['negative', 'past']);
    expect(how('書ける', '書く', 'v5')).toEqual(['potential']);
    expect(how('書けない', '書く', 'v5')).toEqual(['potential', 'negative']);
    expect(how('書かれた', '書く', 'v5')).toEqual(['passive', 'past']);
    expect(how('書かせる', '書く', 'v5')).toEqual(['causative']);
    expect(how('書こう', '書く', 'v5')).toEqual(['volitional']);
    expect(how('書けば', '書く', 'v5')).toEqual(['conditional (ば)']);
    expect(how('利かず', '利く', 'v5')).toEqual(['negative']);
    // 行く's own past.
    expect(how('行った', '行く', 'v5')).toEqual(['past']);
    expect(how('いって', 'いく', 'v5')).toEqual(['te-form']);
  });

  it('する and 来る', () => {
    expect(how('した', 'する', 'vs')).toEqual(['past']);
    expect(how('勉強しなかった', '勉強する', 'vs')).toEqual(['negative', 'past']);
    expect(how('できない', 'する', 'vs')).toEqual(['potential', 'negative']);
    expect(how('来ない', '来る', 'vk')).toEqual(['negative']);
    expect(how('きた', 'くる', 'vk')).toEqual(['past']);
    expect(how('来ます', '来る', 'vk')).toEqual(['polite']);
  });

  it('い-adjectives', () => {
    expect(how('大きくなかった', '大きい', 'adj-i')).toEqual(['negative', 'past']);
    expect(how('大きかった', '大きい', 'adj-i')).toEqual(['past']);
    expect(how('大きく', '大きい', 'adj-i')).toEqual(['adverb (く)']);
    expect(how('大きくて', '大きい', 'adj-i')).toEqual(['te-form']);
  });

  it('never gives a lone kana, and leaves a dictionary form alone', () => {
    expect(deinflect('た')).toEqual([]);
    expect(deinflect('た').map((d) => d.base)).not.toContain('る');
    expect(how('食べる', '食べる', 'v1')).toBeUndefined();
  });

  it('the past of a form that can go no further is not read further', () => {
    // 食べた is a past: nothing reads it as the past of the past.
    expect(deinflect('食べたた').find((d) => d.base === '食べる')).toBeUndefined();
  });
});

describe('fitting a base to an entry', () => {
  it('needs the entry to be that kind of word', () => {
    expect(posFits(['v5u', 'vi'], 'v5')).toBe(true);
    expect(posFits(['v1', 'vt'], 'v1')).toBe(true);
    expect(posFits(['v5r', 'vi'], 'v1')).toBe(false);
    expect(posFits(['adj-ix'], 'adj-i')).toBe(true);
    expect(posFits(['n', 'vs'], 'vs')).toBe(false);
    expect(posFits(['vs-i'], 'vs')).toBe(true);
    expect(posFits(['vk'], 'vk')).toBe(true);
  });

  it('says how in one line', () => {
    expect(inflectionLine('食べた', '食べる', ['past'])).toBe('食べた is 食べる: past.');
  });
});
