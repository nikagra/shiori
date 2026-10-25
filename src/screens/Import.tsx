import { useState } from 'react';
import { api, type ImportResult } from '../api';
import { Notice } from '../components/ui';

export function Import() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [list, setList] = useState('manga');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.importText(text, list));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
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
        <select value={list} onChange={(e) => setList(e.target.value)}>
          <option value="manga">Manga</option>
          <option value="books">Books</option>
          <option value="school">School</option>
          <option value="other">Other</option>
        </select>
      </label>

      <button className="button button--primary" disabled={busy || !text.trim()} onClick={submit}>
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
