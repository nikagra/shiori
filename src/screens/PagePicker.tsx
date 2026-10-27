import { useEffect, useState } from 'react';
import { api, writtenForm, type ListSummary, type ListWord } from '../api';
import { Notice, plural } from '../components/ui';
import { SimilarNotice } from '../components/SimilarNotice';
import { pickable, WordPicker } from '../components/WordPicker';
import { navigate } from '../nav';
import { similarPairs } from '../../shared/similar';
import { useSettings } from '../settings';

// A new page from words you pick yourself, from one list, in the order you
// pick them. Words still to check can go on it too: picking one says you
// don't know it yet.

export function PagePicker({ listId: initial }: { listId: number | null }) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [listId, setListId] = useState<number | null>(initial);
  const [words, setWords] = useState<ListWord[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings] = useSettings();

  useEffect(() => {
    api.lists().then(setLists, (e: Error) => setError(e.message));
  }, []);
  const choices = (lists ?? []).filter((l) => !l.archived && l.counts.inbox + l.counts.toCheck > 0);
  // Without a list in the link: the one "Pick for me" would take, or the first with words.
  const current = listId ?? (lists ? (choices.find((l) => l.next) ?? choices[0])?.id ?? null : null);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    if (current === null) return;
    let stale = false;
    setWords(null);
    // A slower answer for the list you just left must not replace this one.
    api.listWords(current).then(
      (w) => !stale && setWords(pickable(w)),
      (e: Error) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [current, loaded]);

  if (!lists) return error ? <Notice kind="error">{error}</Notice> : <p className="muted">Loading…</p>;
  const list = lists.find((l) => l.id === current);
  const size = settings.pageSize;
  const full = picked.length >= size;
  const byId = new Map((words ?? []).map((w) => [w.id, w]));
  const pickedWords = picked.map((id) => byId.get(id)).filter((w): w is ListWord => Boolean(w));

  const similar = similarPairs(pickedWords).length;

  const toggle = (w: ListWord) => setPicked((p) => (p.includes(w.id) ? p.filter((id) => id !== w.id) : p.length < size ? [...p, w.id] : p));

  async function start() {
    if (current === null) return;
    setBusy(true);
    try {
      const page = await api.createPickedPage(size, current, picked);
      navigate(`/pages/${page.id}`);
    } catch (e) {
      // A picked word may have changed meanwhile: show the list as it is now.
      setError((e as Error).message);
      setPicked([]);
      setLoaded((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <div className="stack picker">
      <a href="#/pages" className="link-button link-button--back">
        ← Pages
      </a>
      <h1>Pick the words</h1>
      {choices.length === 0 ? (
        <p className="muted">
          No words are waiting or still to check. <a href="#/settings/import">Import words</a> first.
        </p>
      ) : (
        <>
          <p className="muted">
            Choose up to {size} words from one list. They go on the page in the order you pick them. Tap a picked word again to take it off.
          </p>
          <label className="field">
            <span>From list</span>
            <select
              value={current ?? ''}
              onChange={(e) => {
                setListId(Number(e.target.value));
                setPicked([]);
                setError(null);
              }}
            >
              {choices.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}: {l.counts.inbox} waiting{l.counts.toCheck > 0 ? `, ${l.counts.toCheck} to check` : ''}
                </option>
              ))}
              {list && !choices.includes(list) && <option value={list.id}>{list.name}</option>}
            </select>
          </label>
          {error && <Notice kind="error">{error}</Notice>}
          {pickedWords.length > 0 && (
            <section className="stack stack--tight" aria-label="Your page">
              <ol className="chips picker__picked" aria-label="Picked words">
                {pickedWords.map((w, i) => (
                  <li key={w.id}>
                    <button type="button" className="chip" aria-label={`Take ${writtenForm(w)} off`} onClick={() => toggle(w)}>
                      <span className="chip__count">{i + 1}</span> <span lang="ja">{writtenForm(w)}</span> ×
                    </button>
                  </li>
                ))}
              </ol>
              <SimilarNotice words={pickedWords} action="Tap one above to take it off, if you'd rather learn them on different pages." />
            </section>
          )}
          {words === null ? <p className="muted">Loading…</p> : <WordPicker words={words} picked={picked} onPick={toggle} full={full} label={`Search ${list?.name ?? 'words'}`} />}

          <div className="picker__bar">
            <p data-testid="picked-count">
              <strong>
                {picked.length} of {size}
              </strong>{' '}
              picked{full ? ', the page is full' : ''}
              {similar > 0 && <span className="picker__warn"> · {plural(similar, 'pair')} close in meaning</span>}
            </p>
            <button className="button button--primary" disabled={busy || picked.length === 0} onClick={start}>
              Start the page
            </button>
          </div>
          <p className="muted small">
            {size} words per page. Change it in <a href="#/settings">Settings</a>.
          </p>
        </>
      )}
    </div>
  );
}
