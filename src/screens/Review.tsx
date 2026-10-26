import { useCallback, useEffect, useRef, useState } from 'react';
import { api, shortPos, type PageDetail, type QueueItem } from '../api';
import { PageGrid } from '../components/PageGrid';
import { JapaneseWord, KanaInput, Meaning, Notice, Progress, SpeakButton, useKeys } from '../components/ui';
import { checkReading } from '../../shared/kana';
import { useSettings } from '../settings';
import { speak } from '../speech';

// FSRS grades (Rating in ts-fsrs). Spelled out so the client bundle needn't load the scheduler.
const AGAIN = 1;
const HARD = 2;
const GOOD = 3;
const EASY = 4;

export function Review() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    api.reviewQueue().then(
      (q) => {
        setItems(q.items);
        setTotal(q.total);
        setIndex(0);
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(load, [load]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!items) return <p className="muted">Loading…</p>;

  const item = items[index];
  if (!item) {
    const more = total - items.length > 0;
    return (
      <div className="stack">
        <h1>Review</h1>
        <Notice kind="success">
          <p data-testid="review-done">{done > 0 ? `Done: ${done} reviewed.` : 'Nothing to review right now.'}</p>
        </Notice>
        {more ? (
          <button className="button button--primary" onClick={load}>
            Continue with the next {Math.min(50, total - items.length)}
          </button>
        ) : (
          <a className="button" href="#/pages">
            Go to pages
          </a>
        )}
      </div>
    );
  }

  return (
    <ReviewCard
      key={item.cardId}
      item={item}
      position={done}
      total={done + (items.length - index)}
      onError={setError}
      onGraded={() => {
        setDone((d) => d + 1);
        setIndex((i) => i + 1);
      }}
    />
  );
}

function ReviewCard({
  item,
  position,
  total,
  onGraded,
  onError,
}: {
  item: QueueItem;
  position: number;
  total: number;
  onGraded: () => void;
  onError: (message: string) => void;
}) {
  const [settings] = useSettings();
  const [word, setWord] = useState(item.word);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState<{ value: string; correct: boolean; typo: boolean } | null>(null);
  // "Don't know": straight to the answer; the only grade left is Again.
  const [gaveUp, setGaveUp] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  // Kanji a furigana peek moved to "still learning". The peek doesn't cap the
  // grade: this card tests meaning, the peek counts against the kanji instead.
  const [moved, setMoved] = useState('');
  const [hintPage, setHintPage] = useState<PageDetail | null>(null);
  const [sending, setSending] = useState(false);
  const started = useRef(Date.now());
  const reading = item.direction === 'jp_en';
  const listening = reading && settings.listenFirst;

  useEffect(() => {
    if (listening) speak(word.kana);
    // Only when the card first appears.
  }, []);

  const reveal = () => {
    if (revealed) return;
    setRevealed(true);
    if (settings.autoPlay) speak(word.kana);
  };

  const showHint = async () => {
    if (!item.page) return;
    setHintUsed(true);
    try {
      setHintPage(await api.page(item.page.id));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const grade = async (rating: number) => {
    if (sending) return;
    if (hintUsed && rating > HARD) return;
    setSending(true);
    try {
      await api.submitReview(item.cardId, {
        rating,
        hintUsed,
        // A give-up on a typing card is logged with no answer, unlike an empty one.
        answer: gaveUp ? undefined : typed?.value,
        correct: typed ? typed.correct || typed.typo : undefined,
        durationMs: Date.now() - started.current,
      });
      onGraded();
    } catch (e) {
      onError((e as Error).message);
      setSending(false);
    }
  };

  const dontKnow = () => {
    if (reading) {
      if (revealed) return;
      setGaveUp(true);
      reveal();
    } else if (!typed) {
      setGaveUp(true);
      setTyped({ value: '', correct: false, typo: false });
      if (settings.autoPlay) speak(word.kana);
    }
  };

  const answered = reading ? revealed : typed !== null;
  const passed = !gaveUp && (reading || (typed !== null && (typed.correct || typed.typo)));

  useKeys(
    {
      Space: () => (reading && !revealed ? reveal() : undefined),
      Enter: () => (reading && !revealed ? reveal() : undefined),
      '1': () => (answered ? grade(AGAIN) : reading ? dontKnow() : undefined),
      '2': () => (answered && passed ? grade(HARD) : undefined),
      '3': () => (answered && passed ? grade(GOOD) : undefined),
      '4': () => (answered && passed ? grade(EASY) : undefined),
    },
    true,
  );

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Review</h1>
        <span className="muted">
          {position + 1} / {total}
        </span>
      </div>
      <Progress done={position} total={total} />

      <article className="card flash" data-testid="review-card" data-direction={item.direction}>
        <span className="flash__kind">{reading ? 'What does it mean?' : 'How do you say it?'}</span>
        {reading ? (
          <>
            {listening && !revealed ? (
              <div className="listen">
                <SpeakButton text={word.kana} label="Play again" />
                <span className="muted">Listen, then recall the meaning</span>
              </div>
            ) : (
              <JapaneseWord word={word} showReading={revealed} onHint={setMoved} />
            )}
            {moved && (
              <p className="muted small" data-testid="moved-to-learning">
                <span lang="ja">{moved}</span> moved to Still learning: furigana will show over it until you take it off that list in Settings.
              </p>
            )}
            {revealed && (
              <div className="flash__answer">
                <SpeakButton text={word.kana} />
                <Meaning
                  word={word}
                  onEdit={async (m) => {
                    setWord(await api.updateWord(word.id, { coreMeaning: m }));
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="prompt-meaning">{word.coreMeaning}</p>
            {word.pos && <p className="meaning__pos">{shortPos(word.pos)}</p>}
            {typed && (
              <div className="flash__answer">
                <p className={typed.correct || typed.typo ? 'result result--right' : 'result result--wrong'} data-testid="typed-result">
                  {typed.correct ? 'Correct' : typed.typo ? 'Counted as correct' : gaveUp ? 'Here it is' : `Not quite: you typed “${typed.value || '—'}”`}
                </p>
                <JapaneseWord word={word} showReading size="small" />
                <SpeakButton text={word.kana} />
              </div>
            )}
          </>
        )}
      </article>

      {hintPage && item.page && (
        <section className="stack stack--tight" aria-label="Page hint">
          <p className="muted small">
            From page {item.page.number}, position {item.page.position + 1}. Using the hint caps this review at Hard.
          </p>
          <PageGrid page={hintPage} mode="written" highlight={item.page.position} hideHighlighted />
        </section>
      )}

      {reading && !revealed && (
        <div className="grade-row grade-row--two">
          <button className="button button--again" onClick={dontKnow} title="Shortcut: 1">
            Don’t know
          </button>
          <button className="button button--primary" onClick={reveal} title="Shortcut: Space">
            Show answer
          </button>
        </div>
      )}
      {!reading && !typed && (
        <div className="stack stack--tight">
          <KanaInput
            onSubmit={(value) => {
              const r = checkReading(value, word);
              setTyped({ value, correct: r.correct, typo: false });
              if (settings.autoPlay) speak(word.kana);
            }}
          />
          <button className="button button--again button--wide" onClick={dontKnow}>
            Don’t know
          </button>
        </div>
      )}

      {answered && (
        <div className="stack stack--tight">
          {passed ? (
            <div className="grade-row">
              <button className="button button--again" onClick={() => grade(AGAIN)} disabled={sending}>
                Again
              </button>
              <button className="button button--hard" onClick={() => grade(HARD)} disabled={sending}>
                Hard
              </button>
              <button className="button button--good" onClick={() => grade(GOOD)} disabled={sending || hintUsed}>
                Good
              </button>
              <button className="button button--easy" onClick={() => grade(EASY)} disabled={sending || hintUsed}>
                Easy
              </button>
            </div>
          ) : (
            <>
              <button className="button button--again button--wide" onClick={() => grade(AGAIN)} disabled={sending}>
                Again
              </button>
              {!reading && !gaveUp && (
                <button className="link-button" onClick={() => setTyped({ ...typed!, typo: true })}>
                  It was a typo — count it as correct
                </button>
              )}
            </>
          )}
        </div>
      )}

      {item.page && !hintPage && !answered && (
        <button className="link-button" onClick={showHint}>
          Where did I learn this? (caps the grade at Hard)
        </button>
      )}
    </div>
  );
}
