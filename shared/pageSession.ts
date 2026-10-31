import type { Direction } from './scheduler';
import type { WordState } from './wordSearch';

// Same-day drill over one page: the paper method, then the page cue fades.
//
// Stage "ordered":  every word in grid order, Japanese→meaning first,
//                   then meaning→Japanese, again in grid order.
// Stage "shuffled": the same steps, shuffled, with both directions mixed.
//
// In the shuffled stage a word's two directions are never asked one right
// after the other, unless the page is too small to put anything between them.
//
// A missed step comes back after at least MISS_GAP other cards, so the retry
// isn't answered from the last few seconds of memory. Near the end of a
// drill, steps already answered fill the gap ("fillers": asked again, but
// they don't count towards progress). A retry you get right finishes the
// step; the miss stays recorded, per word and direction.

export type PageStage = 'ordered' | 'shuffled' | 'graduated';

export interface DrillStep {
  wordId: number;
  direction: Direction;
  /** Asked again only to put a gap before a retry. */
  filler?: boolean;
}

export interface DrillState {
  queue: DrillStep[];
  completed: number;
  total: number;
  /** Misses by stepKey. */
  misses: Record<string, number>;
  /** Steps answered right, the pool fillers come from. */
  done: DrillStep[];
}

/** Other cards before a missed step comes back. */
export const MISS_GAP = 5;

export const stepKey = (s: Pick<DrillStep, 'wordId' | 'direction'>) => `${s.wordId}:${s.direction}`;

export type Random = () => number;

export function shuffle<T>(items: T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sameWord = (a: DrillStep | undefined, b: DrillStep | undefined) => a !== undefined && b !== undefined && a.wordId === b.wordId;

/**
 * Moves steps so no two of the same word sit side by side, where the steps
 * allow it. Each clash takes the next step of another word ahead; at the end,
 * where nothing is left ahead, the step moves back into a gap that fits.
 */
export function spreadWords(steps: DrillStep[]): DrillStep[] {
  const out = steps.slice();
  for (let i = 1; i < out.length; i++) {
    if (!sameWord(out[i - 1], out[i])) continue;
    const k = out.findIndex((s, j) => j > i && s.wordId !== out[i].wordId);
    if (k !== -1) {
      [out[i], out[k]] = [out[k], out[i]];
      continue;
    }
    // Nothing of another word ahead: put this step back between two others.
    const [step] = out.splice(i, 1);
    const at = out.findIndex((s, j) => j > 0 && j < i && !sameWord(out[j - 1], step) && !sameWord(s, step));
    out.splice(at === -1 ? i : at, 0, step);
    if (at === -1) break;
    i = at;
  }
  return out;
}

export function startDrill(wordIdsInGridOrder: number[], stage: 'ordered' | 'shuffled', random: Random = Math.random): DrillState {
  const steps: DrillStep[] =
    stage === 'ordered'
      ? [
          ...wordIdsInGridOrder.map((wordId) => ({ wordId, direction: 'jp_en' as const })),
          ...wordIdsInGridOrder.map((wordId) => ({ wordId, direction: 'en_jp' as const })),
        ]
      : spreadWords(
          shuffle(
            wordIdsInGridOrder.flatMap((wordId) => [
              { wordId, direction: 'jp_en' as const },
              { wordId, direction: 'en_jp' as const },
            ]),
            random,
          ),
        );
  return { queue: steps, completed: 0, total: steps.length, misses: {}, done: [] };
}

export function currentStep(state: DrillState): DrillStep | null {
  return state.queue[0] ?? null;
}

export function answerStep(state: DrillState, correct: boolean, random: Random = Math.random): DrillState {
  const [step, ...rest] = state.queue;
  if (!step) return state;
  if (correct) {
    if (step.filler) return { ...state, queue: rest };
    return { ...state, queue: rest, completed: state.completed + 1, done: [...state.done, { wordId: step.wordId, direction: step.direction }] };
  }
  const key = stepKey(step);
  // A filler was right first time already: missing it later doesn't change its grade.
  const misses = step.filler ? state.misses : { ...state.misses, [key]: (state.misses[key] ?? 0) + 1 };
  // Back after MISS_GAP other cards; fillers make up for a short queue.
  const queued = new Set(rest.map(stepKey));
  const pool = state.done.filter((s) => s.wordId !== step.wordId && !queued.has(stepKey(s)));
  const fillers = shuffle(pool, random)
    .slice(0, Math.max(0, MISS_GAP - rest.length))
    .map((s) => ({ ...s, filler: true }));
  const before = [...rest, ...fillers];
  // At least MISS_GAP cards later, and not next to the word's other direction.
  let at = Math.min(MISS_GAP, before.length);
  while (at < before.length && (sameWord(before[at - 1], step) || sameWord(before[at], step))) at++;
  return { ...state, queue: [...before.slice(0, at), step, ...before.slice(at)], misses };
}

/** Misses per card, for the server. */
export function missesByCard(state: DrillState): { wordId: number; direction: Direction; misses: number }[] {
  return Object.entries(state.misses).map(([key, misses]) => {
    const [wordId, direction] = key.split(':');
    return { wordId: Number(wordId), direction: direction as Direction, misses };
  });
}

/** A saved drill still fits the page: the same words, none missing. */
export function drillFits(state: DrillState, wordIds: number[]): boolean {
  const ids = new Set(wordIds);
  const steps = [...state.queue, ...state.done];
  return steps.every((s) => ids.has(s.wordId)) && state.total === wordIds.length * 2 && Array.isArray(state.done);
}

/** The grade a card starts review with, from its misses in step 2: right first time Good, one miss Hard, more Again. */
export function graduationGrade(misses: number): 'good' | 'hard' | 'again' {
  return misses <= 0 ? 'good' : misses === 1 ? 'hard' : 'again';
}

export function isDrillDone(state: DrillState): boolean {
  return state.queue.length === 0;
}

export function nextStage(stage: PageStage): PageStage {
  return stage === 'ordered' ? 'shuffled' : 'graduated';
}

export const PAGE_SIZES = [10, 12, 15] as const;
export const GRID_COLUMNS = 3;
/** Most words a page can hold, whatever the page size setting (pages you shape can add words). */
export const MAX_PAGE_WORDS = 20;
/** Words that can go on a page: waiting, or still to check (picking one says you don't know it yet). */
export const PAGE_READY: readonly WordState[] = ['inbox', 'unverified'];
