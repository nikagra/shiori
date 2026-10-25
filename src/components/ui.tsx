import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bind, unbind } from 'wanakana';
import { shortPos, writtenForm, type Word } from '../api';
import { furigana, knownKanjiSet } from '../../shared/furigana';
import { useSettings } from '../settings';
import { speak } from '../speech';

export function SpeakButton({ text, label = 'Play audio' }: { text: string; label?: string }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={() => speak(text)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** The word as it is written, with its reading above when shown. */
export function JapaneseWord({ word, showReading, size = 'large' }: { word: Pick<Word, 'kanji' | 'kana'>; showReading: boolean; size?: 'large' | 'small' }) {
  const written = writtenForm(word);
  const hasReading = word.kanji !== null;
  return (
    <div className={`jp-word jp-word--${size}`} lang="ja">
      <div className="jp-word__reading" aria-hidden={!showReading || !hasReading}>
        {showReading && hasReading ? word.kana : ' '}
      </div>
      <div className="jp-word__written" data-written={written}>
        {showReading ? written : <Written word={word} />}
      </div>
    </div>
  );
}

/** The written form, with furigana over kanji you don't know yet. */
export function Written({ word }: { word: Pick<Word, 'kanji' | 'kana'> }) {
  const [settings] = useSettings();
  const known = useMemo(() => knownKanjiSet(settings), [settings]);
  if (word.kanji === null) return <>{word.kana}</>;
  return (
    <>
      {furigana(word.kanji, word.kana, known).map((s, i) =>
        s.ruby ? (
          <ruby key={i}>
            {s.text}
            <rt>{s.ruby}</rt>
          </ruby>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

export function Meaning({ word, onEdit }: { word: Word; onEdit?: (meaning: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(word.coreMeaning);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(word.coreMeaning), [word.coreMeaning]);

  return (
    <div className="meaning">
      {editing ? (
        <form
          className="meaning__edit"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onEdit?.(draft);
              setEditing(false);
              setError(null);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <input aria-label="Core meaning" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button type="submit" className="button button--small">
            Save
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <p className="meaning__core">
          {word.coreMeaning}
          {onEdit && (
            <button type="button" className="link-button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </p>
      )}
      {word.pos && <p className="meaning__pos">{shortPos(word.pos)}</p>}
      {word.senses.length > 1 && (
        <details className="meaning__all">
          <summary>All meanings ({word.senses.length})</summary>
          <ol>
            {word.senses.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/**
 * Kana answer box. Romaji typed on a laptop turns into hiragana as you type;
 * on the iPhone the Japanese keyboard works as is.
 */
export function KanaInput({ onSubmit, disabled }: { onSubmit: (value: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    bind(el, { IMEMode: true });
    el.focus();
    return () => unbind(el);
  }, []);
  return (
    <form
      className="kana-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(ref.current?.value ?? '');
      }}
    >
      <input
        ref={ref}
        lang="ja"
        aria-label="Answer in kana"
        placeholder="type the reading (romaji works)"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
      />
      <button type="submit" className="button" disabled={disabled}>
        Check
      </button>
    </form>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Progress">
      <div className="progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`notice notice--${kind}`}>{children}</div>;
}

/** Keyboard shortcuts for desktop: active only while mounted. */
export function useKeys(handlers: Record<string, () => void>, active = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const h = ref.current[e.key === ' ' ? 'Space' : e.key];
      if (h) {
        e.preventDefault();
        h();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
