import { describe, expect, it } from 'vitest';
import { coreMeaning, splitGlosses, stripTags } from '../shared/meaning';
import { checkReading, normalizeKana } from '../shared/kana';
import { capForHint, graduate, newCard, Rating, review, State } from '../shared/scheduler';
import { answerStep, currentStep, isDrillDone, startDrill } from '../shared/pageSession';
import { buildQueue, triageOrder, type QueueCandidate } from '../shared/queue';
import { meaningWords, similarPairs } from '../shared/similar';

describe('core meaning', () => {
  it('takes the first sense, at most three glosses', () => {
    expect(coreMeaning(['to take, to pick up, to grab, to catch', 'to pass, to hand'])).toBe('to take, to pick up, to grab');
  });
  it('drops tags and keeps parentheses with their commas', () => {
    expect(stripTags('{suf} {col} -like, sort of')).toBe('-like, sort of');
    expect(splitGlosses('to fall (of rain, snow, ash, etc.), to come down')).toEqual(['to fall (of rain, snow, ash, etc.)', 'to come down']);
  });
  it('skips senses that are only tags', () => {
    expect(coreMeaning(['{n}', 'dog'])).toBe('dog');
  });
});

describe('typed reading check', () => {
  const word = { kana: 'たすける', kanji: '助ける' };
  it('accepts hiragana, katakana, romaji and the written form', () => {
    expect(checkReading('たすける', word).correct).toBe(true);
    expect(checkReading('タスケル', word).correct).toBe(true);
    expect(checkReading('tasukeru', word).correct).toBe(true);
    expect(checkReading(' 助ける ', word).correct).toBe(true);
  });
  it('rejects wrong or empty answers', () => {
    expect(checkReading('たすかる', word).correct).toBe(false);
    expect(checkReading('', word).correct).toBe(false);
  });
  it('handles katakana words and the final n', () => {
    expect(checkReading('とんねる', { kana: 'トンネル', kanji: null }).correct).toBe(true);
    expect(normalizeKana('zannen')).toBe('ざんねん');
  });
});

describe('scheduler', () => {
  const now = new Date('2026-10-25T21:00:00Z');
  const tomorrow = new Date('2026-10-26T03:00:00Z');

  it('graduated words come back the next day, not later', () => {
    const card = graduate(now, tomorrow);
    expect(card.due).toBe(tomorrow.toISOString());
    expect(card.state).toBe(State.Review);
    expect(card.reps).toBe(1);
  });

  it('a failed review counts a lapse and comes back sooner than a pass', () => {
    const start = graduate(now, tomorrow);
    const later = new Date('2026-10-26T20:00:00Z');
    const again = review(start, Rating.Again, later);
    const good = review(start, Rating.Good, later);
    expect(again.lapses).toBe(1);
    expect(new Date(again.due).getTime()).toBeLessThan(new Date(good.due).getTime());
  });

  it('peeking at the page caps the grade at Hard', () => {
    expect(capForHint(Rating.Easy, true)).toBe(Rating.Hard);
    expect(capForHint(Rating.Good, true)).toBe(Rating.Hard);
    expect(capForHint(Rating.Again, true)).toBe(Rating.Again);
    expect(capForHint(Rating.Easy, false)).toBe(Rating.Easy);
  });

  it('new cards start in the New state', () => {
    expect(newCard(now).state).toBe(State.New);
  });
});

describe('page drill', () => {
  it('ordered stage goes through the grid in order, reading first', () => {
    const d = startDrill([3, 1, 2], 'ordered');
    expect(d.queue.map((s) => `${s.wordId}${s.direction}`)).toEqual(['3jp_en', '1jp_en', '2jp_en', '3en_jp', '1en_jp', '2en_jp']);
  });

  it('a miss goes to the back until answered correctly', () => {
    let d = startDrill([1, 2], 'ordered');
    d = answerStep(d, false); // miss 1 jp_en
    expect(currentStep(d)).toEqual({ wordId: 2, direction: 'jp_en' });
    expect(d.queue.at(-1)).toEqual({ wordId: 1, direction: 'jp_en' });
    expect(d.misses).toEqual({ 1: 1 });
    while (!isDrillDone(d)) d = answerStep(d, true);
    expect(d.completed).toBe(4);
  });

  it('shuffled stage has every step once, mixed', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const d = startDrill([1, 2, 3, 4, 5], 'shuffled', random);
    expect(d.queue).toHaveLength(10);
    expect(new Set(d.queue.map((s) => `${s.wordId}${s.direction}`)).size).toBe(10);
    expect(d.queue.map((s) => s.wordId)).not.toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
  });
});

describe('review queue', () => {
  const c = (cardId: number, wordId: number, state: State, due: string, direction: 'jp_en' | 'en_jp' = 'jp_en'): QueueCandidate => ({
    cardId,
    wordId,
    state,
    due,
    direction,
    listId: null,
  });

  it('puts due cards first, most overdue first, and caps new cards', () => {
    const q = buildQueue(
      [
        c(1, 1, State.New, '2026-10-01'),
        c(2, 2, State.Review, '2026-10-20'),
        c(3, 3, State.Review, '2026-10-10'),
        c(4, 4, State.New, '2026-10-02'),
        c(5, 5, State.New, '2026-10-03'),
      ],
      { reviewedToday: new Set(), newIntroducedToday: new Map([[0, 18]]), newPerDay: 20, weights: new Map() },
    );
    expect(q.map((x) => x.cardId)).toEqual([3, 2, 1, 4]);
  });

  it('shows only one direction of a word per day', () => {
    const q = buildQueue(
      [c(1, 1, State.Review, '2026-10-01', 'jp_en'), c(2, 1, State.Review, '2026-10-02', 'en_jp'), c(3, 2, State.Review, '2026-10-03')],
      { reviewedToday: new Set([2]), newIntroducedToday: new Map(), newPerDay: 20, weights: new Map() },
    );
    expect(q.map((x) => x.cardId)).toEqual([1]);
  });

  it('triage starts with the weakest words', () => {
    const order = triageOrder([
      { id: 'a', mastery: 80, sourceOrder: 1 },
      { id: 'b', mastery: null, sourceOrder: 2 },
      { id: 'c', mastery: 10, sourceOrder: 3 },
    ]);
    expect(order.map((w) => w.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('long-vowel mark', () => {
  it('accepts ー typed as romaji, hiragana or katakana for katakana words', () => {
    for (const typed of ['ko-hi-', 'こーひー', 'コーヒー']) expect(checkReading(typed, { kana: 'コーヒー', kanji: null }).correct).toBe(true);
    expect(checkReading('こうひい', { kana: 'コーヒー', kanji: null }).correct).toBe(false);
  });
});

describe('words close in meaning', () => {
  const word = (id: number, coreMeaning: string) => ({ id, coreMeaning });

  it('finds pairs that share a meaning word, ignoring filler', () => {
    const page = [word(1, 'to save, to rescue'), word(2, 'to help, to rescue (someone)'), word(3, 'to eat'), word(4, 'to be able to do'), word(5, 'to do something')];
    expect(similarPairs(page).map((p) => [p.a.id, p.b.id, p.shared])).toEqual([[1, 2, ['rescue']]]);
  });

  it('ignores case, brackets and very short words', () => {
    expect([...meaningWords('Cat (animal); a CAT, an ox')]).toEqual(['cat']);
    expect(similarPairs([word(1, 'big (in size)'), word(2, 'size')])).toEqual([]);
  });
});
