import { useEffect, useRef, useState } from 'react';
import { bind, toKana, unbind } from 'wanakana';
import { api, writtenForm, type ListSummary, type ListWord } from '../api';
import { Notice, plural, shortDate } from '../components/ui';
import { useWordFilter, WordFilter } from '../components/WordFilter';
import { WORD_STATES } from '../../shared/wordSearch';

// One list's words: find them, then edit, move, set aside or delete one.

/** Long lists show this many at a time, so the phone stays quick. */
const SHOW_AT_ONCE = 100;

const STATE_LABEL = Object.fromEntries(WORD_STATES.map((s) => [s.state, s.label])) as Record<ListWord['status'], string>;

export function ListWords({ id }: { id: number }) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [words, setWords] = useState<ListWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(SHOW_AT_ONCE);
  const filter = useWordFilter(words ?? []);

  useEffect(() => {
    Promise.all([api.lists(), api.listWords(id)]).then(
      ([l, w]) => {
        setLists(l);
        setWords(w);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);
  useEffect(() => setLimit(SHOW_AT_ONCE), [filter.text, filter.states]);

  if (!words || !lists) return error ? <Notice kind="error">{error}</Notice> : <p className="muted">Loading…</p>;
  const list = lists.find((l) => l.id === id);
  if (!list) return <Notice kind="error">list not found</Notice>;

  /** Shows a change the server made: the word as it is now, or gone from this list. */
  const changed = (word: ListWord | null, removed: number, message: string) => {
    setError(null);
    setDone(message);
    setWords((all) => all && (word && word.listId === id ? all.map((w) => (w.id === word.id ? word : w)) : all.filter((w) => w.id !== removed)));
    if (!word || word.listId !== id) setOpen(null);
  };

  const counts = filter.counts;
  const shown = filter.shown.slice(0, limit);

  return (
    <div className="stack">
      <a href="#/lists" className="link-button link-button--back">
        ← Lists
      </a>
      <h1>{list.name}</h1>
      <p className="muted small" data-testid="word-counts">
        {words.length === 0
          ? 'No words yet.'
          : `${plural(words.length, 'word')}: ` +
            WORD_STATES.filter((s) => counts[s.state] > 0)
              .map((s) => `${counts[s.state]} ${s.label.toLowerCase()}`)
              .join(' · ')}
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="success">{done}</Notice>}

      {words.length > 0 && (
        <>
          <WordFilter filter={filter} label={`Search ${list.name}`} />
          <p className="muted small" aria-live="polite">
            {filter.shown.length === words.length ? plural(words.length, 'word') : `${filter.shown.length} of ${plural(words.length, 'word')}`}
          </p>
          <ul className="word-list">
            {shown.map((w) => (
              <li key={w.id} className={`word-row${open === w.id ? ' word-row--open' : ''}`} data-testid="word-row">
                <button type="button" className="word-row__head" aria-expanded={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)}>
                  <span className="word-row__jp" lang="ja">
                    <span className="word-row__written">{writtenForm(w)}</span>
                    {w.kanji && <span className="word-row__kana">{w.kana}</span>}
                  </span>
                  <span className="word-row__meaning">{w.coreMeaning}</span>
                  <span className={`badge badge--state-${w.status}`}>{STATE_LABEL[w.status]}</span>
                </button>
                {open === w.id && (
                  <WordEditor
                    key={`${w.id}:${w.kana}:${w.kanji}:${w.coreMeaning}`}
                    word={w}
                    lists={lists.filter((l) => l.id !== id)}
                    onChanged={changed}
                    onError={(message) => {
                      setDone(null);
                      setError(message);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {filter.shown.length === 0 && <p className="muted">No words match.</p>}
          {filter.shown.length > limit && (
            <button type="button" className="button" onClick={() => setLimit(limit + SHOW_AT_ONCE)}>
              Show more ({filter.shown.length - limit} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function WordEditor({
  word: w,
  lists,
  onChanged,
  onError,
}: {
  word: ListWord;
  /** The other lists, to move the word to. */
  lists: ListSummary[];
  onChanged: (word: ListWord | null, removed: number, message: string) => void;
  onError: (message: string) => void;
}) {
  const kanaRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [into, setInto] = useState<number | ''>('');
  // Romaji typed on a laptop turns into kana, as in review.
  useEffect(() => {
    const el = kanaRef.current;
    if (!el) return;
    bind(el, { IMEMode: true });
    return () => unbind(el);
  }, []);
  const name = writtenForm(w);
  const onPage = w.status === 'on_page';

  const run = async (action: () => Promise<ListWord | null>, message: (word: ListWord | null) => string) => {
    setBusy(true);
    try {
      const word = await action();
      onChanged(word, w.id, message(word));
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="word-editor stack" aria-label={`Edit ${name}`} role="group">
      <p className="small" data-testid="word-state">
        {w.status === 'unverified' && 'Waiting for the check pass.'}
        {w.status === 'inbox' && 'Waiting for a page.'}
        {w.status === 'on_page' && w.page && (
          <>
            On <a href={`#/pages/${w.page.id}`}>page {w.page.number}</a>, not finished yet.
          </>
        )}
        {w.status === 'graduated' && (
          <>
            Learned{w.page && <> since <a href={`#/pages/${w.page.id}`}>page {w.page.number}</a></>}
            {w.nextDue && ` · next review ${shortDate(new Date(w.nextDue))}`} · {plural(w.reviews, 'review')}
            {w.lapses > 0 && ` · ${plural(w.lapses, 'lapse')}`}
          </>
        )}
        {w.status === 'ignored' && `Set aside: not in the check pass, pages or review.${w.hasCards ? ' Its review history is kept.' : ''}`}
      </p>

      <form
        className="stack stack--tight"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const kanji = String(data.get('kanji') ?? '').trim();
          // A final n stays a letter while you type (it could become な); here it's ん.
          const kana = toKana(String(data.get('kana') ?? '').trim());
          const coreMeaning = String(data.get('meaning') ?? '').trim();
          const changes = {
            ...(kanji !== (w.kanji ?? '') && { kanji: kanji || null }),
            ...(kana !== w.kana && { kana }),
            ...(coreMeaning !== w.coreMeaning && { coreMeaning }),
          };
          if (Object.keys(changes).length === 0) return;
          run(
            () => api.updateWord(w.id, changes),
            (word) => `Saved ${word ? writtenForm(word) : name}.`,
          );
        }}
      >
        <div className="word-editor__fields">
          <label className="field">
            <span>Kanji</span>
            <input name="kanji" lang="ja" defaultValue={w.kanji ?? ''} placeholder="none" autoComplete="off" />
          </label>
          <label className="field">
            <span>Kana</span>
            <input ref={kanaRef} name="kana" lang="ja" defaultValue={w.kana} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} required />
          </label>
        </div>
        <label className="field">
          <span>Meaning</span>
          <input name="meaning" defaultValue={w.coreMeaning} autoComplete="off" required />
        </label>
        {w.senses.length > 1 && (
          <details className="small">
            <summary className="muted">All meanings ({w.senses.length})</summary>
            <ol className="word-editor__senses">
              {w.senses.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </details>
        )}
        <button className="button button--primary" disabled={busy}>
          Save
        </button>
      </form>

      {onPage ? (
        <p className="muted small">Moving, setting aside and deleting wait until the page is learned, so the page keeps its words.</p>
      ) : (
        <>
          {lists.length > 0 && (
            <div className="add-row">
              <select aria-label={`Move ${name} to`} value={into} onChange={(e) => setInto(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Move to list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.archived ? ' (archived)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button"
                disabled={into === '' || busy}
                onClick={() => {
                  const target = lists.find((l) => l.id === into);
                  if (target) run(() => api.updateWord(w.id, { listId: target.id }), () => `Moved ${name} to ${target.name}.`);
                }}
              >
                Move
              </button>
            </div>
          )}
          <div className="row">
            {w.status === 'ignored' && w.hasCards && (
              <button type="button" className="button" disabled={busy} onClick={() => run(() => api.bringBack(w.id), () => `${name} is back in review.`)}>
                Bring back to review
              </button>
            )}
            {w.canCheckAgain && (
              <button type="button" className="button" disabled={busy} onClick={() => run(() => api.checkAgain(w.id), () => `${name} will be checked again.`)}>
                Check again
              </button>
            )}
            {w.status !== 'ignored' && (
              <button type="button" className="button" disabled={busy} onClick={() => run(() => api.setAside(w.id), () => `Set ${name} aside.`)}>
                Set aside
              </button>
            )}
            <button
              type="button"
              className="button button--again"
              disabled={busy}
              onClick={() => {
                const history = w.hasCards ? ' and its review history' : '';
                if (window.confirm(`Delete ${name}${history}? This can't be undone.`)) {
                  run(
                    () => api.deleteWord(w.id).then(() => null),
                    () => `Deleted ${name}.`,
                  );
                }
              }}
            >
              Delete
            </button>
          </div>
          {w.canCheckAgain && w.status === 'graduated' && (
            <p className="muted small">Check again undoes your check pass answer, while the word has no reviews yet.</p>
          )}
        </>
      )}
    </div>
  );
}
