import { writtenForm, type Word } from '../api';
import { similarPairs } from '../../shared/similar';
import { Notice } from './ui';

/** Points out words on a page that are close in meaning, so you can swap one out. */
export function SimilarNotice({ words, action }: { words: readonly Pick<Word, 'id' | 'kanji' | 'kana' | 'coreMeaning'>[]; action: string }) {
  const pairs = similarPairs(words);
  if (pairs.length === 0) return null;
  return (
    <Notice>
      <div data-testid="similar">
        <p>Close in meaning, so they may blur together:</p>
        <ul className="similar-list">
          {pairs.map(({ a, b, shared }) => (
            <li key={`${a.id}-${b.id}`}>
              <span lang="ja">{writtenForm(a)}</span> and <span lang="ja">{writtenForm(b)}</span> <span className="muted">({shared.join(', ')})</span>
            </li>
          ))}
        </ul>
        <p className="small">{action}</p>
      </div>
    </Notice>
  );
}
