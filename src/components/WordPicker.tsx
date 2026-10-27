import { useEffect, useState } from 'react';
import { writtenForm, type ListWord } from '../api';
import { plural } from './ui';
import { PAGE_READY } from '../../shared/pageSession';
import { useWordFilter, WordFilter } from './WordFilter';

// Picking words for a page from one list, with the list's search box and
// filters. A new page picks several, in order; changing a page picks one.

/** Long lists show this many at a time, so the phone stays quick. */
const SHOW_AT_ONCE = 100;

/** Words that can go on a page: waiting first, then still to check, each in the order they came. */
export function pickable(words: readonly ListWord[]): ListWord[] {
  return PAGE_READY.flatMap((state) => words.filter((w) => w.status === state));
}

export function WordPicker({
  words,
  picked,
  onPick,
  full = false,
  label,
}: {
  /** The words to pick from (see pickable). */
  words: readonly ListWord[];
  /** Picked word ids, in page order. */
  picked: readonly number[];
  onPick: (word: ListWord) => void;
  /** No more room: words not picked yet can't be picked. */
  full?: boolean;
  label: string;
}) {
  const filter = useWordFilter(words);
  const [limit, setLimit] = useState(SHOW_AT_ONCE);
  useEffect(() => setLimit(SHOW_AT_ONCE), [filter.text, filter.states]);
  const shown = filter.shown.slice(0, limit);

  if (words.length === 0) return <p className="muted">No words in this list are waiting or still to check.</p>;
  return (
    <div className="stack stack--tight">
      <WordFilter filter={filter} label={label} />
      <p className="muted small" aria-live="polite">
        {filter.shown.length === words.length ? plural(words.length, 'word') : `${filter.shown.length} of ${plural(words.length, 'word')}`}
      </p>
      <ul className="word-list" aria-label="Words to pick">
        {shown.map((w) => {
          const at = picked.indexOf(w.id);
          return (
            <li key={w.id} className={`word-row${at >= 0 ? ' word-row--picked' : ''}`} data-testid="pick-row">
              <button
                type="button"
                className="word-row__head word-row__head--pick"
                aria-pressed={at >= 0}
                disabled={at < 0 && full}
                onClick={() => onPick(w)}
              >
                <span className="pick-mark" aria-hidden="true">
                  {at >= 0 ? at + 1 : ''}
                </span>
                <span className="word-row__jp" lang="ja">
                  <span className="word-row__written">{writtenForm(w)}</span>
                  {w.kanji && <span className="word-row__kana">{w.kana}</span>}
                </span>
                <span className="word-row__meaning">{w.coreMeaning}</span>
                {w.status === 'unverified' && <span className="badge badge--state-unverified">To check</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {filter.shown.length === 0 && <p className="muted">No words match.</p>}
      {filter.shown.length > limit && (
        <button type="button" className="button" onClick={() => setLimit(limit + SHOW_AT_ONCE)}>
          Show more ({filter.shown.length - limit} left)
        </button>
      )}
    </div>
  );
}
