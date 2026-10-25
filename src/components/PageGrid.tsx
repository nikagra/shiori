import { writtenForm, type PageDetail } from '../api';
import { SpeakButton, Written } from './ui';

// The page: a fixed 3-column grid that looks the same on phone and laptop,
// so a word keeps its place in your memory.

export type CellMode = 'full' | 'written' | 'blank';

export function PageGrid({
  page,
  mode,
  highlight,
  hideHighlighted = false,
  hiddenIds,
}: {
  page: PageDetail;
  /** full: word, reading, meaning · written: the word only · blank: positions only */
  mode: CellMode;
  highlight?: number;
  hideHighlighted?: boolean;
  /** Words not to show yet: their cells keep only the position. */
  hiddenIds?: Set<number>;
}) {
  return (
    <ol className={`page-grid page-grid--${mode}`} aria-label={`Page ${page.number}`}>
      {page.words.map((w) => {
        const current = w.position === highlight;
        const hidden = current && hideHighlighted;
        const notYet = !current && hiddenIds?.has(w.id);
        return (
          <li key={w.id} className={`page-cell${current ? ' page-cell--current' : ''}`} data-position={w.position}>
            <span className="page-cell__number">{w.position + 1}</span>
            {mode !== 'blank' && !hidden && !notYet && (
              <span className={`page-cell__word${lengthClass(writtenForm(w))}`} lang="ja" data-written={writtenForm(w)}>
                {mode === 'full' ? writtenForm(w) : <Written word={w} />}
              </span>
            )}
            {mode === 'full' && (
              <>
                {w.kanji && (
                  <span className={`page-cell__reading${[...w.kana].length >= 7 ? ' page-cell__reading--long' : ''}`} lang="ja">
                    {w.kana}
                  </span>
                )}
                <span className="page-cell__meaning">{w.coreMeaning}</span>
                <span className="page-cell__audio">
                  <SpeakButton text={w.kana} label={`Play ${w.kana}`} />
                </span>
              </>
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
  return n >= 6 ? ' page-cell__word--xlong' : n >= 5 ? ' page-cell__word--long' : '';
}
