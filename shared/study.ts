// Study settings shared by every device, and how review shows the grade
// buttons' intervals. No FSRS import here: the client bundle uses it.

/** New words a day: words you start on pages. Once today's reach it, Pages asks before another page. */
export const NEW_WORDS_DEFAULT = 12;
export const NEW_WORDS_CHOICES = [5, 8, 10, 12, 15, 20, 24, 30, 40, 50] as const;
export const NEW_WORDS_RANGE = [1, 50] as const;

export interface StudyPrefs {
  newWordsPerDay: number;
  /** In review, a line under the grade buttons with when each grade brings the word back. */
  showIntervals: boolean;
}

export const DEFAULT_STUDY: StudyPrefs = { newWordsPerDay: NEW_WORDS_DEFAULT, showIntervals: true };

/** Pages asks before a new page once today's new words reach the setting. */
export const newWordsReached = (today: number, perDay: number) => today >= perDay;

/** When a card comes back after each grade, in days from now. */
export interface GradeIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

/**
 * A short, rounded interval for a grade button: "10m", "1d", "5d", "3w",
 * "4mo", "1.2y". Shiori adds a little jitter when you grade, so it's a guide,
 * not a promise.
 */
export function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 14) return `${Math.round(days)}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = days / 365;
  return `${years < 10 ? Math.round(years * 10) / 10 : Math.round(years)}y`;
}
