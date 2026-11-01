import { writtenForm, type PageDetail } from '../api';
import { SpeakButton, Written } from './ui';

// The page: a fixed 3-column grid that looks the same on phone and laptop,
// so a word keeps its place in your memory.

export type CellMode = 'full' | 'written' | 'blank';

/** Test yourself on the full page: one side of every card is covered until you tap it. */
export type Cover = 'meaning' | 'japanese';

export function PageGrid({
  page,
  mode,
  highlight,
  hideHighlighted = false,
  hiddenIds,
  revealHighlighted = false,
  cover,
  flipped,
  selected,
  onTap,
}: {
  page: PageDetail;
  /** full: word, reading, meaning · written: the word only · blank: positions only */
  mode: CellMode;
  highlight?: number;
  hideHighlighted?: boolean;
  /** Words not to show yet: their cells keep only the position. */
  hiddenIds?: Set<number>;
  /** After a miss: the highlighted word shows in its spot whatever the mode (the card shows its reading). */
  revealHighlighted?: boolean;
  /** Full mode: the side covered on each card, until flipped. */
  cover?: Cover;
  /** Words whose cards are turned over. */
  flipped?: Set<number>;
  /** Full mode: the word picked, outlined. */
  selected?: number;
  /** Full mode: tapping a card (to flip it, or to pick the word). */
  onTap?: (wordId: number) => void;
}) {
  return (
    <ol className={`page-grid page-grid--${mode}`} aria-label={`Page ${page.number}`}>
      {page.words.map((w) => {
        const current = w.position === highlight;
        const revealed = current && revealHighlighted;
        const hidden = current && hideHighlighted && !revealed;
        const notYet = !current && hiddenIds?.has(w.id);
        const covered = mode === 'full' && cover !== undefined && !flipped?.has(w.id);
        const japanese =
          mode === 'full' ? (
            covered && cover === 'japanese' ? (
              <span className="page-cell__word page-cell__word--hidden">?</span>
            ) : (
              <>
                <span className={`page-cell__word${lengthClass(writtenForm(w))}`} lang="ja" data-written={writtenForm(w)}>
                  {writtenForm(w)}
                </span>
                {w.kanji && (
                  <span className={`page-cell__reading${[...w.kana].length >= 7 ? ' page-cell__reading--long' : ''}`} lang="ja">
                    {w.kana}
                  </span>
                )}
              </>
            )
          ) : null;
        const meaning =
          mode === 'full' &&
          (covered && cover === 'meaning' ? (
            <span className="page-cell__meaning page-cell__word--hidden">?</span>
          ) : (
            <span className="page-cell__meaning">{w.coreMeaning}</span>
          ));
        const tappable = mode === 'full' && onTap;
        return (
          <li
            key={w.id}
            className={`page-cell${current ? ' page-cell--current' : ''}${revealed ? ' page-cell--revealed' : ''}${selected === w.id ? ' page-cell--selected' : ''}${tappable ? ' page-cell--tappable' : ''}`}
            data-position={w.position}
            data-covered={covered || undefined}
          >
            <span className="page-cell__number">{w.position + 1}</span>
            {mode !== 'full' && (mode !== 'blank' || revealed) && !hidden && !notYet && (
              <span className={`page-cell__word${lengthClass(writtenForm(w))}`} lang="ja" data-written={writtenForm(w)}>
                <Written word={w} />
              </span>
            )}
            {mode === 'full' &&
              (tappable ? (
                <button
                  type="button"
                  className="page-cell__tap"
                  aria-pressed={cover ? !covered : selected === w.id}
                  aria-label={cover ? `Card ${w.position + 1}: ${covered ? 'turn over' : 'cover again'}` : `${writtenForm(w)}: memory hook and parts`}
                  onClick={() => onTap(w.id)}
                >
                  {japanese}
                  {meaning}
                </button>
              ) : (
                <>
                  {japanese}
                  {meaning}
                </>
              ))}
            {mode === 'full' && (!covered || cover === 'meaning') && (
              <span className="page-cell__audio">
                <SpeakButton text={w.kana} label={`Play ${w.kana}`} />
              </span>
            )}
            {hidden && <span className="page-cell__word page-cell__word--hidden">?</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Longer words get a smaller size, so they fit a third of a phone screen without breaking. */
function lengthClass(written: string): string {
  const n = [...written].length;
  return n >= 8 ? ' page-cell__word--xxlong' : n >= 6 ? ' page-cell__word--xlong' : n >= 5 ? ' page-cell__word--long' : '';
}
