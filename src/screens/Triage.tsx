import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TriageList, type Word } from '../api';
import { JapaneseWord, Meaning, Notice, SpeakButton, useKeys } from '../components/ui';
import { useSettings } from '../settings';
import { speak } from '../speech';

// One recall check per imported word: known words go straight to spaced
// review, the rest wait for a page. A big import doesn't have to block the
// others: pick one list to check (#/check/3), or all of them (#/check).

export function Triage({ listId }: { listId: number | null }) {
  const [batch, setBatch] = useState<Word[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [lists, setLists] = useState<TriageList[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [moved, setMoved] = useState('');
  const sending = useRef(false);
  const [counts, setCounts] = useState({ known: 0, unknown: 0, ignore: 0 });
  const [error, setError] = useState<string | null>(null);
  const [settings] = useSettings();

  const load = useCallback(() => {
    api.triage(listId).then(
      (r) => {
        setBatch(r.words);
        setRemaining(r.remaining);
        setLists(r.lists);
        setIndex(0);
        setRevealed(false);
        setMoved('');
      },
      (e: Error) => setError(e.message),
    );
  }, [listId]);
  useEffect(load, [load]);

  const word = batch?.[index];

  const reveal = () => {
    if (!word || revealed) return;
    setRevealed(true);
    if (settings.autoPlay) speak(word.kana);
  };

  const answer = async (result: 'known' | 'unknown' | 'ignore') => {
    // One answer per word: a double tap or a repeated key does nothing.
    if (!word || !revealed || sending.current) return;
    sending.current = true;
    try {
      await api.triageAnswer(word.id, result);
      setCounts((c) => ({ ...c, [result]: c[result] + 1 }));
      setRemaining((r) => r - 1);
      if (index + 1 < (batch?.length ?? 0)) {
        setIndex(index + 1);
        setRevealed(false);
        setMoved('');
      } else {
        load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
    }
  };

  useKeys({ Space: reveal, Enter: reveal, '1': () => answer('unknown'), '2': () => answer('known') }, Boolean(word));

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!batch) return <p className="muted">Loading…</p>;

  const listName = lists.find((l) => l.id === listId)?.name;
  // Lists with words to check, plus the chosen one even once it's done.
  const choices = lists.filter((l) => l.remaining > 0 || l.id === listId);
  const picker = (choices.length > 1 || listId !== null) && (
    <label className="row row--between">
      <span>List</span>
      <select
        className="select--auto"
        aria-label="List to check"
        value={listId ?? ''}
        onChange={(e) => (window.location.hash = e.target.value ? `#/check/${e.target.value}` : '#/check')}
      >
        <option value="">All lists ({lists.reduce((n, l) => n + l.remaining, 0)})</option>
        {choices.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} ({l.remaining})
          </option>
        ))}
      </select>
    </label>
  );

  if (!word) {
    return (
      <div className="stack">
        <h1>Check imported words</h1>
        {picker}
        <Notice kind="success">
          <p>Nothing left to check{listName ? ` in ${listName}` : ''}.</p>
          {counts.known + counts.unknown > 0 && (
            <p>
              This session: {counts.known} known, {counts.unknown} to learn on pages.
            </p>
          )}
        </Notice>
        <a className="button button--primary" href="#/pages">
          Go to pages
        </a>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Check imported words</h1>
        <span className="muted" data-testid="triage-remaining">
          {remaining} left
        </span>
      </div>
      {picker}
      <p className="muted">Say the meaning to yourself first, then reveal. Be strict: only “I knew it” if it came without guessing.</p>

      <article className="card flash" data-testid="triage-card">
        <JapaneseWord word={word} showReading={revealed} onHint={setMoved} />
        {moved && (
          <p className="muted small" data-testid="moved-to-learning">
            <span lang="ja">{moved}</span> moved to Still learning: furigana will show over it until you take it off that list on Home.
          </p>
        )}
        {word.mastery !== null && <span className="badge">Renshuu {word.mastery}%</span>}
        {revealed && (
          <div className="flash__answer">
            <SpeakButton text={word.kana} />
            <Meaning word={word} />
          </div>
        )}
      </article>

      {!revealed ? (
        <button className="button button--primary button--wide" onClick={reveal}>
          Show answer
        </button>
      ) : (
        <div className="stack stack--tight">
          <div className="grade-row grade-row--two">
            <button className="button button--again" onClick={() => answer('unknown')}>
              I didn’t know
            </button>
            <button className="button button--good" onClick={() => answer('known')}>
              I knew it
            </button>
          </div>
          <button className="link-button" onClick={() => answer('ignore')}>
            Not worth learning — remove it
          </button>
        </div>
      )}
    </div>
  );
}
