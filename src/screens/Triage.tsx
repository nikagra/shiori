import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type ListSummary, type Word } from '../api';
import { JapaneseWord, Meaning, Notice, SaveStatus, SpeakButton, useKeys } from '../components/ui';
import { useSettings } from '../settings';
import { speak } from '../speech';
import { useDictStatus } from '../components/DictSearch';

// One recall check per imported word: known words go straight to spaced
// review, the rest wait for a page.

export function Triage() {
  const dict = useDictStatus();
  const [batch, setBatch] = useState<Word[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [moved, setMoved] = useState('');
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  /** The answer whose save was lost, if any. */
  const lost = useRef<{ wordId: number; result: 'known' | 'unknown' | 'ignore' } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ known: 0, unknown: 0, ignore: 0 });
  const [error, setError] = useState<string | null>(null);
  const [settings, update] = useSettings();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  // A remembered list that's gone (merged, archived, done) falls back to all lists.
  const from = lists?.some((l) => l.id === settings.checkList && !l.archived && l.counts.toCheck > 0) ? settings.checkList : null;

  useEffect(() => {
    api.lists().then(setLists, (e: Error) => setError(e.message));
  }, []);

  const load = useCallback(() => {
    if (!lists) return;
    api.triage(from).then(
      (r) => {
        // This list is done: fresh counts move on to all lists.
        if (r.words.length === 0 && from !== null) {
          api.lists().then(setLists, (e: Error) => setError(e.message));
          return;
        }
        setBatch(r.words);
        setRemaining(r.remaining);
        setIndex(0);
        setRevealed(false);
        setMoved('');
      },
      (e: Error) => setError(e.message),
    );
  }, [lists, from]);
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
    setSaving(true);
    setSaveError(null);
    try {
      let counted = true;
      try {
        await api.triageAnswer(word.id, result);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        // Already checked. The same answer sent again after a lost save most
        // likely got through the first time; anything else (another answer,
        // another device) moves on without counting.
        counted = lost.current?.wordId === word.id && lost.current.result === result;
      }
      lost.current = null;
      if (counted) setCounts((c) => ({ ...c, [result]: c[result] + 1 }));
      setRemaining((r) => r - 1);
      if (index + 1 < (batch?.length ?? 0)) {
        setIndex(index + 1);
        setRevealed(false);
        setMoved('');
      } else {
        load();
      }
    } catch (e) {
      // Turned down: sending it again won't help.
      if (e instanceof ApiError && e.refused) return setError(e.message);
      // Lost on the way: the card stays, so answering again sends it again.
      lost.current = { wordId: word.id, result };
      setSaveError((e as Error).message);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  useKeys({ Space: reveal, Enter: reveal, '1': () => answer('unknown'), '2': () => answer('known') }, Boolean(word));

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!batch || !lists) return <p className="muted">Loading…</p>;

  const toCheck = lists.filter((l) => !l.archived && l.counts.toCheck > 0);
  const picker = toCheck.length > 0 && (
    <label className="field">
      <span>From list</span>
      <select value={from ?? ''} onChange={(e) => update({ checkList: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">All lists, by priority</option>
        {toCheck.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}: {l.counts.toCheck} to check
          </option>
        ))}
      </select>
    </label>
  );

  if (!word) {
    return (
      <div className="stack">
        <h1>Check imported words</h1>
        <Notice kind="success">
          <p>Nothing left to check.</p>
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
            <span lang="ja">{moved}</span> moved to Still learning: furigana will show over it until you take it off that list in Settings.
          </p>
        )}
        {word.mastery !== null && <span className="badge">Renshuu {word.mastery}%</span>}
        {revealed && (
          <div className="flash__answer">
            <SpeakButton text={word.kana} />
            <Meaning word={word} />
            {word.usuallyKana && <p className="muted small">Usually written in kana.</p>}
          </div>
        )}
        {/* Only once the whole dictionary is in: while it loads, a rarer word may just not be there yet. */}
        {word.dict === 'none' && dict?.complete && (
          <p className="muted small" data-testid="not-in-dictionary">
            Not in the dictionary: check its spelling in <a href={`#/lists/${word.listId}`}>its list</a>.
          </p>
        )}
      </article>

      {!revealed ? (
        <button className="button button--primary button--wide" onClick={reveal}>
          Show answer
        </button>
      ) : (
        <div className="stack stack--tight">
          <div className="grade-row grade-row--two">
            <button className="button button--again" onClick={() => answer('unknown')} disabled={saving}>
              I didn’t know
            </button>
            <button className="button button--good" onClick={() => answer('known')} disabled={saving}>
              I knew it
            </button>
          </div>
          <button className="link-button" onClick={() => answer('ignore')} disabled={saving}>
            Not worth learning — remove it
          </button>
          <SaveStatus sending={saving} error={saveError} />
        </div>
      )}
    </div>
  );
}
