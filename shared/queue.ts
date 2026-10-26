import { shareNewCards } from './lists';
import { State, type Direction } from './scheduler';

// Building today's review queue.

export interface QueueCandidate {
  cardId: number;
  wordId: number;
  direction: Direction;
  state: State;
  due: string;
  /** The word's list; null only for words loaded from an old backup by hand. */
  listId: number | null;
}

export interface QueueOptions {
  /** Words that already had a card reviewed today. */
  reviewedToday: Set<number>;
  /** New cards already introduced today, by list id. */
  newIntroducedToday: Map<number, number>;
  newPerDay: number;
  /** Each list's weight today (effectiveWeight). A list missing here counts with weight 1. */
  weights: Map<number, number>;
}

const mix = (n: number) => Math.imul(n ^ 0x5bd1e995, 0x2c1b3c6d) >>> 0;

const listKey = (c: QueueCandidate) => c.listId ?? 0;

/**
 * Due cards first, most overdue first, then new cards up to today's limit,
 * split between lists by weight (shareNewCards). Only one card per word per
 * day ("sibling burying"), so answering one direction never gives away the
 * other.
 */
export function buildQueue(candidates: QueueCandidate[], opts: QueueOptions): QueueCandidate[] {
  const seen = new Set(opts.reviewedToday);
  // Ties (cards due at the same moment) are broken by a stable hash of the card
  // id, so when both directions of a word are due, neither always wins.
  const byDue = (a: QueueCandidate, b: QueueCandidate) =>
    a.due === b.due ? mix(a.cardId) - mix(b.cardId) : a.due < b.due ? -1 : 1;

  const due = candidates.filter((c) => c.state !== State.New).sort(byDue);
  const fresh = candidates.filter((c) => c.state === State.New).sort(byDue);

  const out: QueueCandidate[] = [];
  for (const c of due) {
    if (seen.has(c.wordId)) continue;
    seen.add(c.wordId);
    out.push(c);
  }
  // New cards that could be shown, one per word, kept in order per list.
  const byList = new Map<number, QueueCandidate[]>();
  for (const c of fresh) {
    if (seen.has(c.wordId)) continue;
    seen.add(c.wordId);
    const key = listKey(c);
    if (!byList.has(key)) byList.set(key, []);
    byList.get(key)!.push(c);
  }
  const keys = new Set([...byList.keys(), ...opts.newIntroducedToday.keys()]);
  const share = shareNewCards(
    opts.newPerDay,
    [...keys].map((key) => ({
      key,
      weight: opts.weights.get(key) ?? 1,
      introduced: opts.newIntroducedToday.get(key) ?? 0,
      available: byList.get(key)?.length ?? 0,
    })),
  );
  const picked = new Set([...byList].flatMap(([key, cards]) => cards.slice(0, share.get(key) ?? 0)));
  // Back in due order, so lists take turns instead of coming in blocks.
  return out.concat(fresh.filter((c) => picked.has(c)));
}

/** Order for the triage pass: lowest Renshuu mastery first, unknown in the middle. */
export function triageOrder<T extends { mastery: number | null; sourceOrder: number }>(words: T[]): T[] {
  const key = (m: number | null) => (m === null ? 50 : m);
  return words.slice().sort((a, b) => key(a.mastery) - key(b.mastery) || a.sourceOrder - b.sourceOrder);
}
