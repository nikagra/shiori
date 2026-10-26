import { useEffect, useState } from 'react';
import { api, type Stats } from '../api';
import { Notice } from '../components/ui';
import { nightlyIsStale } from '../../shared/backup';

export function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When the last nightly copy was saved, if newer runs have failed. Full details are in Settings › Backup. */
  const [backupStale, setBackupStale] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats, (e: Error) => setError(e.message));
    api.nightlyBackups().then(
      (n) => {
        const savedAt = n.latest?.savedAt;
        if (savedAt && nightlyIsStale(savedAt, new Date())) setBackupStale(new Date(savedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }));
      },
      // Settings › Backup reports a failed check; Home stays quiet.
      () => {},
    );
  }, []);

  if (error) return <Notice kind="error">Could not load: {error}</Notice>;
  if (!stats) return <p className="muted">Loading…</p>;

  const empty = stats.toCheck + stats.inbox + stats.learned + stats.pagesInProgress === 0;

  return (
    <div className="stack">
      {empty && (
        <Notice>
          <p>Welcome. Start by <a href="#/settings/import">importing a Renshuu list</a>.</p>
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

      {backupStale && (
        <Notice kind="error">
          <p data-testid="home-backup-warning">
            The nightly backup hasn’t run since {backupStale}. Check the Worker logs in Cloudflare, and <a href="#/settings/backup">download a backup</a> meanwhile.
          </p>
        </Notice>
      )}
    </div>
  );
}
