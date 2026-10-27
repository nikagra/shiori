import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { backupFileName, KEEP_DAYS, nightlyIsStale, type NightlyStatus } from '../../shared/backup';
import { HINTS_TO_LEARNING, type FuriganaPrefs, type KanjiLevel } from '../../shared/furigana';
import { PAGE_SIZES } from '../../shared/pageSession';
import { useFurigana } from '../furigana';
import { useSettings } from '../settings';
import { canSpeak, hasJapaneseVoice } from '../speech';
import { lookUpAll } from '../components/DictSearch';
import { DICT_CREDITS } from '../../shared/dictionary';
import type { DictStatus } from '../api';

/** `scrollTo` names a section to bring into view, e.g. "backup" from Home's warning. */
export function Settings({ scrollTo }: { scrollTo?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollTo) root.current?.querySelector(`[data-section="${scrollTo}"]`)?.scrollIntoView({ block: 'start' });
  }, [scrollTo]);

  return (
    <div className="stack" ref={root}>
      <h1>Settings</h1>
      <StudySettings />
      <FuriganaSettings />
      <section className="card stack stack--tight" aria-label="Words">
        <h2>Words</h2>
        <a href="#/settings/import" className="link-button">
          Import from Renshuu
        </a>
        <a href="#/lists" className="link-button">
          Lists, weights and weekly targets
        </a>
      </section>
      <Backup />
      {/* Below Backup: it grows once its status loads, which mustn't push
          Backup away after Home's warning scrolled to it. */}
      <Dictionary />
    </div>
  );
}

/** What's loaded, how your words match it, and the credits its licence asks for. */
function Dictionary() {
  const [status, setStatus] = useState<DictStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.dictStatus().then(setStatus, (e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const lookUp = async () => {
    setBusy('Looking up…');
    setError(null);
    try {
      await lookUpAll((remaining) => setBusy(`Looking up… ${remaining} to go`));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };

  return (
    <section className="card stack stack--tight" aria-label="Dictionary" data-section="dictionary">
      <h2>Dictionary</h2>
      {error && <p className="error">{error}</p>}
      {!status ? (
        !error && <p className="muted">Checking…</p>
      ) : status.loaded === 0 ? (
        <p className="error" data-testid="dict-status">
          Not loaded yet. On the laptop, run <code>npm run dict:load -- --remote</code> (see DESIGN.md, Dictionary).
        </p>
      ) : (
        <>
          <p className="muted" data-testid="dict-status">
            {status.version}
            {status.complete ? '.' : `: ${status.loaded} of ${status.chunks} parts loaded so far (common words first).`}
          </p>
          <p className="small" data-testid="dict-words">
            Your words: {status.words.linked} in the dictionary
            {status.words.none > 0 && `, ${status.words.none} not found${status.complete ? '' : ' yet'}`}
            {status.words.unchecked > 0 && `, ${status.words.unchecked} not looked up yet`}.
          </p>
          <button type="button" className="button" onClick={lookUp} disabled={busy !== null}>
            {busy ?? 'Look up my words'}
          </button>
          <p className="muted small">Words you import or add are looked up by themselves. A word with no match is looked up again as the dictionary fills; editing a word lets you pick its entry.</p>
        </>
      )}
      <p className="muted small">
        Uses{' '}
        {DICT_CREDITS.map((c, i) => (
          <span key={c.name}>
            {i > 0 && (i === DICT_CREDITS.length - 1 ? ' and ' : ', ')}
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.name}
            </a>{' '}
            ({c.by})
          </span>
        ))}
        , under the Creative Commons Attribution-ShareAlike 4.0 licence.
      </p>
    </section>
  );
}

/** Page size and audio are kept on this device: the phone and the laptop can differ. */
function StudySettings() {
  const [settings, update] = useSettings();
  const [voice, setVoice] = useState(hasJapaneseVoice());
  useEffect(() => {
    if (!canSpeak()) return;
    const check = () => setVoice(hasJapaneseVoice());
    window.speechSynthesis.addEventListener('voiceschanged', check);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', check);
  }, []);

  return (
    <>
      <section className="card stack" aria-label="Pages">
        <h2>Pages</h2>
        <div className="row">
          <span>Words per page</span>
          <div className="segmented" role="group" aria-label="Words per page">
            {PAGE_SIZES.map((s) => (
              <button key={s} className={settings.pageSize === s ? 'is-active' : ''} aria-pressed={settings.pageSize === s} onClick={() => update({ pageSize: s })}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">Used for the next new page. Saved on this device.</p>
      </section>

      <section className="card stack" aria-label="Audio">
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
        <p className="muted small">Saved on this device.</p>
      </section>
    </>
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
    <section className="card stack" aria-label="Backup" data-section="backup">
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
      <p className="muted small">Shared by all your devices.</p>
    </section>
  );
}
