import { useEffect, useRef, useState } from 'react';
import { bind, toKana, unbind } from 'wanakana';
import { api, writtenForm, type ListSummary, type ListWord } from '../api';
import { Notice, plural, shortDate } from '../components/ui';
import { useWordFilter, WordFilter } from '../components/WordFilter';
import { DictResults, DictSearchBox, SenseList, useDictSearch, useDictStatus } from '../components/DictSearch';
import { WORD_STATES } from '../../shared/wordSearch';
import { entryCoreMeaning, headPair, posLabel, sensesFor, type DictEntry } from '../../shared/dictionary';
import { MAX_HOOK } from '../../shared/study';

// One list's words: find them, then edit, move, set aside or delete one.

/** Long lists show this many at a time, so the phone stays quick. */
const SHOW_AT_ONCE = 100;

const STATE_LABEL = Object.fromEntries(WORD_STATES.map((s) => [s.state, s.label])) as Record<ListWord['status'], string>;

/** `leeches` opens the list showing only its leeches. */
export function ListWords({ id, leeches: leechesFirst = false }: { id: number; leeches?: boolean }) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [words, setWords] = useState<ListWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(SHOW_AT_ONCE);
  const filter = useWordFilter(words ?? []);
  const [leechesOnly, setLeechesOnly] = useState(leechesFirst);

  useEffect(() => {
    Promise.all([api.lists(), api.listWords(id)]).then(
      ([l, w]) => {
        setLists(l);
        setWords(w);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);
  useEffect(() => setLimit(SHOW_AT_ONCE), [filter.text, filter.states, leechesOnly]);

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
  const leechCount = words.filter((w) => w.leechAt).length;
  const matching = leechesOnly ? filter.shown.filter((w) => w.leechAt) : filter.shown;
  const shown = matching.slice(0, limit);

  return (
    <div className="stack">
      <a href="#/lists" className="link-button link-button--back">
        ← Lists
      </a>
      <div className="row row--between">
        <h1>{list.name}</h1>
        {!list.archived && (
          <a href={`#/add/${id}`} className="button button--small">
            Add a word
          </a>
        )}
      </div>
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
          {(leechCount > 0 || leechesOnly) && (
            <div className="chips" role="group" aria-label="Leeches">
              <button type="button" className={`chip${leechesOnly ? ' is-active' : ''}`} aria-pressed={leechesOnly} onClick={() => setLeechesOnly(!leechesOnly)}>
                Leeches only <span className="chip__count">{leechCount}</span>
              </button>
            </div>
          )}
          {leechesOnly && (
            <p className="muted small">
              Leeches keep slipping in review, so they wait here for a new approach. Open one to put it on a fresh page, write a memory hook, or fix its
              meaning and let it back in.
            </p>
          )}
          <p className="muted small" aria-live="polite">
            {matching.length === words.length ? plural(words.length, 'word') : `${matching.length} of ${plural(words.length, 'word')}`}
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
                  {w.leechAt ? (
                    <span className="badge badge--leech">Leech</span>
                  ) : (
                    <span className={`badge badge--state-${w.status}`}>{STATE_LABEL[w.status]}</span>
                  )}
                </button>
                {open === w.id && (
                  <WordEditor
                    key={`${w.id}:${w.kana}:${w.kanji}:${w.coreMeaning}:${w.hook}`}
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
          {matching.length === 0 && <p className="muted">No words match.</p>}
          {matching.length > limit && (
            <button type="button" className="button" onClick={() => setLimit(limit + SHOW_AT_ONCE)}>
              Show more ({matching.length - limit} left)
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
  const meaningRef = useRef<HTMLInputElement>(null);
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
            {w.leechAt ? ' · out of review for now' : w.nextDue && ` · next review ${shortDate(new Date(w.nextDue))}`} · {plural(w.reviews, 'review')}
            {w.lapses > 0 && ` · ${plural(w.lapses, 'lapse')}`}
          </>
        )}
        {w.status === 'ignored' && `Set aside: not in the check pass, pages or review.${w.hasCards ? ' Its review history is kept.' : ''}`}
      </p>

      {w.leechAt && (
        <section className="leech stack stack--tight" aria-label={`${name} is a leech`}>
          <p className="small">
            <strong>A leech.</strong> It keeps slipping in review, so it's out of review until you give it a new approach. Another look won't help;
            more effort will.
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => run(() => api.relearn(w.id), () => `${name} waits for a fresh page, first in line.`)}
          >
            Put it on a fresh page
          </button>
          <p className="muted small">It goes first in line for this list's next page, and starts review afresh after it. Its history is kept.</p>
          <p className="muted small">
            Or show it a new way below: a clearer meaning, a fixed spelling or a memory hook lets it back into review, with its lapses counted afresh.
          </p>
        </section>
      )}

      <form
        className="stack stack--tight"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const kanji = String(data.get('kanji') ?? '').trim();
          // A final n stays a letter while you type (it could become な); here it's ん.
          const kana = toKana(String(data.get('kana') ?? '').trim());
          const coreMeaning = String(data.get('meaning') ?? '').trim();
          const hook = String(data.get('hook') ?? '').trim();
          const changes = {
            ...(kanji !== (w.kanji ?? '') && { kanji: kanji || null }),
            ...(kana !== w.kana && { kana }),
            ...(coreMeaning !== w.coreMeaning && { coreMeaning }),
            ...(hook !== (w.hook ?? '') && { hook: hook || null }),
          };
          if (Object.keys(changes).length === 0) return;
          run(
            () => api.updateWord(w.id, changes),
            (word) => `Saved ${word ? writtenForm(word) : name}.${w.leechAt && word && !word.leechAt ? ' It is back in review.' : ''}`,
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
          <input ref={meaningRef} name="meaning" defaultValue={w.coreMeaning} autoComplete="off" required />
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
        <label className="field">
          <span>Memory hook</span>
          <textarea
            name="hook"
            rows={2}
            maxLength={MAX_HOOK}
            defaultValue={w.hook ?? ''}
            placeholder="Your own way to remember it: a picture, a scene, a word it sounds like"
          />
        </label>
        <button className="button button--primary" disabled={busy}>
          Save
        </button>
      </form>

      <DictPanel
        word={w}
        busy={busy}
        onLink={(dictSeq, message) => run(() => api.linkEntry(w.id, dictSeq), () => message)}
        onUseMeaning={(meaning) => {
          if (meaningRef.current) {
            meaningRef.current.value = meaning;
            meaningRef.current.focus();
          }
        }}
      />

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

/**
 * The word's dictionary entry: what it says, its meaning to copy into yours,
 * or another entry to link (or none). Your meanings never change by
 * themselves.
 */
function DictPanel({
  word: w,
  busy,
  onLink,
  onUseMeaning,
}: {
  word: ListWord;
  busy: boolean;
  onLink: (dictSeq: number | null, message: string) => Promise<void>;
  onUseMeaning: (meaning: string) => void;
}) {
  const status = useDictStatus();
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useDictSearch();
  useEffect(() => {
    if (w.dictSeq === null) return setEntry(null);
    // A late answer for an entry you've since replaced mustn't show.
    let live = true;
    api.dictEntry(w.dictSeq).then(
      (e) => live && setEntry(e),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [w.dictSeq]);
  const name = writtenForm(w);

  const senses = entry ? sensesFor(entry, w.kanji, w.kana) : [];
  return (
    <div className="stack stack--tight" data-testid="dict-panel">
      <p className="small">
        {w.dict === 'linked' && entry && (
          <>
            Dictionary: <span lang="ja">{headPair(entry)[0] ? `${headPair(entry)[0]}（${headPair(entry)[1]}）` : headPair(entry)[1]}</span>
            {senses[0] && posLabel(senses[0].pos) && <span className="muted"> · {posLabel(senses[0].pos)}</span>}
            {w.usuallyKana && <span className="muted"> · usually written in kana</span>}
          </>
        )}
        {w.dict === 'linked' && !entry && !error && 'Dictionary: loading…'}
        {w.dict === 'none' && (status?.complete === false ? 'Not found in the dictionary yet (it is still loading).' : 'Not in the dictionary.')}
        {w.dict === 'unchecked' && 'Not looked up in the dictionary yet.'}
      </p>
      {error && <p className="error small">{error}</p>}
      {entry && (
        <details className="small">
          <summary className="muted">The dictionary’s meanings ({senses.length})</summary>
          <SenseList senses={senses} />
          <button type="button" className="link-button" onClick={() => onUseMeaning(entryCoreMeaning(senses))}>
            Use its first meaning as mine
          </button>
        </details>
      )}
      {picking ? (
        <div className="stack stack--tight">
          <DictSearchBox search={search} label={`Find the entry for ${name}`} autoFocus />
          <DictResults
            search={search}
            open={open}
            onOpen={setOpen}
            mineLabel={(m) => (m.id === w.id ? 'this word' : 'yours')}
            detail={(e) => (
              <div className="word-editor stack stack--tight">
                <SenseList senses={e.senses} />
                <button type="button" className="button button--primary" disabled={busy} onClick={() => onLink(e.seq, `Linked ${name} to its dictionary entry.`).then(() => setPicking(false))}>
                  This is the word
                </button>
              </div>
            )}
          />
          <div className="row">
            <button type="button" className="button" onClick={() => setPicking(false)}>
              Cancel
            </button>
            {w.dict !== 'none' && (
              <button type="button" className="button" disabled={busy} onClick={() => onLink(null, `${name} is marked as not in the dictionary.`).then(() => setPicking(false))}>
                None of these
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            search.setQuery(w.kanji ?? w.kana);
            setPicking(true);
          }}
        >
          {w.dict === 'linked' ? 'Pick another entry' : 'Find it in the dictionary'}
        </button>
      )}
    </div>
  );
}
