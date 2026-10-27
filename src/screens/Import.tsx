import { useEffect, useState } from 'react';
import { api, type ImportResult, type ListSummary } from '../api';
import { Notice } from '../components/ui';
import { lookUpAll } from '../components/DictSearch';

export function Import() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [listId, setListId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Words still to look up in the dictionary after an import, then how many were found. */
  const [lookUp, setLookUp] = useState<{ remaining: number; found: number | null; notLoaded?: boolean } | null>(null);

  useEffect(() => {
    api.lists().then(
      (all) => {
        const open = all.filter((l) => !l.archived);
        setLists(open);
        // Keep a list already picked: a late answer (StrictMode loads twice) mustn't reset it.
        setListId((picked) => picked ?? open[0]?.id ?? null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  async function submit() {
    if (listId === null) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLookUp(null);
    try {
      const imported = await api.importText(text, listId);
      setResult(imported);
      if (imported.added > 0) {
        // Each new word gets its dictionary entry: readings per kanji, and a
        // flag in the check pass when none fits.
        setLookUp({ remaining: imported.added, found: null });
        try {
          const { looked, matched } = await lookUpAll((remaining) => setLookUp({ remaining, found: null }));
          setLookUp({ remaining: 0, found: matched, notLoaded: looked === 0 });
        } catch (e) {
          // The words are in; Settings › Dictionary can look them up later.
          setLookUp(null);
          throw e;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <a href="#/settings" className="link-button link-button--back">
        ‹ Settings
      </a>
      <h1>Import from Renshuu</h1>
      <p className="muted">
        In Renshuu, export a list as <strong>Custom</strong> with all fields (word, reading, definition, type, mastery), one word per line. Basic exports work
        too. Words you already have are skipped.
      </p>

      <label className="field">
        <span>Export file</span>
        <input
          type="file"
          accept=".txt,.csv,.tsv,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setText(await file.text());
          }}
        />
      </label>

      <label className="field">
        <span>…or paste it</span>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="残酷/ざんこく - cruel, brutal" lang="ja" />
      </label>

      <label className="field">
        <span>Which list is it?</span>
        <select value={listId ?? ''} onChange={(e) => setListId(Number(e.target.value))} disabled={!lists}>
          {lists?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Need another list? Add it in <a href="#/lists">Lists</a>.
      </p>

      <button className="button button--primary" disabled={busy || !text.trim() || listId === null} onClick={submit}>
        {busy ? 'Importing…' : fileName ? `Import ${fileName}` : 'Import'}
      </button>

      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="success">
          <p data-testid="import-result">
            Added <strong>{result.added}</strong> words
            {result.duplicates > 0 && <>, skipped {result.duplicates} you already had</>} ({result.format} format).
          </p>
          {result.issues.length > 0 && (
            <details>
              <summary>{result.issues.length} lines could not be read</summary>
              <ul>
                {result.issues.map((i) => (
                  <li key={i.line}>
                    Line {i.line}: {i.reason} — <code>{i.text}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {lookUp && (
            <p data-testid="import-lookup">
              {lookUp.found === null
                ? `Looking the words up in the dictionary… ${lookUp.remaining} to go.`
                : lookUp.notLoaded
                  ? 'The dictionary isn’t loaded yet, so they’ll be looked up later.'
                  : `Found ${lookUp.found} of them in the dictionary.`}
            </p>
          )}
          {result.added > 0 && (
            <p>
              Next: <a href="#/check">check which ones you already know</a>.
            </p>
          )}
        </Notice>
      )}
    </div>
  );
}
