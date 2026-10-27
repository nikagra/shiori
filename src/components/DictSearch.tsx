import { useEffect, useState, type ReactNode } from 'react';
import { api, type DictStatus, type MyEntryWord } from '../api';
import { headPair, miscLabels, posLabel, rubyFor, shownForms, type DictEntry, type DictSense } from '../../shared/dictionary';
import { Notice, Written } from './ui';

// Searching the dictionary: adding a word (AddWord) and picking a word's
// entry (ListWords) share the search box and the results.

let statusLoad: Promise<DictStatus> | null = null;
/** The dictionary's state, loaded once per visit (it changes only when a load runs). */
export function useDictStatus(): DictStatus | null {
  const [status, setStatus] = useState<DictStatus | null>(null);
  useEffect(() => {
    statusLoad ??= api.dictStatus().catch((e) => {
      statusLoad = null;
      throw e;
    });
    let live = true;
    statusLoad.then(
      (s) => live && setStatus(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return status;
}
/** Forgets the loaded state, after words were looked up. */
export const refreshDictStatus = () => {
  statusLoad = null;
};

/**
 * Looks up every word that has no dictionary entry yet, a batch per request
 * (each request stays small for the Worker). `onProgress` gets the words
 * still waiting. Returns how many were looked up and how many found an entry
 * (none looked up: the dictionary isn't loaded, or nothing was waiting).
 */
export async function lookUpAll(onProgress?: (remaining: number) => void): Promise<{ looked: number; matched: number }> {
  let looked = 0;
  let matched = 0;
  for (;;) {
    const r = await api.dictLookUp();
    looked += r.looked;
    matched += r.matched;
    onProgress?.(r.remaining);
    if (r.remaining <= 0 || r.looked === 0) break;
  }
  if (looked > 0) refreshDictStatus();
  return { looked, matched };
}

let background: Promise<unknown> | null = null;
/**
 * Once per visit, looks up words still waiting: words from before the
 * dictionary, and words with no match while it was still loading (it fills
 * night by night). Quiet: Settings › Dictionary shows the state.
 */
export function lookUpInBackground() {
  background ??= lookUpAll().catch(() => {
    background = null;
  });
}

/** Waits this long after the last key before searching, so typing stays quick. */
const DEBOUNCE_MS = 250;

export function useDictSearch(initial = '') {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<{ query: string; entries: DictEntry[]; mine: MyEntryWord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.dictSearch(q).then(
        (r) => {
          if (!live) return;
          setError(null);
          setResults({ query: q, ...r });
        },
        (e: Error) => live && setError(e.message),
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  /** Marks a result as one of your words, after adding it. */
  const addMine = (word: MyEntryWord) => setResults((r) => r && { ...r, mine: [...r.mine, word] });
  return { query, setQuery, results, error, addMine };
}

/** The search box, with a note while the dictionary is empty or still loading. */
export function DictSearchBox({ search, label = 'Search the dictionary', autoFocus = false }: { search: ReturnType<typeof useDictSearch>; label?: string; autoFocus?: boolean }) {
  const status = useDictStatus();
  return (
    <div className="stack stack--tight">
      <input
        type="search"
        aria-label={label}
        placeholder="Kana, romaji, kanji or English"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {status && status.loaded === 0 && <Notice kind="error">The dictionary isn't loaded yet. Settings › Dictionary says how to load it.</Notice>}
      {status && status.loaded > 0 && !status.complete && (
        <p className="muted small">The dictionary is still loading ({status.loaded} of {status.chunks} parts): common words are in, rarer ones may be missing.</p>
      )}
      {search.error && <Notice kind="error">{search.error}</Notice>}
    </div>
  );
}

/** The entry's main written form, with readings over its kanji. */
export function EntryHead({ entry }: { entry: DictEntry }) {
  const [kanji, kana] = headPair(entry);
  return <span className="word-row__written">{kanji ? <Written word={{ kanji, kana, furigana: rubyFor(entry, kanji, kana) }} /> : kana}</span>;
}

/** "to eat; to live on (e.g. a salary)": the first senses, short. */
export const sensesLine = (senses: DictSense[], max = 2) =>
  senses
    .slice(0, max)
    .map((s) => s.gloss.slice(0, 3).join(', '))
    .join('; ') + (senses.length > max ? '; …' : '');

/** Every sense of an entry, numbered, with its notes, and its part of speech where it changes. */
export function SenseList({ senses }: { senses: DictSense[] }) {
  return (
    <ol className="dict-senses">
      {senses.map((s, i) => {
        const pos = i > 0 && posLabel(senses[i - 1].pos) === posLabel(s.pos) ? '' : posLabel(s.pos);
        const notes = miscLabels(s);
        return (
          <li key={i}>
            {(pos || notes.length > 0) && <span className="dict-senses__pos">{[pos, ...notes].filter(Boolean).join(' · ')}</span>} {s.gloss.join(', ')}
            {s.info && <span className="muted"> ({s.info.join('; ')})</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Other spellings worth knowing: written forms and readings beyond the first. */
export function otherForms(entry: DictEntry): string {
  const [kanji, kana] = headPair(entry);
  return [...shownForms(entry.kanji), ...shownForms(entry.kana)]
    .map((f) => f.text)
    .filter((t) => t !== kanji && t !== kana)
    .join('、');
}

export function DictResults({
  search,
  open,
  onOpen,
  detail,
  mineLabel,
}: {
  search: ReturnType<typeof useDictSearch>;
  open: number | null;
  onOpen: (seq: number | null) => void;
  /** What an opened result shows below its head. */
  detail: (entry: DictEntry) => ReactNode;
  /** The badge on a result you have already. */
  mineLabel: (mine: MyEntryWord) => string;
}) {
  const { results } = search;
  if (!results) return null;
  if (results.entries.length === 0) return <p className="muted">Nothing found for “{results.query}”.</p>;
  return (
    <ul className="word-list" aria-label="Dictionary results">
      {results.entries.map((e) => {
        const [kanji, kana] = headPair(e);
        const mine = results.mine.find((m) => m.dictSeq === e.seq);
        return (
          <li key={e.seq} className={`word-row${open === e.seq ? ' word-row--open' : ''}`} data-testid="dict-row">
            <button type="button" className="word-row__head" aria-expanded={open === e.seq} onClick={() => onOpen(open === e.seq ? null : e.seq)}>
              <span className="word-row__jp" lang="ja">
                <EntryHead entry={e} />
                {kanji && <span className="word-row__kana">{kana}</span>}
              </span>
              <span className="word-row__meaning">{sensesLine(e.senses)}</span>
              {mine ? <span className="badge badge--state-graduated">{mineLabel(mine)}</span> : e.common && <span className="badge">common</span>}
            </button>
            {open === e.seq && detail(e)}
          </li>
        );
      })}
    </ul>
  );
}
