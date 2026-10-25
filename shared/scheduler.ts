import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

// FSRS scheduling for Shiori.
//
// Short-term (same-day) learning steps are off: same-day practice happens on
// pages, and FSRS only schedules reviews from the next day on.

export type Direction = 'jp_en' | 'en_jp';
export const DIRECTIONS: Direction[] = ['jp_en', 'en_jp'];

export { Rating, State };
export type { Card, Grade };

export const DESIRED_RETENTION = 0.9;

const scheduler = fsrs(
  generatorParameters({ request_retention: DESIRED_RETENTION, enable_short_term: false, enable_fuzz: true }),
);

/** Serialisable FSRS card, dates as ISO strings. */
export interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review: string | null;
}

export function toStored(card: Card): StoredCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

export function fromStored(s: StoredCard): Card {
  return {
    ...s,
    due: new Date(s.due),
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function newCard(now: Date): StoredCard {
  return toStored(createEmptyCard(now));
}

export function review(card: StoredCard, rating: Grade, now: Date): StoredCard {
  return toStored(scheduler.next(fromStored(card), now, rating).card);
}

/**
 * A word that finished both page passes. It counts as one successful review
 * now, but the first real check is the next day, never later: right after a
 * page session recall feels strong for everyone.
 */
export function graduate(now: Date, nextDayStart: Date): StoredCard {
  const reviewed = review(newCard(now), Rating.Good, now);
  if (new Date(reviewed.due) > nextDayStart) reviewed.due = nextDayStart.toISOString();
  return reviewed;
}

/** Rating allowed when the learner peeked at the page grid. */
export function capForHint(rating: Grade, hintUsed: boolean): Grade {
  if (!hintUsed) return rating;
  return rating > Rating.Hard ? Rating.Hard : rating;
}

export const LEECH_LAPSES = 6;
