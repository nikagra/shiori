import { useEffect, useState } from 'react';
import { api, writtenForm, type ListWord, type Word, type WordPart } from '../api';
import { MAX_HOOK } from '../../shared/study';
import { Notice } from './ui';

// A memory hook and the word's parts, where a word is hard: on a page you're
// about to learn, and after a miss in review. Mikita's words that stick all
// had a sound-alike story (ほる and a HOLE); the ones that faded had none,
// or were long compounds not seen as parts (30 Oct).

type HookWord = Pick<Word, 'id' | 'kanji' | 'kana' | 'hook'>;

/** The dictionary words a compound is made of: nothing for a short or plain word. */
export function WordParts({ word }: { word: Pick<Word, 'kanji'> }) {
  const [parts, setParts] = useState<WordPart[]>([]);
  useEffect(() => {
    setParts([]);
    if (!word.kanji || [...word.kanji].length < 2) return;
    let live = true;
    // Only a help: when the lookup fails, there are just no parts.
    api.wordParts(word.kanji).then(
      (p) => live && setParts(p),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [word.kanji]);
  if (parts.length === 0) return null;
  return (
    <p className="word-parts small" data-testid="word-parts">
      <span className="muted">Parts: </span>
      {parts.map((p, i) => (
        <span key={i} className="word-parts__part">
          {i > 0 && <span className="muted"> + </span>}
          <span lang="ja">{p.text}</span>
          {p.gloss && (
            <>
              {' '}
              <span className="muted" lang="ja">
                {p.base ? `${p.base}, ` : ''}
                {p.reading}
              </span>{' '}
              “{p.gloss}”
            </>
          )}
        </span>
      ))}
    </p>
  );
}

export function HookEditor({ word, onSaved }: { word: HookWord; onSaved: (word: ListWord) => void }) {
  const [text, setText] = useState(word.hook ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = text.trim() !== (word.hook ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.updateWord(word.id, { hook: text.trim() || null }));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="stack stack--tight" data-testid="hook-editor">
      <WordParts word={word} />
      <label className="field">
        <span>
          Memory hook for <span lang="ja">{writtenForm(word)}</span>
        </span>
        <textarea
          rows={2}
          maxLength={MAX_HOOK}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          placeholder={`A story with a word it sounds like: ほる, dig a HOLE`}
        />
      </label>
      <div className="row">
        <button type="button" className="button button--small" disabled={busy || !changed} onClick={save}>
          {busy ? 'Saving…' : 'Save hook'}
        </button>
        {saved && !changed && (
          <span className="muted small" role="status">
            Saved: it shows with the answer.
          </span>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
