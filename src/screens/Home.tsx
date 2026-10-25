import { useEffect, useState } from 'react';
import { api, type Stats } from '../api';
import { Notice } from '../components/ui';
import type { KanjiLevel } from '../../shared/furigana';
import { useSettings } from '../settings';
import { canSpeak, hasJapaneseVoice } from '../speech';

export function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, update] = useSettings();
  const [voice, setVoice] = useState(hasJapaneseVoice());

  useEffect(() => {
    api.stats().then(setStats, (e: Error) => setError(e.message));
    if (canSpeak()) {
      const check = () => setVoice(hasJapaneseVoice());
      window.speechSynthesis.addEventListener('voiceschanged', check);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', check);
    }
  }, []);

  if (error) return <Notice kind="error">Could not load: {error}</Notice>;
  if (!stats) return <p className="muted">Loading…</p>;

  const empty = stats.toCheck + stats.inbox + stats.learned + stats.pagesInProgress === 0;

  return (
    <div className="stack">
      {empty && (
        <Notice>
          <p>Welcome. Start by <a href="#/import">importing a Renshuu list</a>.</p>
        </Notice>
      )}

      <section className="tiles">
        <a href="#/review" className={`tile${stats.reviewsDue > 0 ? ' tile--primary' : ''}`} data-testid="tile-review">
          <span className="tile__value">{stats.reviewsDue}</span>
          <span className="tile__label">reviews today</span>
        </a>
        <a href="#/pages" className="tile" data-testid="tile-pages">
          <span className="tile__value">{stats.pagesInProgress}</span>
          <span className="tile__label">{stats.pagesInProgress === 1 ? 'page in progress' : 'pages in progress'}</span>
        </a>
        <a href="#/pages" className="tile" data-testid="tile-inbox">
          <span className="tile__value">{stats.inbox}</span>
          <span className="tile__label">waiting for a page</span>
        </a>
        <a href="#/check" className="tile" data-testid="tile-check">
          <span className="tile__value">{stats.toCheck}</span>
          <span className="tile__label">imported, to check</span>
        </a>
      </section>

      <p className="muted">{stats.learned} {stats.learned === 1 ? 'word' : 'words'} in spaced review.</p>

      <section className="card stack">
        <h2>Audio</h2>
        {!canSpeak() || !voice ? (
          <p className="muted">No Japanese voice found on this device. On iPhone: Settings › Accessibility › Spoken Content › Voices › Japanese.</p>
        ) : null}
        <label className="toggle">
          <input type="checkbox" checked={settings.autoPlay} onChange={(e) => update({ autoPlay: e.target.checked })} />
          Play the word when the answer is shown
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.listenFirst} onChange={(e) => update({ listenFirst: e.target.checked })} />
          Listening practice: hear Japanese→meaning cards before seeing them
        </label>
      </section>

      <section className="card stack">
        <h2>Furigana</h2>
        <p className="muted">Readings show above kanji you don't know yet.</p>
        <label className="field">
          Kanji I know
          <select value={settings.kanjiLevel} onChange={(e) => update({ kanjiLevel: e.target.value as KanjiLevel })}>
            <option value="n4">N5 and N4</option>
            <option value="n5">N5</option>
            <option value="none">None (furigana on every kanji)</option>
          </select>
        </label>
        <label className="field">
          Also known
          <input lang="ja" value={settings.knownKanji} placeholder="e.g. 誰 必" onChange={(e) => update({ knownKanji: e.target.value })} />
        </label>
        <label className="field">
          Still learning (always show furigana)
          <input lang="ja" value={settings.learningKanji} placeholder="e.g. 験 貸" onChange={(e) => update({ learningKanji: e.target.value })} />
        </label>
      </section>
    </div>
  );
}
