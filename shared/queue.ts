import { State, type Direction } from './scheduler';

// Building today's review queue.

export interface QueueCandidate {
  cardId: number;
  wordId: number;
  direction: Direction;
  state: State;
  due: string;
}

export interface QueueOptions {
  /** Words that already had a card reviewed today. */
  reviewedToday: Set<number>;
  /** New cards already introduced today. */
  newIntroducedToday: number;
  newPerDay: number;
}

export const NEW_PER_DAY = 20;

const mix = (n: number) => Math.imul(n ^ 0x5bd1e995, 0x2c1b3c6d) >>> 0;

/**
 * Due cards first, most overdue first, then new cards up to today's limit.
 * Only one card per word per day ("sibling burying"), so answering one
 * direction never gives away the other.
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
  let newLeft = Math.max(0, opts.newPerDay - opts.newIntroducedToday);
  for (const c of fresh) {
    if (newLeft === 0) break;
    if (seen.has(c.wordId)) continue;
    seen.add(c.wordId);
    out.push(c);
    newLeft--;
  }
  return out;
}

/** Order for the triage pass: lowest Renshuu mastery first, unknown in the middle. */
export function triageOrder<T extends { mastery: number | null; sourceOrder: number }>(words: T[]): T[] {
  const key = (m: number | null) => (m === null ? 50 : m);
  return words.slice().sort((a, b) => key(a.mastery) - key(b.mastery) || a.sourceOrder - b.sourceOrder);
}
