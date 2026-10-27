import type { Direction } from './scheduler';
import type { WordState } from './wordSearch';

// Same-day drill over one page: the paper method, then the page cue fades.
//
// Stage "ordered":  every word in grid order, Japanese→meaning first,
//                   then meaning→Japanese, again in grid order.
// Stage "shuffled": the same steps, shuffled, with both directions mixed.
// A missed step goes to the back of the queue until it is answered correctly.

export type PageStage = 'ordered' | 'shuffled' | 'graduated';

export interface DrillStep {
  wordId: number;
  direction: Direction;
}

export interface DrillState {
  queue: DrillStep[];
  completed: number;
  total: number;
  misses: Record<number, number>;
}

export type Random = () => number;

export function shuffle<T>(items: T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
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
      : shuffle(
          wordIdsInGridOrder.flatMap((wordId) => [
            { wordId, direction: 'jp_en' as const },
            { wordId, direction: 'en_jp' as const },
          ]),
          random,
        );
  return { queue: steps, completed: 0, total: steps.length, misses: {} };
}

export function currentStep(state: DrillState): DrillStep | null {
  return state.queue[0] ?? null;
}

export function answerStep(state: DrillState, correct: boolean): DrillState {
  const [step, ...rest] = state.queue;
  if (!step) return state;
  if (correct) return { ...state, queue: rest, completed: state.completed + 1 };
  return {
    ...state,
    queue: [...rest, step],
    misses: { ...state.misses, [step.wordId]: (state.misses[step.wordId] ?? 0) + 1 },
  };
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
