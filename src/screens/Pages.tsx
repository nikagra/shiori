import { useEffect, useState } from 'react';
import { api, type ListSummary, type PageSummary, type Stats } from '../api';
import { Notice } from '../components/ui';
import { navigate } from '../nav';
import { useSettings } from '../settings';

const STAGE_LABEL = { ordered: 'Step 1 of 2', shuffled: 'Step 2 of 2', graduated: 'Learned' } as const;
/** Above this many reviews, a new page would pile on more than a short session can hold. */
const BUSY_REVIEWS = 60;

export function Pages() {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  /** The list to take words from; 'auto' lets the server pick. */
  const [from, setFrom] = useState<number | 'auto'>('auto');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Past today's new words, "anyway" was pressed. */
  const [moreToday, setMoreToday] = useState(false);
  const [settings] = useSettings();

  useEffect(() => {
    Promise.all([api.pages(), api.stats(), api.lists()]).then(
      ([p, s, l]) => {
        setPages(p);
        setStats(s);
        setLists(l);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  async function create() {
    setBusy(true);
    try {
      const page = await api.createPage(settings.pageSize, from === 'auto' ? null : from);
      navigate(`/pages/${page.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!pages || !stats || !lists) return <p className="muted">Loading…</p>;

  const waiting = lists.filter((l) => !l.archived && l.counts.inbox > 0);
  const next = lists.find((l) => l.next);
  const chosen = from === 'auto' ? next : waiting.find((l) => l.id === from);

  const inProgress = pages.filter((p) => p.stage !== 'graduated');
  const learned = pages.filter((p) => p.stage === 'graduated');

  return (
    <div className="stack">
      <h1>Pages</h1>

      <section className="card stack">
        <h2>New page</h2>
        {stats.inbox === 0 ? (
          <>
            <p className="muted">
              No words waiting. {stats.toCheck > 0 ? <a href="#/check">Check imported words</a> : <a href="#/settings/import">Import words</a>} first.
            </p>
            {stats.toCheck > 0 && (
              <a href="#/pages/new" className="link-button">
                Or pick words to check for a page yourself
              </a>
            )}
          </>
        ) : (
          <>
            <p>
              <strong>{stats.inbox}</strong> words waiting. A page takes the next ones from one list, in the order you met them.
            </p>
            <label className="field">
              <span>From list</span>
              <select value={from} onChange={(e) => setFrom(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}>
                <option value="auto">{next ? `Pick for me (${next.name})` : 'Pick for me'}</option>
                {waiting.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}: {l.counts.inbox} waiting{l.paused ? ', paused' : ''}
                  </option>
                ))}
              </select>
            </label>
            {from === 'auto' && !next && (
              <Notice>Every list with words waiting is paused. Pick one above, or unpause it in <a href="#/lists">Lists</a>.</Notice>
            )}
            {stats.reviewsDue > BUSY_REVIEWS && (
              <Notice>You have {stats.reviewsDue} reviews today. New words stick better when reviews are under control; consider reviewing first.</Notice>
            )}
            <p className="muted small" data-testid="page-size">
              {settings.pageSize} words per page, {stats.newWordsPerDay} new words a day ({stats.newWordsToday} today). Change them in{' '}
              <a href="#/settings">Settings</a>.
            </p>
            {stats.newWordsToday >= stats.newWordsPerDay && !moreToday ? (
              <>
                <Notice>
                  You've started {stats.newWordsToday} new words today, your daily {stats.newWordsPerDay}. More pages today mean more reviews tomorrow,
                  and new words stick better with room to review them.
                </Notice>
                <button className="button" onClick={() => setMoreToday(true)}>
                  Start another page anyway
                </button>
              </>
            ) : (
              <>
                <button className="button button--primary" disabled={busy || !chosen} onClick={create}>
                  Start a new page
                </button>
                <a href={chosen ? `#/pages/new/${chosen.id}` : '#/pages/new'} className="button">
                  Pick the words yourself
                </a>
              </>
            )}
            <a href="#/lists" className="link-button">
              Lists, weights and weekly targets
            </a>
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
        <strong>Page {page.number}</strong>{' '}
        <span className="muted">
          · {page.listName ? `${page.listName} · ` : ''}
          {page.wordCount} words
        </span>
      </span>
      <span className={`badge badge--${page.stage}`}>{STAGE_LABEL[page.stage]}</span>
    </a>
  );
}
