import { useEffect, useState } from 'react';
import { api, type Stats } from '../api';
import { Notice } from '../components/ui';
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
          Welcome. Start by <a href="#/import">importing a Renshuu list</a>.
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

      <p className="muted">{stats.learned} words in spaced review.</p>

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
    </div>
  );
}
