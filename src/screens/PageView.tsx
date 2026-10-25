import { useEffect, useMemo, useState } from 'react';
import { api, shortPos, type PageDetail } from '../api';
import { PageGrid } from '../components/PageGrid';
import { JapaneseWord, KanaInput, Meaning, Notice, Progress, SpeakButton, useKeys } from '../components/ui';
import { answerStep, currentStep, isDrillDone, startDrill, type DrillState } from '../../shared/pageSession';
import { checkReading } from '../../shared/kana';
import { useSettings } from '../settings';
import { speak } from '../speech';

const STEP_TEXT = {
  ordered: {
    title: 'Step 1 · In order',
    intro: 'Study the page, then go through it in order: first each word → meaning, then each meaning → word.',
    start: 'Start step 1',
  },
  shuffled: {
    title: 'Step 2 · Shuffled',
    intro: 'The same words in random order, both directions mixed. Only the position on the page is shown.',
    start: 'Start step 2',
  },
} as const;

export function PageView({ id }: { id: number }) {
  const [page, setPage] = useState<PageDetail | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            const next = await api.completeStage(page.id, stage);
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

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Page {page.number}</h1>
        <a href="#/pages" className="link-button">
          All pages
        </a>
      </div>

      {page.stage === 'graduated' ? (
        <Notice kind="success">
          <p data-testid="page-learned">Learned. These words are now in spaced review; the first check comes tomorrow.</p>
        </Notice>
      ) : (
        <section className="stack stack--tight">
          <h2>{STEP_TEXT[page.stage].title}</h2>
          <p className="muted">{STEP_TEXT[page.stage].intro}</p>
        </section>
      )}

      <PageGrid page={page} mode="full" />

      {page.stage !== 'graduated' && (
        <button className="button button--primary button--wide" onClick={() => page.stage !== 'graduated' && setDrill(startDrill(ids, page.stage))}>
          {STEP_TEXT[page.stage].start}
        </button>
      )}
    </div>
  );
}

interface StepView {
  of: DrillState;
  revealed: boolean;
  typed: { value: string; correct: boolean } | null;
  moved: string;
}

const freshView = (of: DrillState): StepView => ({ of, revealed: false, typed: null, moved: '' });

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
  const step = currentStep(state);
  const word = useMemo(() => page.words.find((w) => w.id === step?.wordId), [page, step]);
  const [settings] = useSettings();
  // What happened on this step. Tagged with the step's state, so the next
  // step starts fresh on its very first render: no flash of the old answer,
  // and no key press can grade it unseen.
  const [stepView, setStepView] = useState<StepView>(() => freshView(state));
  const view = stepView.of === state ? stepView : freshView(state);
  const { revealed, typed, moved } = view;
  const update = (patch: Partial<Omit<StepView, 'of'>>) => setStepView({ ...view, ...patch });
  const setRevealed = (value: boolean) => update({ revealed: value });
  const setTyped = (value: StepView['typed']) => update({ typed: value });
  const setMoved = (value: string) => update({ moved: value });

  useEffect(() => {
    if (isDrillDone(state)) onDone();
  }, [state]);

  const reveal = () => {
    if (!word || revealed) return;
    setRevealed(true);
    if (settings.autoPlay) speak(word.kana);
  };
  const answer = (correct: boolean) => onChange(answerStep(state, correct));

  const jpPrompt = step?.direction === 'jp_en';
  useKeys(
    {
      Space: () => (jpPrompt && !revealed ? reveal() : undefined),
      '1': () => (revealed ? answer(false) : undefined),
      '2': () => (revealed ? answer(true) : undefined),
    },
    Boolean(step) && jpPrompt,
  );

  if (!step || !word) return <p className="muted">Saving…</p>;

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

      <PageGrid page={page} mode={stage === 'ordered' ? 'written' : 'blank'} highlight={word.position} hideHighlighted={!jpPrompt} />

      <article className="card flash" data-testid="drill-card" data-direction={step.direction}>
        {jpPrompt ? (
          <>
            <JapaneseWord word={word} showReading={revealed} onHint={setMoved} />
            {moved && (
              <p className="muted small" data-testid="moved-to-learning">
                <span lang="ja">{moved}</span> moved to Still learning: furigana will show over it until you take it off that list on Home.
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
                  {typed.correct ? 'Correct' : `Not quite: you typed “${typed.value || '—'}”`}
                </p>
                <JapaneseWord word={word} showReading size="small" />
                <SpeakButton text={word.kana} />
              </div>
            )}
          </>
        )}
      </article>

      {jpPrompt && !revealed && (
        <button className="button button--primary button--wide" onClick={reveal}>
          Show answer
        </button>
      )}
      {jpPrompt && revealed && (
        <div className="grade-row grade-row--two">
          <button className="button button--again" onClick={() => answer(false)}>
            Missed
          </button>
          <button className="button button--good" onClick={() => answer(true)}>
            Got it
          </button>
        </div>
      )}
      {!jpPrompt && !typed && (
        <KanaInput
          key={`${step.wordId}-${state.completed}-${state.queue.length}`}
          onSubmit={(value) => {
            const r = checkReading(value, word);
            setTyped({ value, correct: r.correct });
            if (settings.autoPlay) speak(word.kana);
          }}
        />
      )}
      {!jpPrompt && typed && (
        <div className="stack stack--tight">
          <button className="button button--primary button--wide" autoFocus onClick={() => answer(typed.correct)}>
            Continue
          </button>
          {!typed.correct && (
            <button className="link-button" onClick={() => answer(true)}>
              It was a typo — count it as correct
            </button>
          )}
        </div>
      )}
    </div>
  );
}
