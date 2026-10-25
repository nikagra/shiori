import { describe, expect, it } from 'vitest';
import { alignReading, furigana, hiddenKanji, knownKanjiSet, markLearning } from '../shared/furigana';

const n4 = knownKanjiSet({ kanjiLevel: 'n4', knownKanji: '', learningKanji: '' });

describe('alignReading', () => {
  it('lines readings up with kanji runs around okurigana', () => {
    expect(alignReading('食べ物', 'たべもの')).toEqual([
      { text: '食', reading: 'た' },
      { text: 'べ' },
      { text: '物', reading: 'もの' },
    ]);
    expect(alignReading('見知らぬ', 'みしらぬ')).toEqual([{ text: '見知', reading: 'みし' }, { text: 'らぬ' }]);
  });

  it('matches katakana in the written form against a hiragana reading', () => {
    expect(alignReading('三ヶ月', 'さんかげつ')).toEqual([{ text: '三ヶ月', reading: 'さんかげつ' }]);
    expect(alignReading('お茶', 'おちゃ')).toEqual([{ text: 'お' }, { text: '茶', reading: 'ちゃ' }]);
  });

  it('falls back to one reading over the whole word when the kana disagree', () => {
    expect(alignReading('取り扱い', 'とりあつかう')).toEqual([{ text: '取り扱い', reading: 'とりあつかう' }]);
  });
});

describe('furigana', () => {
  it('leaves words made of known kanji alone', () => {
    expect(furigana('時代', 'じだい', n4)).toEqual([{ text: '時代' }]);
    expect(furigana('夜明け', 'よあけ', n4)).toEqual([{ text: '夜明' }, { text: 'け' }]);
  });

  it('glosses only the runs that hold an unknown kanji', () => {
    expect(furigana('残酷', 'ざんこく', n4)).toEqual([{ text: '残酷', ruby: 'ざんこく' }]);
    expect(furigana('助ける', 'たすける', n4)).toEqual([{ text: '助', ruby: 'たす' }, { text: 'ける' }]);
  });

  it('respects extra known kanji and kanji still being learned', () => {
    const prefs = knownKanjiSet({ kanjiLevel: 'n4', knownKanji: '助', learningKanji: '夜' });
    expect(furigana('助ける', 'たすける', prefs)).toEqual([{ text: '助' }, { text: 'ける' }]);
    expect(furigana('夜明け', 'よあけ', prefs)).toEqual([{ text: '夜明', ruby: 'よあ' }, { text: 'け' }]);
  });
});

describe('furigana hints', () => {
  it('a hint reveals only the kanji that show no reading now', () => {
    expect(hiddenKanji('時代', 'じだい', n4)).toBe('時代');
    expect(hiddenKanji('助ける', 'たすける', n4)).toBe('');
    // 夜明 is all known; 残酷 already has furigana.
    expect(hiddenKanji('夜明け', 'よあけ', n4)).toBe('夜明');
    expect(hiddenKanji('残酷', 'ざんこく', n4)).toBe('');
  });

  it('moving kanji to still learning keeps them on the extra-known list, so taking them off brings them back', () => {
    const moved = markLearning({ kanjiLevel: 'n4', knownKanji: '誰必', learningKanji: '験' }, '必時');
    expect(moved).toEqual({ kanjiLevel: 'n4', knownKanji: '誰必', learningKanji: '験必時' });
    expect(knownKanjiSet(moved).has('必')).toBe(false);
    expect(knownKanjiSet({ ...moved, learningKanji: '験' }).has('必')).toBe(true);
  });

  it('lines up readings around the long-vowel mark', () => {
    expect(alignReading('ビール瓶', 'びーるびん')).toEqual([{ text: 'ビール' }, { text: '瓶', reading: 'びん' }]);
  });
});
