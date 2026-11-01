import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, shortPos, type PageDetail, type QueueItem } from '../api';
import { PageGrid } from '../components/PageGrid';
import { HookEditor } from '../components/HookEditor';
import { Hook, JapaneseWord, KanaInput, Meaning, Notice, Progress, SaveStatus, SpeakButton, TypeItOnce, useKeys } from '../components/ui';
import { checkReading } from '../../shared/kana';
import { MISS_GAP } from '../../shared/pageSession';
import { formatInterval } from '../../shared/study';
import { useSettings } from '../settings';
import { speak } from '../speech';

// FSRS grades (Rating in ts-fsrs). Spelled out so the client bundle needn't load the scheduler.
const AGAIN = 1;
const HARD = 2;
const GOOD = 3;
const EASY = 4;

/**
 * A card in this session. `retry`: a card graded Again earlier today, asked
 * again until it's right once. Retries are practice: nothing is sent.
 */
type SessionItem = QueueItem & { retry?: number };

/**
 * Where a card missed at `index` comes back: after MISS_GAP other cards, or
 * at the end if fewer are left. Unlike the page drill (at least MISS_GAP away,
 * among a fixed set), review keeps it soon: the session may end any time.
 */
const retryAt = (index: number, length: number) => Math.min(index + 1 + MISS_GAP, length);

export function Review() {
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(0);
  /** Cards graded this session (retries are practice, not grades). */
  const [graded, setGraded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Shown until you turn it off in Settings; a failed load keeps it shown.
  const [showIntervals, setShowIntervals] = useState(true);
  useEffect(() => {
    api.study().then(
      (p) => setShowIntervals(p.showIntervals),
      () => undefined,
    );
  }, []);
  /** Words that became leeches this session: they've left review. */
  const [leeches, setLeeches] = useState<QueueItem['word'][]>([]);

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
  const leechNotice = leeches.length > 0 && (
    <Notice>
      <p data-testid="leech-notice">
        {leeches.map((w, i) => (
          <span key={w.id}>
            {i > 0 && '、'}
            <a href={`#/lists/${w.listId}/leeches`} lang="ja">
              {w.kanji ?? w.kana}
            </a>
          </span>
        ))}{' '}
        {leeches.length === 1 ? 'keeps slipping, so it leaves' : 'keep slipping, so they leave'} review for now. Tap to give{' '}
        {leeches.length === 1 ? 'it' : 'them'} a new approach: a fresh page, a memory hook or a clearer meaning.
      </p>
    </Notice>
  );
  if (!item) {
    // Retries are extra copies of cards already in the session, not more of the queue.
    const left = total - items.filter((i) => !i.retry).length;
    const more = left > 0;
    return (
      <div className="stack">
        <h1>Review</h1>
        {leechNotice}
        <Notice kind="success">
          <p data-testid="review-done">{graded > 0 ? `Done: ${graded} reviewed.` : 'Nothing to review right now.'}</p>
        </Notice>
        {more ? (
          <button className="button button--primary" onClick={load}>
            Continue with the next {Math.min(50, left)}
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
    <div className="stack">
      {leechNotice}
      <ReviewCard
        key={`${item.cardId}:${item.retry ?? 0}`}
        item={item}
        position={done}
        total={done + (items.length - index)}
        comesBackAfter={retryAt(index, items.length) - index - 1}
        showIntervals={showIntervals}
        onError={setError}
        onGraded={(leech, again, word) => {
          if (leech) setLeeches((all) => [...all, item.word]);
          // Missed: back in this session after a few other cards (Mikita, 30 Oct:
          // a word missed today and only seen again tomorrow is missed again).
          if (again) {
            const at = retryAt(index, items.length);
            // With the word as it is now: a meaning edited on the card stays edited.
            setItems([...items.slice(0, at), { ...item, word, retry: (item.retry ?? 0) + 1 }, ...items.slice(at)]);
          }
          if (!item.retry) setGraded((g) => g + 1);
          setDone((d) => d + 1);
          setIndex((i) => i + 1);
        }}
      />
    </div>
  );
}

function ReviewCard({
  item,
  position,
  total,
  comesBackAfter,
  showIntervals,
  onGraded,
  onError,
}: {
  item: SessionItem;
  position: number;
  total: number;
  /** Other cards before a missed card comes back. */
  comesBackAfter: number;
  /** A line under the grade buttons with when each grade brings the word back. */
  showIntervals: boolean;
  /** leech: this answer made the word a leech, so it leaves review. again: missed, so it comes back today. */
  onGraded: (leech: boolean, again: boolean, word: QueueItem['word']) => void;
  onError: (message: string) => void;
}) {
  const retry = Boolean(item.retry);
  // After a miss: type the word once while looking at it, then it comes back.
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [writingHook, setWritingHook] = useState(false);
  // A hook written but not saved yet is saved when the typing is done, so it isn't lost.
  const hookDraft = useRef<string | null>(null);
  const finishCopying = async () => {
    const draft = hookDraft.current?.trim();
    if (draft === undefined || draft === (word.hook ?? '')) return onGraded(false, true, word);
    try {
      const saved = await api.updateWord(word.id, { hook: draft || null });
      onGraded(false, true, { ...word, hook: saved.hook });
    } catch (e) {
      setSaveError(`the memory hook wasn't saved (${(e as Error).message})`);
    }
  };
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
    if (sending || copying) return;
    // A retry is practice: only whether it's right now matters.
    if (retry) return rating === AGAIN ? setCopying(true) : onGraded(false, false, word);
    if (hintUsed && rating > HARD) return;
    setSending(true);
    setSaveError(null);
    try {
      const result = await api.submitReview(item.cardId, {
        rating,
        hintUsed,
        // A give-up on a typing card is logged with no answer, unlike an empty one.
        answer: gaveUp ? undefined : typed?.value,
        correct: typed ? typed.correct || typed.typo : undefined,
        durationMs: Date.now() - started.current,
        due: item.due,
      });
      // A leech leaves review: another look the same way isn't what it needs.
      if (rating === AGAIN && !result.leech) setCopying(true);
      else onGraded(result.leech, false, word);
    } catch (e) {
      // Turned down (the card is gone, say): sending it again won't help.
      if (e instanceof ApiError && e.refused) return onError(e.message);
      // Lost on the way: the answer stays on screen, and tapping the grade sends it again.
      setSaveError((e as Error).message);
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
      // A right typed retry offers only Got it, so 1 does nothing there.
      '1': () => (answered ? (retry && passed && !reading ? undefined : grade(AGAIN)) : reading ? dontKnow() : undefined),
      '2': () => (answered && passed ? grade(retry ? GOOD : HARD) : undefined),
      '3': () => (answered && passed && !retry ? grade(GOOD) : undefined),
      '4': () => (answered && passed && !retry ? grade(EASY) : undefined),
    },
    !copying,
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
        {retry && (
          <span className="flash__retry" data-testid="retry-badge">
            Again today: practice, not graded
          </span>
        )}
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
                <Hook word={word} />
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
      {reading && !revealed && !retry && (
        <p className="muted small grade-hint" data-testid="dont-know-hint">
          Don’t know counts as Again. Show answer lets you grade yourself.
        </p>
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

      {answered && !copying && retry && (
        <div className="stack stack--tight">
          {passed && reading ? (
            <div className="grade-row grade-row--two" data-testid="retry-row">
              <button className="button button--again" onClick={() => grade(AGAIN)}>
                Missed
              </button>
              <button className="button button--good" onClick={() => grade(GOOD)}>
                Got it
              </button>
            </div>
          ) : (
            <button className={`button button--wide ${passed ? 'button--good' : 'button--again'}`} onClick={() => grade(passed ? GOOD : AGAIN)}>
              {passed ? 'Got it' : 'Continue'}
            </button>
          )}
          {!passed && !reading && !gaveUp && (
            <button className="link-button" onClick={() => setTyped({ ...typed!, typo: true })}>
              It was a typo — count it as correct
            </button>
          )}
        </div>
      )}
      {answered && !copying && !retry && (
        <div className="stack stack--tight">
          {passed ? (
            <>
              <div className="grade-row" data-testid="grade-row">
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
              {showIntervals && (
                <>
                  <div className="grade-row grade-intervals" data-testid="grade-intervals" aria-label="When the word comes back">
                    {(['again', 'hard', 'good', 'easy'] as const).map((g) => (
                      <span key={g}>
                        <span className="approx">~</span>
                        {formatInterval(item.intervals[g])}
                      </span>
                    ))}
                  </div>
                  <p className="muted small grade-hint">
                    When the word comes back after each grade. <a href="#/settings/grading">How grading works</a>
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <button className="button button--again button--wide" onClick={() => grade(AGAIN)} disabled={sending}>
                Continue
              </button>
              <p className="muted small grade-hint" data-testid="again-note">
                Counted as Again{showIntervals && <span data-testid="grade-intervals">: back in ~{formatInterval(item.intervals.again)}</span>}
              </p>
              {!reading && !gaveUp && (
                <button className="link-button" onClick={() => setTyped({ ...typed!, typo: true })}>
                  It was a typo — count it as correct
                </button>
              )}
            </>
          )}
          <SaveStatus sending={sending} error={saveError} />
        </div>
      )}

      {copying && (
        <>
          <TypeItOnce
            word={word}
            back={comesBackAfter}
            inputKey="copy"
            copied={copied}
            onMiss={setCopied}
            onDone={finishCopying}
          />
          {saveError && <Notice kind="error">{saveError}</Notice>}
          {/* A missed word may need a new way in: a story it sounds like, or its parts. */}
          {writingHook ? (
            <section className="card stack stack--tight" aria-label="Memory hook">
              <HookEditor
                word={word}
                onDraft={(text) => (hookDraft.current = text)}
                onSaved={(saved) => {
                  hookDraft.current = null;
                  setWord({ ...word, hook: saved.hook });
                }}
              />
            </section>
          ) : (
            <button className="link-button" onClick={() => setWritingHook(true)}>
              {word.hook ? 'Change its memory hook' : 'Write a memory hook'}
            </button>
          )}
        </>
      )}

      {item.page && !hintPage && !answered && !retry && (
        <button className="link-button" onClick={showHint}>
          Where did I learn this? (caps the grade at Hard)
        </button>
      )}
    </div>
  );
}
