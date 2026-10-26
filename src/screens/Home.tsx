import { useEffect, useState } from 'react';
import { api, type Stats } from '../api';
import { Notice } from '../components/ui';
import { backupFileName, KEEP_DAYS, nightlyIsStale, type NightlyStatus } from '../../shared/backup';
import { HINTS_TO_LEARNING, type FuriganaPrefs, type KanjiLevel } from '../../shared/furigana';
import { useFurigana } from '../furigana';
import { useSettings } from '../settings';
import { canSpeak, hasJapaneseVoice } from '../speech';

export function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, update] = useSettings();
  const [voice, setVoice] = useState(hasJapaneseVoice());

  useEffect(() => {
    api.stats().then(setStats, (e: Error) => setError(e.message));
    if (canSpeak()) {
      const check = () => setVoice(hasJapaneseVoice());
      window.speechSynthesis.addEventListener('voiceschanged', check);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', check);
    }
  }, []);

  if (error) return <Notice kind="error">Could not load: {error}</Notice>;
  if (!stats) return <p className="muted">Loading…</p>;

  const empty = stats.toCheck + stats.inbox + stats.learned + stats.pagesInProgress === 0;

  return (
    <div className="stack">
      {empty && (
        <Notice>
          <p>Welcome. Start by <a href="#/import">importing a Renshuu list</a>.</p>
        </Notice>
      )}

      <section className="tiles">
        <a href="#/review" className={`tile${stats.reviewsDue > 0 ? ' tile--primary' : ''}`} data-testid="tile-review">
          <span className="tile__value">{stats.reviewsDue}</span>
          <span className="tile__label">reviews today</span>
        </a>
        <a href="#/pages" className="tile" data-testid="tile-pages">
          <span className="tile__value">{stats.pagesInProgress}</span>
          <span className="tile__label">{stats.pagesInProgress === 1 ? 'page in progress' : 'pages in progress'}</span>
        </a>
        <a href="#/pages" className="tile" data-testid="tile-inbox">
          <span className="tile__value">{stats.inbox}</span>
          <span className="tile__label">waiting for a page</span>
        </a>
        <a href="#/check" className="tile" data-testid="tile-check">
          <span className="tile__value">{stats.toCheck}</span>
          <span className="tile__label">imported, to check</span>
        </a>
      </section>

      <p className="muted">{stats.learned} {stats.learned === 1 ? 'word' : 'words'} in spaced review.</p>

      <section className="card stack">
        <h2>Audio</h2>
        {!canSpeak() || !voice ? (
          <p className="muted">No Japanese voice found on this device. On iPhone: Settings › Accessibility › Spoken Content › Voices › Japanese.</p>
        ) : null}
        <label className="toggle">
          <input type="checkbox" checked={settings.autoPlay} onChange={(e) => update({ autoPlay: e.target.checked })} />
          Play the word when the answer is shown
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.listenFirst} onChange={(e) => update({ listenFirst: e.target.checked })} />
          Listening practice: hear Japanese→meaning cards before seeing them
        </label>
      </section>

      <FuriganaSettings />

      <Backup />
    </div>
  );
}

function Backup() {
  const [nightly, setNightly] = useState<NightlyStatus | null>(null);
  const [nightlyError, setNightlyError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.nightlyBackups().then(setNightly, () => setNightlyError(true));
  }, []);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { backup, text } = await api.backup();
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName(backup.exportedAt);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(`Download failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const savedAt = nightly?.latest?.savedAt;
  return (
    <section className="card stack" aria-label="Backup">
      <h2>Backup</h2>
      <p className="muted">One file with all your words, pages, cards, review history and settings.</p>
      <button type="button" className="button" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download backup'}
      </button>
      {error && <p className="error">{error}</p>}
      <p className={nightlyError || (savedAt && nightlyIsStale(savedAt, new Date())) ? 'error' : 'muted'} data-testid="nightly-status">
        {nightlyError
          ? 'Could not check the nightly copies.'
          : !nightly
            ? 'Checking the nightly copies…'
            : savedAt
              ? `Nightly copy saved ${new Date(savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. ${nightly.count} ${nightly.count === 1 ? 'copy' : 'copies'} kept, the last ${KEEP_DAYS} days at most.` +
                (nightlyIsStale(savedAt, new Date()) ? ' Newer runs have failed: check the Worker logs in Cloudflare.' : '')
              : 'No nightly copy yet. The first one is saved tonight.'}
      </p>
    </section>
  );
}

/** Saved on the server, so the phone and the laptop share them. */
function FuriganaSettings() {
  const { prefs, save } = useFurigana();
  const [draft, setDraft] = useState(prefs);
  const [editing, setEditing] = useState<'knownKanji' | 'learningKanji' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Follow the server, e.g. after a peek moved a kanji to "still learning",
  // but leave the box you're typing in alone.
  useEffect(() => setDraft((d) => (editing ? { ...prefs, [editing]: d[editing] } : prefs)), [prefs]);

  const commit = (next: FuriganaPrefs) => {
    setDraft(next);
    save(next).then(
      () => setError(null),
      (e: Error) => setError(e.message),
    );
  };
  const commitIfChanged = () => {
    setEditing(null);
    if (draft.knownKanji !== prefs.knownKanji || draft.learningKanji !== prefs.learningKanji) commit(draft);
  };

  return (
    <section className="card stack" aria-label="Furigana">
      <h2>Furigana</h2>
      <p className="muted">
        Readings show above kanji you don't know yet. On a question, “Show furigana” reveals the rest; peeking at the same kanji {HINTS_TO_LEARNING === 2 ? "twice" : `${HINTS_TO_LEARNING} times`} moves it to Still learning.
      </p>
      <label className="field">
        Kanji I know
        <select value={draft.kanjiLevel} onChange={(e) => commit({ ...draft, kanjiLevel: e.target.value as KanjiLevel })}>
          <option value="n4">N5 and N4</option>
          <option value="n5">N5</option>
          <option value="none">None (furigana on every kanji)</option>
        </select>
      </label>
      <label className="field">
        Also known
        <input
          lang="ja"
          value={draft.knownKanji}
          placeholder="e.g. 誰 必"
          onFocus={() => setEditing('knownKanji')}
          onChange={(e) => setDraft({ ...draft, knownKanji: e.target.value })}
          onBlur={commitIfChanged}
        />
      </label>
      <label className="field">
        Still learning (always show furigana)
        <input
          lang="ja"
          value={draft.learningKanji}
          placeholder="e.g. 験 貸"
          onFocus={() => setEditing('learningKanji')}
          onChange={(e) => setDraft({ ...draft, learningKanji: e.target.value })}
          onBlur={commitIfChanged}
        />
      </label>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
