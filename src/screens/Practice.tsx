import { useEffect, useState } from 'react';
import { api, type PageDetail, type PageSummary } from '../api';
import { Notice, plural } from '../components/ui';
import { navigate } from '../nav';
import { startDrill, type DrillState } from '../../shared/pageSession';
import { Drill } from './PageView';

// Practice that doesn't count (Mikita, 27 and 30 Oct): pick one or more
// learned pages and drill their words, shuffled, both directions mixed.
// Nothing is sent: no grades, no misses, no change to when words come back
// (only a furigana peek's kanji hint, as everywhere).
// #/practise picks the pages; #/practise/3,5 practises pages 3 and 5 (by id).

export function Practice({ ids }: { ids: number[] }) {
  return ids.length === 0 ? <PracticePicker /> : <PracticeDrill ids={ids} />;
}

function PracticePicker() {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.pages().then((p) => setPages(p.filter((x) => x.stage === 'graduated').sort((a, b) => a.number - b.number)), (e: Error) => setError(e.message));
  }, []);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!pages) return <p className="muted">Loading…</p>;

  const words = pages.filter((p) => picked.has(p.id)).reduce((n, p) => n + p.wordCount, 0);
  const toggle = (id: number) => {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };

  return (
    <div className="stack">
      <h1>Practise</h1>
      <p className="muted">
        Pick learned pages to go through again, shuffled, both directions mixed. It isn't counted: review and its schedule stay as they are.
      </p>
      {pages.length === 0 ? (
        <Notice>
          No learned pages yet. Finish both steps of a page in <a href="#/pages">Pages</a> first.
        </Notice>
      ) : (
        <>
          <div className="row row--between">
            <span className="muted small">{plural(pages.length, 'learned page')}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => setPicked(picked.size === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}
            >
              {picked.size === pages.length ? 'Pick none' : 'Pick all'}
            </button>
          </div>
          <ul className="plain-list stack stack--tight" aria-label="Learned pages">
            {pages.map((p) => (
              <li key={p.id}>
                <label className="list-item list-item--check">
                  <span className="toggle">
                    <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span>
                      <strong>Page {p.number}</strong>{' '}
                      <span className="muted">
                        · {p.listName ? `${p.listName} · ` : ''}
                        {p.wordCount} words
                      </span>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            className="button button--primary button--wide"
            disabled={picked.size === 0}
            onClick={() => navigate(`/practise/${pages.filter((p) => picked.has(p.id)).map((p) => p.id).join(',')}`)}
          >
            {picked.size === 0 ? 'Pick a page to practise' : `Practise ${plural(words, 'word')}`}
          </button>
        </>
      )}
    </div>
  );
}

function PracticeDrill({ ids }: { ids: number[] }) {
  const [pages, setPages] = useState<PageDetail[] | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [finished, setFinished] = useState(false);
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const start = (from: PageDetail[]) => {
    setDrill(startDrill([...new Set(from.flatMap((p) => p.words.map((w) => w.id)))], 'shuffled'));
    setFinished(false);
    setRound((r) => r + 1);
  };

  useEffect(() => {
    // Learned pages only, each once; a page deleted since the link was made is left out.
    Promise.allSettled([...new Set(ids)].map((id) => api.page(id))).then((results) => {
      const p = results
        .flatMap((r) => (r.status === 'fulfilled' && r.value.stage === 'graduated' ? [r.value] : []))
        .sort((a, b) => a.number - b.number);
      if (p.length === 0) return setError('None of these pages is learned (or they were deleted). Pick learned pages to practise.');
      setPages(p);
      start(p);
    });
  }, [ids.join(',')]);

  if (error)
    return (
      <div className="stack">
        <Notice kind="error">{error}</Notice>
        <a className="button" href="#/practise">
          Pick pages to practise
        </a>
      </div>
    );
  if (!pages || !drill) return <p className="muted">Loading…</p>;

  const which = pages.length === 1 ? `Page ${pages[0].number}` : `Pages ${pages.map((p) => p.number).join(', ')}`;
  const back = pages.length === 1 ? `#/pages/${pages[0].id}` : '#/practise';

  if (finished) {
    const missed = Object.keys(drill.misses).length;
    return (
      <div className="stack">
        <h1>Practise · {which}</h1>
        <Notice kind="success">
          <p data-testid="practice-done">
            Done: {plural(drill.total, 'card')}
            {missed > 0 ? `, ${plural(missed, 'card')} needed another go` : ', all right first time'}. Nothing was counted.
          </p>
        </Notice>
        <button className="button button--primary button--wide" onClick={() => start(pages)}>
          Practise again
        </button>
        <a className="button button--wide" href="#/practise">
          Pick other pages
        </a>
      </div>
    );
  }

  return (
    <Drill
      key={round}
      pages={pages}
      title={`Practise · ${which}`}
      practice
      stage="shuffled"
      state={drill}
      onChange={setDrill}
      onDone={() => setFinished(true)}
      onQuit={() => navigate(back.slice(1))}
    />
  );
}
