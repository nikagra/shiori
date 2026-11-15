import { useState } from 'react';
import type { PageDetail } from '../api';
import { PageGrid, type Cover } from './PageGrid';

// The full page to study, with "Test yourself": cover the meanings or the
// Japanese and turn cards over one by one, as often as you like (Mikita,
// 28 Oct and 3 Nov). Nothing here is counted or saved. Used on a page before
// its steps and whenever a drill or practice goes back to study the page.

export function StudyPage({
  page,
  onTesting,
  picked = null,
  onPick,
}: {
  page: PageDetail;
  /** Told when testing yourself starts or stops: what's outside the cards may give answers away. */
  onTesting?: (testing: boolean) => void;
  /** The word picked by a tap (when nothing is covered), outlined on the page. */
  picked?: number | null;
  /** Tapping a word when nothing is covered picks it (tap again to unpick); without this, it does nothing. */
  onPick?: (wordId: number | null) => void;
}) {
  const [cover, setCover] = useState<Cover | null>(null);
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  const chooseCover = (next: Cover | null) => {
    setCover(next);
    setFlipped(new Set());
    onTesting?.(next !== null);
  };
  const turnOver = (wordId: number) => {
    const next = new Set(flipped);
    if (!next.delete(wordId)) next.add(wordId);
    setFlipped(next);
  };

  return (
    <>
      <SelfTest
        cover={cover}
        onCover={chooseCover}
        allFlipped={page.words.every((w) => flipped.has(w.id))}
        onCoverAll={() => setFlipped(new Set())}
        idleHint={onPick ? 'Tap a word to write a memory hook and see its parts.' : null}
      />
      <PageGrid
        page={page}
        mode="full"
        cover={cover ?? undefined}
        flipped={flipped}
        selected={cover ? undefined : (picked ?? undefined)}
        onTap={cover ? turnOver : onPick && ((wordId) => onPick(picked === wordId ? null : wordId))}
      />
    </>
  );
}

function SelfTest({
  cover,
  onCover,
  allFlipped,
  onCoverAll,
  idleHint,
}: {
  cover: Cover | null;
  onCover: (cover: Cover | null) => void;
  allFlipped: boolean;
  onCoverAll: () => void;
  /** What a tap does while nothing is covered, if anything. */
  idleHint: string | null;
}) {
  const options: [Cover | null, string][] = [
    [null, 'Show all'],
    ['meaning', 'Hide meanings'],
    ['japanese', 'Hide Japanese'],
  ];
  return (
    <section className="stack stack--tight" aria-label="Test yourself">
      <div className="segmented segmented--wide" role="group" aria-label="Test yourself">
        {options.map(([value, label]) => (
          <button key={label} type="button" className={cover === value ? 'is-active' : ''} aria-pressed={cover === value} onClick={() => onCover(value)}>
            {label}
          </button>
        ))}
      </div>
      {(cover || idleHint) && (
        <p className="muted small" data-testid="self-test-hint">
          {cover ? (
            <>
              Tap a card to turn it over. Not counted: go round as often as you like.{' '}
              {allFlipped && (
                <button type="button" className="link-button" onClick={onCoverAll}>
                  Cover them all again
                </button>
              )}
            </>
          ) : (
            idleHint
          )}
        </p>
      )}
    </section>
  );
}
