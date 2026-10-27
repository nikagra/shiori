import { useEffect, useMemo, useState } from 'react';
import { api, shortPos, writtenForm, type ListWord, type PageDetail } from '../api';
import { PageGrid } from '../components/PageGrid';
import { SimilarNotice } from '../components/SimilarNotice';
import { JapaneseWord, KanaInput, Meaning, Notice, plural, Progress, SpeakButton, useKeys } from '../components/ui';
import { pickable, WordPicker } from '../components/WordPicker';
import { navigate } from '../nav';
import { answerStep, currentStep, drillFits, isDrillDone, MAX_PAGE_WORDS, missesByCard, startDrill, type DrillState, type DrillStep } from '../../shared/pageSession';
import { checkReading } from '../../shared/kana';
import { useSettings } from '../settings';
import { speak } from '../speech';

const STEP_TEXT = {
  ordered: {
    title: 'Step 1 · In order',
    intro: 'Study the page, then go through it in order: first each word → meaning, then each meaning → word.',
    start: 'Start step 1',
    short: 'step 1',
  },
  shuffled: {
    title: 'Step 2 · Shuffled',
    intro: 'The same words in random order, both directions mixed. Only the position on the page is shown.',
    start: 'Start step 2',
    short: 'step 2',
  },
} as const;

// A drill in progress is kept on this device, so Stop and Start carries on
// with the same misses instead of starting clean. The key has the page's
// creation time too: a deleted page's id can be given to a new page.
type DrillPage = Pick<PageDetail, 'id' | 'createdAt'>;
const drillKey = (page: DrillPage, stage: string) => `shiori.drill.${page.id}.${page.createdAt}.${stage}`;

function savedDrill(page: PageDetail): DrillState | null {
  if (page.stage === 'graduated') return null;
  try {
    const saved = JSON.parse(localStorage.getItem(drillKey(page, page.stage)) ?? 'null') as DrillState | null;
    return saved && drillFits(saved, page.words.map((w) => w.id)) ? saved : null;
  } catch {
    return null;
  }
}

/** Keeps a drill once something in it is answered; null (or nothing answered yet) forgets it. */
function saveDrill(page: DrillPage, stage: string, drill: DrillState | null) {
  try {
    if (drill && (drill.done.length > 0 || Object.keys(drill.misses).length > 0)) localStorage.setItem(drillKey(page, stage), JSON.stringify(drill));
    else localStorage.removeItem(drillKey(page, stage));
  } catch {
    // Private mode or full storage: the drill still works, it just isn't kept.
  }
}

export function PageView({ id }: { id: number }) {
  const [page, setPage] = useState<PageDetail | null>(null);
  const [drill, setDrillState] = useState<DrillState | null>(null);
  const setDrill = (next: DrillState | null) => {
    setDrillState(next);
    if (next && page && page.stage !== 'graduated') saveDrill(page, page.stage, next);
  };
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    api.page(id).then(setPage, (e: Error) => setError(e.message));
  }, [id]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!page) return <p className="muted">Loading…</p>;

  if (drill && page.stage !== 'graduated') {
    const stage = page.stage;
    return (
      <Drill
        page={page}
        stage={stage}
        state={drill}
        onChange={setDrill}
        onDone={async () => {
          try {
            const next = await api.completeStage(page.id, stage, missesByCard(drill));
            saveDrill(page, stage, null);
            setPage(next);
            setDrill(null);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        onQuit={() => setDrill(null)}
      />
    );
  }

  const ids = page.words.map((w) => w.id);
  const saved = savedDrill(page);

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>
          Page {page.number}
          {page.listName && <span className="muted h1__sub"> · {page.listName}</span>}
        </h1>
        <a href="#/pages" className="link-button">
          All pages
        </a>
      </div>

      {page.stage === 'graduated' ? (
        <>
          <Notice kind="success">
            <p data-testid="page-learned">Learned. These words are now in spaced review; the first check comes tomorrow.</p>
          </Notice>
          <StepTwoMisses page={page} />
        </>
      ) : (
        <section className="stack stack--tight">
          <h2>{STEP_TEXT[page.stage].title}</h2>
          <p className="muted">{STEP_TEXT[page.stage].intro}</p>
        </section>
      )}

      {page.stage === 'ordered' && !editing && <SimilarNotice words={page.words} action="Change words below to swap one for another word." />}

      <PageGrid page={page} mode="full" />

      {editing && page.stage === 'ordered' ? (
        <PageEditor
          page={page}
          onChange={(next) => {
            // Other words make a saved drill out of date: the next Start is fresh.
            saveDrill(page, 'ordered', null);
            setPage(next);
          }}
          onDone={() => setEditing(false)}
        />
      ) : (
        page.stage !== 'graduated' && (
          <>
            <button className="button button--primary button--wide" onClick={() => page.stage !== 'graduated' && setDrill(saved ?? startDrill(ids, page.stage))}>
              {saved ? `Continue ${STEP_TEXT[page.stage].short} (${saved.completed} of ${saved.total} done)` : STEP_TEXT[page.stage].start}
            </button>
            {page.stage === 'ordered' && (
              <button className="button button--wide" onClick={() => setEditing(true)}>
                Change words
              </button>
            )}
          </>
        )
      )}

      <div className="danger-zone stack stack--tight">
        {deleteError && <Notice kind="error">{deleteError}</Notice>}
        <button
          className="link-button"
          onClick={async () => {
            const what =
              page.stage === 'graduated'
                ? 'Its words stay in review with their history, but review can no longer show you this page.'
                : `Its ${plural(page.words.length, 'word')} go back to waiting for a page.`;
            if (!window.confirm(`Delete page ${page.number}? ${what}`)) return;
            try {
              await api.deletePage(page.id);
              for (const stage of ['ordered', 'shuffled']) saveDrill(page, stage, null);
              navigate('/pages');
            } catch (e) {
              setDeleteError((e as Error).message);
            }
          }}
        >
          Delete this page
        </button>
      </div>
    </div>
  );
}

/**
 * Changing a new page's words before you drill it: swap one that's too close
 * in meaning to another, take one off, or add one, all from the page's list.
 */
function PageEditor({ page, onChange, onDone }: { page: PageDetail; onChange: (page: PageDetail) => void; onDone: () => void }) {
  const [words, setWords] = useState<ListWord[] | null>(null);
  /** The word being changed, or 'add' for a new word at the end. */
  const [selected, setSelected] = useState<number | 'add' | null>(null);
  const [picking, setPicking] = useState(false);
  const [setAside, setSetAside] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [settings] = useSettings();

  const load = () => {
    if (page.listId !== null) api.listWords(page.listId).then((w) => setWords(pickable(w)), (e: Error) => setError(e.message));
  };
  useEffect(load, [page.listId]);

  const select = (id: number | 'add' | null) => {
    setSelected(id);
    setPicking(id === 'add');
    setSetAside(false);
  };
  const next = words?.find((w) => w.status === 'inbox');
  const out = typeof selected === 'number' ? page.words.find((w) => w.id === selected) : undefined;

  const change = async (incoming: ListWord | null) => {
    if (selected === null) return;
    setBusy(true);
    try {
      // The word the button names, not "next": the label and the swap agree.
      const updated = await api.changePageWord(page.id, { wordId: out ? out.id : null, replacement: incoming?.id ?? null, setAside });
      const name = out && writtenForm(out);
      const where = setAside ? 'set aside' : 'back to waiting';
      setError(null);
      setDone(
        !out
          ? `Added ${incoming ? writtenForm(incoming) : 'a word'}.`
          : incoming
            ? `Swapped ${name} for ${writtenForm(incoming)}; ${name} is ${where}.`
            : `Took ${name} off the page; it is ${where}.`,
      );
      onChange(updated);
      select(null);
      load();
    } catch (e) {
      setDone(null);
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const room = page.words.length < Math.min(settings.pageSize, MAX_PAGE_WORDS);

  return (
    <section className="card stack" aria-label="Change words">
      <div className="row row--between">
        <h2>Change words</h2>
        <button className="button button--primary button--small" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="muted small">
        Tap a word to swap it for another from {page.listName ?? 'its list'}, for example one too close in meaning to another. The word you take off goes back to waiting, or you can set it aside.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="success">{done}</Notice>}
      <SimilarNotice words={page.words} action="Swap one of them for another word." />
      <ul className="word-list">
        {page.words.map((w) => (
          <li key={w.id} className={`word-row${selected === w.id ? ' word-row--open' : ''}`} data-testid="page-word">
            <button type="button" className="word-row__head word-row__head--pick" aria-expanded={selected === w.id} onClick={() => select(selected === w.id ? null : w.id)}>
              <span className="pick-mark" aria-hidden="true">
                {w.position + 1}
              </span>
              <span className="word-row__jp" lang="ja">
                <span className="word-row__written">{writtenForm(w)}</span>
                {w.kanji && <span className="word-row__kana">{w.kana}</span>}
              </span>
              <span className="word-row__meaning">{w.coreMeaning}</span>
            </button>
            {selected === w.id && (
              <div className="word-editor stack stack--tight" role="group" aria-label={`Change ${writtenForm(w)}`}>
                <label className="toggle">
                  <input type="checkbox" checked={setAside} onChange={(e) => setSetAside(e.target.checked)} /> Set {writtenForm(w)} aside (don’t learn it)
                </label>
                <button type="button" className="button" disabled={busy || !next} onClick={() => next && change(next)}>
                  {next ? (
                    <>
                      Swap for the next waiting word: <span lang="ja">{writtenForm(next)}</span>
                    </>
                  ) : (
                    'No other words waiting'
                  )}
                </button>
                <button type="button" className="button" disabled={busy} aria-expanded={picking} onClick={() => setPicking(!picking)}>
                  Pick a word instead…
                </button>
                {page.words.length > 1 && (
                  <button type="button" className="button" disabled={busy} onClick={() => change(null)}>
                    Take it off without a replacement
                  </button>
                )}
                {picking && words && <WordPicker words={words} picked={[]} onPick={(p) => !busy && change(p)} label={`Search ${page.listName ?? 'words'}`} />}
              </div>
            )}
          </li>
        ))}
      </ul>
      {room &&
        (selected === 'add' ? (
          <div className="stack stack--tight">
            <div className="row row--between">
              <h3>Add a word</h3>
              <button type="button" className="link-button" onClick={() => select(null)}>
                Cancel
              </button>
            </div>
            {words && <WordPicker words={words} picked={[]} onPick={(p) => !busy && change(p)} label={`Search ${page.listName ?? 'words'}`} />}
          </div>
        ) : (
          <button type="button" className="button" onClick={() => select('add')}>
            Add a word ({page.words.length} of {settings.pageSize})
          </button>
        ))}
    </section>
  );
}

interface StepView {
  of: DrillState;
  revealed: boolean;
  typed: { value: string; correct: boolean } | null;
  /** "Don't know yet" instead of an answer: shown the answer, counted as missed. */
  gaveUp: boolean;
  moved: string;
  /** What was typed when copying the missed word, when it wasn't the word. */
  copied: string | null;
}

const freshView = (of: DrillState): StepView => ({ of, revealed: false, typed: null, gaveUp: false, moved: '', copied: null });

/**
 * A missed card while you type it once. The miss is already counted and the
 * card queued again (so Stop keeps it); this keeps it on screen meanwhile.
 */
interface Copying {
  step: DrillStep;
  view: StepView;
  /** Other cards before it comes back. */
  back: number;
}

function Drill({
  page,
  stage,
  state,
  onChange,
  onDone,
  onQuit,
}: {
  page: PageDetail;
  stage: 'ordered' | 'shuffled';
  state: DrillState;
  onChange: (s: DrillState) => void;
  onDone: () => void;
  onQuit: () => void;
}) {
  const [copying, setCopying] = useState<Copying | null>(null);
  const encoding = copying !== null;
  const step = copying?.step ?? currentStep(state);
  const jpPrompt = step?.direction === 'jp_en';
  const word = useMemo(() => page.words.find((w) => w.id === step?.wordId), [page, step]);
  const [settings] = useSettings();
  // What happened on this step. Tagged with the step's state, so the next
  // step starts fresh on its very first render: no flash of the old answer,
  // and no key press can grade it unseen.
  const [stepView, setStepView] = useState<StepView>(() => freshView(state));
  const view = copying?.view ?? (stepView.of === state ? stepView : freshView(state));
  const { revealed, typed, gaveUp, moved, copied } = view;
  const update = (patch: Partial<Omit<StepView, 'of'>>) =>
    copying ? setCopying({ ...copying, view: { ...view, ...patch } }) : setStepView({ ...view, ...patch });
  const setTyped = (value: StepView['typed']) => update({ typed: value });
  const setMoved = (value: string) => update({ moved: value });

  useEffect(() => {
    if (isDrillDone(state)) onDone();
  }, [state]);

  // Back to the full page in the middle of a drill, to study it again.
  const [studying, setStudying] = useState(false);

  const reveal = (patch: Partial<StepView> = {}) => {
    if (!word || revealed) return;
    update({ revealed: true, ...patch });
    if (settings.autoPlay) speak(word.kana);
  };
  // The only way on after this is Continue, which counts the step as missed.
  const dontKnow = () => {
    if (!word) return;
    if (jpPrompt) reveal({ gaveUp: true });
    else if (!typed) {
      update({ typed: { value: '', correct: false }, gaveUp: true });
      if (settings.autoPlay) speak(word.kana);
    }
  };
  const answer = (correct: boolean) => onChange(answerStep(state, correct));
  // A miss isn't just a red mark: type the word once, looking at it in its
  // spot on the page. Then it comes back after a few other cards.
  const miss = () => {
    if (!step) return;
    const next = answerStep(state, false);
    const back = next.queue.findIndex((s) => s.wordId === step.wordId && s.direction === step.direction);
    setCopying({ step, view: { ...view, revealed: true }, back });
    onChange(next);
    if (settings.autoPlay && word) speak(word.kana);
  };
  useKeys(
    {
      Space: () => (jpPrompt && !revealed ? reveal() : undefined),
      '1': () => (revealed ? miss() : dontKnow()),
      '2': () => (revealed && !gaveUp ? answer(true) : undefined),
    },
    Boolean(step) && jpPrompt && !studying && !encoding,
  );

  // In order, once meaning→Japanese has begun: words still to be asked that
  // way stay hidden, so an answer can't be read off the grid ahead of time,
  // even while a missed Japanese→meaning step comes round again.
  const hidden = useMemo(() => {
    if (stage !== 'ordered') return undefined;
    const pending = state.queue.filter((s) => s.direction === 'en_jp');
    const begun = !jpPrompt || pending.length < page.words.length;
    return begun ? new Set(pending.map((s) => s.wordId)) : undefined;
  }, [stage, jpPrompt, state, page]);

  if (!step || !word) return <p className="muted">Saving…</p>;

  if (studying) {
    return (
      <div className="stack">
        <div className="row row--between">
          <h1>Page {page.number} · study</h1>
        </div>
        <p className="muted">Take your time. The word you were on counts as missed and comes back after a few other cards.</p>
        <PageGrid page={page} mode="full" />
        <button className="button button--primary button--wide" onClick={() => setStudying(false)}>
          Back to the drill
        </button>
      </div>
    );
  }
  const studyAgain = () => {
    // Looking at the page answers the word on screen: it counts as missed.
    answer(false);
    setStudying(true);
  };

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>
          Page {page.number} · {stage === 'ordered' ? 'in order' : 'shuffled'}
        </h1>
        <button className="link-button" onClick={onQuit}>
          Stop
        </button>
      </div>
      <Progress done={state.completed} total={state.total} />

      <PageGrid
        page={page}
        mode={stage === 'ordered' ? 'written' : 'blank'}
        highlight={word.position}
        hideHighlighted={!jpPrompt}
        hiddenIds={hidden}
        revealHighlighted={encoding}
      />

      <article className="card flash" data-testid="drill-card" data-direction={step.direction}>
        {jpPrompt ? (
          <>
            <JapaneseWord word={word} showReading={revealed} onHint={setMoved} />
            {moved && (
              <p className="muted small" data-testid="moved-to-learning">
                <span lang="ja">{moved}</span> moved to Still learning: furigana will show over it until you take it off that list in Settings.
              </p>
            )}
            {revealed && (
              <div className="flash__answer">
                <SpeakButton text={word.kana} />
                <Meaning word={word} />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="prompt-meaning">{word.coreMeaning}</p>
            {word.pos && <p className="meaning__pos">{shortPos(word.pos)}</p>}
            {typed && (
              <div className="flash__answer">
                <p className={typed.correct ? 'result result--right' : 'result result--wrong'} data-testid="typed-result">
                  {typed.correct ? 'Correct' : gaveUp ? 'Here it is: it comes back after a few cards' : `Not quite: you typed “${typed.value || '—'}”`}
                </p>
                <JapaneseWord word={word} showReading size="small" />
                <SpeakButton text={word.kana} />
              </div>
            )}
          </>
        )}
      </article>

      {jpPrompt && !revealed && (
        <div className="grade-row grade-row--two">
          <button className="button button--again" onClick={dontKnow} title="Shortcut: 1">
            Don’t know yet
          </button>
          <button className="button button--primary" onClick={() => reveal()} title="Shortcut: Space">
            Show answer
          </button>
        </div>
      )}
      {jpPrompt && revealed && gaveUp && !encoding && (
        <button className="button button--primary button--wide" autoFocus onClick={miss}>
          Continue
        </button>
      )}
      {jpPrompt && revealed && !gaveUp && !encoding && (
        <div className="grade-row grade-row--two">
          <button className="button button--again" onClick={miss}>
            Missed
          </button>
          <button className="button button--good" onClick={() => answer(true)}>
            Got it
          </button>
        </div>
      )}
      {!jpPrompt && !typed && (
        <div className="stack stack--tight">
          <KanaInput
            key={`${step.wordId}-${state.completed}-${state.queue.length}`}
            onSubmit={(value) => {
              const r = checkReading(value, word);
              setTyped({ value, correct: r.correct });
              if (settings.autoPlay) speak(word.kana);
            }}
          />
          <button className="button button--again button--wide" onClick={dontKnow}>
            Don’t know yet
          </button>
        </div>
      )}
      {!jpPrompt && typed && !encoding && (
        <div className="stack stack--tight">
          <button className="button button--primary button--wide" autoFocus onClick={() => (typed.correct ? answer(true) : miss())}>
            Continue
          </button>
          {!typed.correct && !gaveUp && (
            <button className="link-button" onClick={() => answer(true)}>
              It was a typo — count it as correct
            </button>
          )}
        </div>
      )}
      {copying && (
        <section className="stack stack--tight" aria-label="Type it once">
          <p className="small" data-testid="encode-prompt">
            Type <span lang="ja">{word.kana}</span> once while you look at it in its spot.{' '}
            {copying.back > 0 ? `It comes back after ${plural(copying.back, 'other card')}.` : 'Then it comes back.'}
          </p>
          <KanaInput
            key={`copy-${step.wordId}-${step.direction}`}
            label="Type the word"
            placeholder="type it while you look (romaji works)"
            onSubmit={(value) => (checkReading(value, word).correct ? setCopying(null) : update({ copied: value }))}
          />
          {copied !== null && (
            <p className="result result--wrong" data-testid="copy-result">
              Not quite: you typed “{copied || '—'}”. Type <span lang="ja">{word.kana}</span>.
            </p>
          )}
        </section>
      )}
      {!encoding && (
        <button className="link-button" onClick={studyAgain}>
          Study the page again
        </button>
      )}
    </div>
  );
}

/** On a learned page: the cards missed in step 2, which start review at a lower grade. */
function StepTwoMisses({ page }: { page: PageDetail }) {
  const missed = page.words.flatMap((w) =>
    (['jp_en', 'en_jp'] as const).filter((d) => w.misses.step2[d] > 0).map((d) => ({ word: w, direction: d, misses: w.misses.step2[d] })),
  );
  if (missed.length === 0) return null;
  return (
    <section className="stack stack--tight" aria-label="Missed in step 2" data-testid="step2-misses">
      <h2>Missed in step 2</h2>
      <p className="muted small">These start review with a lower grade: one miss counts as Hard, more as Again, so they come back sooner after the first review.</p>
      <ul className="plain-list">
        {missed.map(({ word, direction, misses }) => (
          <li key={`${word.id}-${direction}`}>
            <span lang="ja">{writtenForm(word)}</span> · {direction === 'jp_en' ? 'word → meaning' : 'meaning → word'} · {plural(misses, 'miss', 'misses')}
          </li>
        ))}
      </ul>
    </section>
  );
}
