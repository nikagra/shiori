// Lists you manage: how each list's weight, weekly target, pause and focus
// decide where new pages and new cards come from. FSRS stays per card, so due
// reviews come from every list whatever these say.

/**
 * New review cards a day, across all lists. Page words graduate straight into
 * review, so the only new cards are the meaning→Japanese cards of words you
 * knew in the check pass. New words come from pages (shared/study.ts).
 */
export const TYPING_CARDS_PER_DAY = 10;

/** Weights the app offers. The API takes any whole number in WEIGHT_RANGE. */
export const WEIGHTS = { low: 1, normal: 2, high: 4 } as const;
export const DEFAULT_WEIGHT = WEIGHTS.normal;
export const WEIGHT_RANGE = [1, 10] as const;
/** A focused list's weight counts this many times over for new cards. */
export const FOCUS_BOOST = 3;
/** Pages started in this many days count towards a list's fair share of new pages. */
export const RECENT_DAYS = 28;
export const MAX_PAGES_PER_WEEK = 14;
/** Longest list name, in characters. */
export const MAX_NAME = 40;

export interface ListPace {
  weight: number;
  paused: boolean;
  archived: boolean;
  focused: boolean;
}

/** The weight a list has today: none while paused or archived, boosted while focused. */
export const effectiveWeight = (l: ListPace) => (l.paused || l.archived ? 0 : l.weight * (l.focused ? FOCUS_BOOST : 1));

export interface NewCardShare {
  key: number;
  weight: number;
  /** New cards from this list already introduced today. */
  introduced: number;
  /** New cards from this list that could be shown today. */
  available: number;
}

/**
 * Splits what's left of today's new-card budget between lists. Each card goes
 * to the list furthest below its share (cards so far ÷ weight), so a list that
 * runs out hands its share to the others and none of the budget is wasted.
 */
export function shareNewCards(total: number, lists: NewCardShare[]): Map<number, number> {
  const given = new Map(lists.map((l) => [l.key, 0]));
  let left = Math.max(0, total - lists.reduce((n, l) => n + l.introduced, 0));
  while (left > 0) {
    let best: NewCardShare | null = null;
    let bestLoad = Infinity;
    for (const l of lists) {
      const g = given.get(l.key)!;
      if (l.weight <= 0 || g >= l.available) continue;
      const load = (l.introduced + g) / l.weight;
      if (load < bestLoad || (load === bestLoad && best && l.weight > best.weight)) {
        best = l;
        bestLoad = load;
      }
    }
    if (!best) break;
    given.set(best.key, given.get(best.key)! + 1);
    left--;
  }
  return given;
}

export interface PageCandidate extends ListPace {
  id: number;
  /** Words waiting for a page. */
  inbox: number;
  pagesPerWeek: number | null;
  /** Pages started from this list in the last 7 days. */
  pagesThisWeek: number;
  /** Pages started from this list in the last RECENT_DAYS days. */
  pagesRecent: number;
}

/**
 * The list "New page" takes words from when you don't pick one: a focused list
 * first, then the list furthest behind its weekly target, then the one with
 * the fewest recent pages for its weight. Paused and archived lists, and
 * lists with no words waiting, are never picked. Null when none qualifies.
 */
export function pickList(lists: PageCandidate[]): number | null {
  const open = lists.filter((l) => !l.paused && !l.archived && l.inbox > 0);
  const focused = open.find((l) => l.focused);
  if (focused) return focused.id;
  const shortfall = (l: PageCandidate) => (l.pagesPerWeek ? Math.max(0, l.pagesPerWeek - l.pagesThisWeek) / l.pagesPerWeek : 0);
  const byWeight = (a: PageCandidate, b: PageCandidate) => b.weight - a.weight || a.id - b.id;
  const behind = open.filter((l) => shortfall(l) > 0).sort((a, b) => shortfall(b) - shortfall(a) || byWeight(a, b));
  if (behind.length) return behind[0].id;
  const load = (l: PageCandidate) => l.pagesRecent / effectiveWeight(l);
  return open.sort((a, b) => load(a) - load(b) || byWeight(a, b))[0]?.id ?? null;
}
