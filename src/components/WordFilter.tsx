import { useMemo, useState } from 'react';
import { countStates, filterWords, WORD_STATES, type Searchable, type WordState } from '../../shared/wordSearch';

// The search box and state filters for a list's words. The list screen uses
// it, and so does picking words for a page (WordPicker).

export function useWordFilter<T extends Searchable>(words: readonly T[], initial: WordState[] = []) {
  const [text, setText] = useState('');
  const [states, setStates] = useState<ReadonlySet<WordState>>(() => new Set(initial));
  const shown = useMemo(() => filterWords(words, { text, states }), [words, text, states]);
  const counts = useMemo(() => countStates(words), [words]);
  const toggle = (state: WordState | 'all') =>
    setStates((prev) => {
      if (state === 'all') return new Set();
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  return { text, setText, states, toggle, shown, counts, total: words.length };
}

export function WordFilter({ filter, label = 'Search words' }: { filter: ReturnType<typeof useWordFilter>; label?: string }) {
  const { text, setText, states, toggle, counts, total } = filter;
  return (
    <div className="word-filter stack stack--tight">
      <input
        type="search"
        aria-label={label}
        placeholder="Kana, romaji, kanji or meaning"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <div className="chips" role="group" aria-label="Show words">
        <button type="button" className={`chip${states.size === 0 ? ' is-active' : ''}`} aria-pressed={states.size === 0} onClick={() => toggle('all')}>
          All <span className="chip__count">{total}</span>
        </button>
        {WORD_STATES.filter((s) => counts[s.state] > 0 || states.has(s.state)).map((s) => (
          <button
            key={s.state}
            type="button"
            className={`chip${states.has(s.state) ? ' is-active' : ''}`}
            aria-pressed={states.has(s.state)}
            onClick={() => toggle(s.state)}
          >
            {s.label} <span className="chip__count">{counts[s.state]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
