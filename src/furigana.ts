import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from './api';
import { DEFAULT_PREFS, knownKanjiSet, type FuriganaPrefs } from '../shared/furigana';

// Your furigana prefs, shared by every screen and kept on the server so the
// phone and the laptop agree on which kanji you know.

let prefs: FuriganaPrefs = DEFAULT_PREFS;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const set = (next: FuriganaPrefs) => {
  prefs = next;
  emit();
};

/** Furigana prefs from before they moved to the server, saved in this browser. */
function localPrefs(): FuriganaPrefs | null {
  try {
    const old = JSON.parse(localStorage.getItem('shiori.settings') ?? '{}') as Partial<FuriganaPrefs>;
    if (!old.kanjiLevel) return null;
    return { kanjiLevel: old.kanjiLevel, knownKanji: old.knownKanji ?? '', learningKanji: old.learningKanji ?? '' };
  } catch {
    return null;
  }
}

// Bumped by every change made here, so a load that started earlier
// can't overwrite a change you made while it was on its way.
let changes = 0;

function load() {
  const startedAt = changes;
  loading ??= api
    .furigana()
    .then(async (state) => {
      if (changes !== startedAt) return;
      // First load after the move: carry this device's old prefs over once.
      const old = state.stored ? null : localPrefs();
      if (old) await save(old);
      else set(state.prefs);
    })
    .catch(() => {
      // Offline or failed: keep the defaults and try again on the next screen.
      loading = null;
    });
}

// Saves go out one at a time, in order, so a slow earlier save can't land
// after a later one and undo it.
let saving: Promise<unknown> = Promise.resolve();
function save(next: FuriganaPrefs): Promise<void> {
  const startedAt = ++changes;
  set(next);
  const run = saving.then(() => api.setFurigana(next));
  saving = run.catch(() => undefined);
  return run.then((state) => {
    // Only the newest change gets to replace what's shown.
    if (changes === startedAt) set(state.prefs);
  });
}

/** Records a peek, after any pending save; returns the kanji that moved to "still learning". */
function hint(wordId: number, kanji: string): Promise<string> {
  const run = saving.then(() => api.furiganaHint(wordId, kanji));
  saving = run.catch(() => undefined);
  const startedAt = ++changes;
  return run.then((result) => {
    // A save made while this was on its way already shows the newer prefs.
    if (changes === startedAt) set(result.prefs);
    return result.movedToLearning;
  });
}

export function useFurigana() {
  const current = useSyncExternalStore(subscribe, () => prefs);
  useEffect(load, []);
  const known = useMemo(() => knownKanjiSet(current), [current]);
  return {
    prefs: current,
    known,
    save,
    /** Records a peek; returns the kanji that moved to "still learning". */
    hint,
  };
}
