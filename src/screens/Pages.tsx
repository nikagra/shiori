import { useEffect, useState } from 'react';
import { api, type PageSummary, type Stats } from '../api';
import { Notice } from '../components/ui';
import { navigate } from '../nav';
import { useSettings } from '../settings';

const STAGE_LABEL = { ordered: 'Step 1 of 2', shuffled: 'Step 2 of 2', graduated: 'Learned' } as const;
const SIZES = [10, 12, 15];
/** Above this many reviews, a new page would pile on more than a short session can hold. */
const BUSY_REVIEWS = 60;

export function Pages() {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, update] = useSettings();

  useEffect(() => {
    Promise.all([api.pages(), api.stats()]).then(
      ([p, s]) => {
        setPages(p);
        setStats(s);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  async function create() {
    setBusy(true);
    try {
      const page = await api.createPage(settings.pageSize);
      navigate(`/pages/${page.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!pages || !stats) return <p className="muted">Loading…</p>;

  const inProgress = pages.filter((p) => p.stage !== 'graduated');
  const learned = pages.filter((p) => p.stage === 'graduated');

  return (
    <div className="stack">
      <h1>Pages</h1>

      <section className="card stack">
        <h2>New page</h2>
        {stats.inbox === 0 ? (
          <p className="muted">
            No words waiting. {stats.toCheck > 0 ? <a href="#/check">Check imported words</a> : <a href="#/import">Import words</a>} first.
          </p>
        ) : (
          <>
            <p>
              <strong>{stats.inbox}</strong> words waiting. A page takes the next ones, in the order you met them.
            </p>
            {stats.reviewsDue > BUSY_REVIEWS && (
              <Notice>You have {stats.reviewsDue} reviews today. New words stick better when reviews are under control; consider reviewing first.</Notice>
            )}
            <div className="row">
              <span>Words per page</span>
              <div className="segmented" role="group" aria-label="Words per page">
                {SIZES.map((s) => (
                  <button key={s} className={settings.pageSize === s ? 'is-active' : ''} aria-pressed={settings.pageSize === s} onClick={() => update({ pageSize: s })}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <button className="button button--primary" disabled={busy} onClick={create}>
              Start a new page
            </button>
          </>
        )}
      </section>

      {inProgress.length > 0 && (
        <section className="stack stack--tight">
          <h2>In progress</h2>
          {inProgress.map((p) => (
            <PageLink key={p.id} page={p} />
          ))}
        </section>
      )}
      {learned.length > 0 && (
        <section className="stack stack--tight">
          <h2>Learned</h2>
          {learned.map((p) => (
            <PageLink key={p.id} page={p} />
          ))}
        </section>
      )}
    </div>
  );
}

function PageLink({ page }: { page: PageSummary }) {
  return (
    <a href={`#/pages/${page.id}`} className="list-item">
      <span>
        <strong>Page {page.number}</strong> <span className="muted">· {page.wordCount} words</span>
      </span>
      <span className={`badge badge--${page.stage}`}>{STAGE_LABEL[page.stage]}</span>
    </a>
  );
}
