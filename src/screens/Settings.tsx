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
import { NEW_WORDS_CHOICES, NEW_WORDS_DEFAULT, type StudyPrefs } from '../../shared/study';
import { TYPING_CARDS_PER_DAY } from '../../shared/lists';

/** `scrollTo` names a section to bring into view, e.g. "backup" from Home's warning. */
export function Settings({ scrollTo }: { scrollTo?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollTo) root.current?.querySelector(`[data-section="${scrollTo}"]`)?.scrollIntoView({ block: 'start' });
  }, [scrollTo]);

  return (
    <div className="stack" ref={root}>
      <h1>Settings</h1>
      <NewWords />
      <DeviceSettings />
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
      <Grading />
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
          <p className="muted small">Words you import or add are looked up by themselves, and opening Home looks up any still waiting (also words with no match while the dictionary was loading). Editing a word lets you pick its entry.</p>
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

/** Saved on the server, so the phone and the laptop share it. */
function NewWords() {
  const [prefs, setPrefs] = useState<StudyPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.study().then(setPrefs, (e: Error) => setError(e.message));
  }, []);
  const value = prefs?.newWordsPerDay ?? null;

  const change = (n: number) => {
    setPrefs((p) => p && { ...p, newWordsPerDay: n });
    api.setStudy({ newWordsPerDay: n }).then(
      () => setError(null),
      (e: Error) => {
        setError(e.message);
        // Show what the server holds now, whatever order the saves landed in.
        api.study().then(setPrefs, () => undefined);
      },
    );
  };
  // An odd number saved through the API still shows.
  const choices = value === null || (NEW_WORDS_CHOICES as readonly number[]).includes(value) ? NEW_WORDS_CHOICES : [...NEW_WORDS_CHOICES, value].sort((a, b) => a - b);

  return (
    <section className="card stack" aria-label="New words" data-section="new-words">
      <h2>New words</h2>
      <label className="field">
        New words a day
        <select value={value ?? NEW_WORDS_DEFAULT} disabled={value === null} onChange={(e) => change(Number(e.target.value))}>
          {choices.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Words count when you start a page with them. Once you reach this number, Pages asks before starting another. Words you already knew in the check pass don't
        count: their typing cards come {TYPING_CARDS_PER_DAY} a day in review.
      </p>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Shared by all your devices.</p>
    </section>
  );
}

/** The short version of "Buttons and what they do" in DESIGN.md, and whether review shows the intervals. */
function Grading() {
  const [show, setShow] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.study().then(
      (p) => setShow(p.showIntervals),
      (e: Error) => setError(e.message),
    );
  }, []);
  const change = (next: boolean) => {
    setShow(next);
    api.setStudy({ showIntervals: next }).then(
      () => setError(null),
      (e: Error) => {
        setError(e.message);
        api.study().then((p) => setShow(p.showIntervals), () => undefined);
      },
    );
  };

  return (
    <section className="card stack stack--tight" aria-label="Grading" data-section="grading">
      <h2>How grading works</h2>
      <label className="toggle">
        <input type="checkbox" checked={show ?? true} disabled={show === null} onChange={(e) => change(e.target.checked)} />
        Show when each grade brings the word back
      </label>
      <p className="muted small">
        A line under the grade buttons in review. The real date varies a little: a day or two at a week, weeks at a year. Shared by all your devices.
      </p>
      {error && <p className="error">{error}</p>}
      <dl className="grading">
        <dt className="grading__again">Again</dt>
        <dd>You didn't recall it, or recalled it wrongly. It comes back soon (the button says when) and counts as a lapse: four make a leech, which leaves review until you give it a new approach.</dd>
        <dt className="grading__hard">Hard</dt>
        <dd>You recalled it, but slowly, with effort or unsure. A pass, with a shorter interval than Good.</dd>
        <dt className="grading__good">Good</dt>
        <dd>You recalled it normally. The usual answer when you got it right.</dd>
        <dt className="grading__easy">Easy</dt>
        <dd>Instant and effortless. Use it rarely: it pushes the word far away.</dd>
      </dl>
      <p className="small">
        Don't know counts as Again, and so does a wrong typed answer: the only button left then is Continue. Show answer is for when you think you know it,
        and you grade yourself.
      </p>
      <p className="small">
        Be honest rather than kind. Good on a guess hides the word for weeks; Again only brings it back sooner. On a word you know well, Again drops months to
        days, so an honest Again early on is the cheap one.
      </p>
    </section>
  );
}

/** Page size and audio are kept on this device: the phone and the laptop can differ. */
function DeviceSettings() {
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
