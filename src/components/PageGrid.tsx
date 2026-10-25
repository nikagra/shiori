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
}: {
  page: PageDetail;
  /** full: word, reading, meaning · written: the word only · blank: positions only */
  mode: CellMode;
  highlight?: number;
  hideHighlighted?: boolean;
}) {
  return (
    <ol className={`page-grid page-grid--${mode}`} aria-label={`Page ${page.number}`}>
      {page.words.map((w) => {
        const current = w.position === highlight;
        const hidden = current && hideHighlighted;
        return (
          <li key={w.id} className={`page-cell${current ? ' page-cell--current' : ''}`} data-position={w.position}>
            <span className="page-cell__number">{w.position + 1}</span>
            {mode !== 'blank' && !hidden && (
              <span className="page-cell__word" lang="ja" data-written={writtenForm(w)}>
                {mode === 'full' ? writtenForm(w) : <Written word={w} />}
              </span>
            )}
            {mode === 'full' && (
              <>
                {w.kanji && (
                  <span className="page-cell__reading" lang="ja">
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
