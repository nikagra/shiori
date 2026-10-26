import { useEffect, useState } from 'react';
import { api, studyDay, type ListChanges, type ListSummary } from '../api';
import { Notice } from '../components/ui';
import { useSettings } from '../settings';
import { FOCUS_BOOST, MAX_NAME, MAX_PAGES_PER_WEEK, NEW_PER_DAY, WEIGHTS } from '../../shared/lists';

const WEIGHT_LABELS: [keyof typeof WEIGHTS, string][] = [
  ['low', 'Low'],
  ['normal', 'Normal'],
  ['high', 'High'],
];

/** Focus runs to the end of the study day you pick (04:00 the morning after). */
const focusEndFromDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return studyDay(new Date(y, m - 1, d, 12)).end.toISOString();
};
const lastFocusDay = (until: string) => studyDay(new Date(Date.parse(until) - 1)).start;
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const dateInputValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Every word in the list, set-aside ones too: a list with any can't be deleted. */
const wordCount = (l: ListSummary) => Object.values(l.counts).reduce((a, b) => a + b, 0);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Lists() {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const load = () => api.lists().then(setLists, (e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  /** Runs a change, then shows the lists as the server has them. True when it worked. */
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    let ok = true;
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      ok = false;
    }
    await load();
    return ok;
  };

  if (!lists) return error ? <Notice kind="error">{error}</Notice> : <p className="muted">Loading…</p>;
  const active = lists.filter((l) => !l.archived);
  const archived = lists.filter((l) => l.archived);

  return (
    <div className="stack">
      <h1>Lists</h1>
      <p className="muted">
        Each list keeps its own pace. A page always comes from one list. New pages and today's {NEW_PER_DAY} new review cards are shared by weight; due
        reviews from every list always come.
      </p>
      {error && <Notice kind="error">{error}</Notice>}

      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api.createList(name)).then((ok) => ok && setName(''));
        }}
      >
        <input aria-label="New list name" placeholder="New list, e.g. Yotsuba" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME} />
        <button className="button" disabled={!name.trim()}>
          Add
        </button>
      </form>

      {active.map((l) => (
        <ListCard
          key={l.id}
          list={l}
          others={active.filter((o) => o.id !== l.id)}
          run={run}
          // Show a weight, target or pause right away; the reload confirms it.
          show={(changes) => setLists((all) => all && all.map((o) => (o.id === l.id ? { ...o, ...changes } : o)))}
        />
      ))}

      {archived.length > 0 && (
        <section className="stack stack--tight">
          <h2>Archived</h2>
          <p className="muted">No new pages or cards, and hidden from import and the check pass. Their learned words still come up for review.</p>
          {archived.map((l) => (
            <div key={l.id} className="list-item" data-testid="archived-list">
              <span>
                <strong>{l.name}</strong> <span className="muted">· {plural(wordCount(l), 'word')}</span>
              </span>
              <button className="button button--small" onClick={() => run(() => api.updateList(l.id, { archived: false }))}>
                Unarchive
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function ListCard({
  list: l,
  others,
  run,
  show,
}: {
  list: ListSummary;
  others: ListSummary[];
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  show: (changes: Pick<ListSummary, 'weight' | 'pagesPerWeek' | 'paused'>) => void;
}) {
  const update = (changes: ListChanges) => run(() => api.updateList(l.id, changes));
  const [, updateSettings] = useSettings();
  const setPace = (changes: Partial<Pick<ListSummary, 'weight' | 'pagesPerWeek' | 'paused'>>) => {
    show({ weight: l.weight, pagesPerWeek: l.pagesPerWeek, paused: l.paused, ...changes });
    return update(changes);
  };
  const [rename, setRename] = useState(l.name);
  const [into, setInto] = useState<number | ''>('');
  const tomorrow = new Date(studyDay().start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [focusDate, setFocusDate] = useState(dateInputValue(new Date(tomorrow.getTime() + 13 * 86_400_000)));
  useEffect(() => setRename(l.name), [l.name]);
  const words = wordCount(l);

  return (
    <section className="card stack" aria-label={l.name} data-testid="list-card">
      <div className="list-head">
        <h2>{l.name}</h2>
        {l.next && <span className="badge badge--ordered">Next page</span>}
        {l.paused && <span className="badge">Paused</span>}
        {l.focused && l.focusUntil && <span className="badge badge--focus">Focus until {shortDate(lastFocusDay(l.focusUntil))}</span>}
      </div>
      <p className="muted small" data-testid="list-counts">
        {words === 0
          ? 'No words yet.'
          : [
              l.counts.toCheck && `${l.counts.toCheck} to check`,
              l.counts.inbox && `${l.counts.inbox} waiting`,
              l.counts.onPage && `${l.counts.onPage} on pages`,
              l.counts.learned && `${l.counts.learned} learned`,
              l.counts.ignored && `${l.counts.ignored} set aside`,
            ]
              .filter(Boolean)
              .join(' · ')}
        <br />
        Today: {plural(l.newToday, 'new card')} · {plural(l.pagesThisWeek, 'page')} in the last 7 days
        {l.pagesPerWeek ? ` (target ${l.pagesPerWeek})` : ''}
      </p>
      {l.counts.toCheck > 0 && !l.archived && (
        <a href="#/check" className="small" onClick={() => updateSettings({ checkList: l.id })}>
          Check {l.name}’s {plural(l.counts.toCheck, 'word')}
        </a>
      )}

      <div className="row row--between">
        <span>Weight</span>
        <div className="segmented" role="group" aria-label={`Weight of ${l.name}`}>
          {WEIGHT_LABELS.map(([key, label]) => (
            <button key={key} className={l.weight === WEIGHTS[key] ? 'is-active' : ''} aria-pressed={l.weight === WEIGHTS[key]} onClick={() => setPace({ weight: WEIGHTS[key] })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="row row--between">
        <span>Weekly target</span>
        <select
          className="select--auto"
          value={l.pagesPerWeek ?? ''}
          onChange={(e) => setPace({ pagesPerWeek: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">None</option>
          {Array.from({ length: MAX_PAGES_PER_WEEK }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {plural(n, 'page')} a week
            </option>
          ))}
        </select>
      </label>

      <label className="toggle">
        <input type="checkbox" checked={l.paused} onChange={(e) => setPace({ paused: e.target.checked })} />
        Pause: no new pages or new cards from this list
      </label>

      <details className="more">
        <summary>Focus, rename, merge, archive</summary>
        <div className="stack">
          <div className="stack stack--tight">
            <strong>Focus before a test</strong>
            <p className="muted small">
              New pages come from this list first, and it gets {FOCUS_BOOST}× its share of new cards. One list at a time.
            </p>
            {l.focused ? (
              <button className="button" onClick={() => update({ focusUntil: null })}>
                End focus
              </button>
            ) : (
              <div className="add-row">
                <input type="date" aria-label={`Focus ${l.name} until`} value={focusDate} min={dateInputValue(studyDay().start)} onChange={(e) => setFocusDate(e.target.value)} />
                <button className="button" disabled={!focusDate} onClick={() => update({ focusUntil: focusEndFromDate(focusDate) })}>
                  Focus
                </button>
              </div>
            )}
          </div>

          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault();
              update({ name: rename });
            }}
          >
            <input aria-label={`Rename ${l.name}`} value={rename} onChange={(e) => setRename(e.target.value)} maxLength={MAX_NAME} />
            <button className="button" disabled={!rename.trim() || rename.trim() === l.name}>
              Rename
            </button>
          </form>

          {others.length > 0 && words > 0 && (
            <div className="add-row">
              <select aria-label={`Merge ${l.name} into`} value={into} onChange={(e) => setInto(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Merge into…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                className="button"
                disabled={into === ''}
                onClick={() => {
                  const target = others.find((o) => o.id === into);
                  if (target && window.confirm(`Move all ${plural(words, 'word')} of ${l.name} to ${target.name} and remove ${l.name}?`)) {
                    run(() => api.mergeList(l.id, target.id));
                  }
                }}
              >
                Merge
              </button>
            </div>
          )}

          <div className="row">
            {words > 0 ? (
              <button className="button" onClick={() => update({ archived: true })}>
                Archive
              </button>
            ) : (
              <button className="button" onClick={() => run(() => api.deleteList(l.id))}>
                Delete
              </button>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
