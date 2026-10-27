import { useEffect, useState } from 'react';
import { api, type ListSummary } from '../api';
import { Notice, Written } from '../components/ui';
import { DictResults, DictSearchBox, otherForms, SenseList, useDictSearch } from '../components/DictSearch';
import { useSettings } from '../settings';
import { entryCoreMeaning, headPair, pairs, rubyFor, sensesFor, usuallyKana, type DictEntry } from '../../shared/dictionary';

// Adding a word you met while reading: find it in the dictionary, then put it
// in a list, where it waits for a page.

export function AddWord({ listId }: { listId: number | null }) {
  const [settings, update] = useSettings();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const search = useDictSearch();

  useEffect(() => {
    api.lists().then(setLists, (e: Error) => setError(e.message));
  }, []);
  // A new search closes the result you had open.
  useEffect(() => setOpen(null), [search.results?.query]);

  if (!lists) return error ? <Notice kind="error">{error}</Notice> : <p className="muted">Loading…</p>;
  const open_ = lists.filter((l) => !l.archived);
  const chosen = open_.find((l) => l.id === (listId ?? settings.addList)) ?? open_[0];
  if (!chosen) return <Notice kind="error">Every list is archived. Make a list in Lists first.</Notice>;

  return (
    <div className="stack">
      {listId !== null && (
        <a href={`#/lists/${listId}`} className="link-button link-button--back">
          ← {chosen.name}
        </a>
      )}
      <h1>Add a word</h1>
      <label className="field">
        <span>To list</span>
        <select
          value={chosen.id}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (listId !== null) window.location.hash = `#/add/${id}`;
            else update({ addList: id });
          }}
        >
          {open_.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <DictSearchBox search={search} autoFocus />
      {added && <Notice kind="success">{added}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <DictResults
        search={search}
        open={open}
        onOpen={setOpen}
        mineLabel={(m) => (m.listName ? `in ${m.listName}` : 'yours')}
        detail={(entry) => (
          <AddForm
            key={entry.seq}
            entry={entry}
            listName={chosen.name}
            onAdd={async (word) => {
              try {
                const w = await api.addFromDict(chosen.id, word);
                setError(null);
                setAdded(`Added ${w.kanji ?? w.kana} to ${chosen.name}. It waits for a page.`);
                search.addMine({ id: w.id, dictSeq: entry.seq, kana: w.kana, kanji: w.kanji, listId: chosen.id, listName: chosen.name });
                setOpen(null);
              } catch (e) {
                setAdded(null);
                setError((e as Error).message);
              }
            }}
          />
        )}
      />
    </div>
  );
}

/** One result opened: its spellings, every sense, and the meaning to learn. */
function AddForm({
  entry,
  listName,
  onAdd,
}: {
  entry: DictEntry;
  listName: string;
  onAdd: (word: { dictSeq: number; kanji: string | null; kana: string; coreMeaning: string }) => Promise<void>;
}) {
  const choices = pairs(entry);
  const head = headPair(entry);
  const [pick, setPick] = useState(Math.max(0, choices.findIndex(([k, r]) => k === head[0] && r === head[1])));
  const [kanji, kana] = choices[pick] ?? head;
  // Words usually written in kana are added in kana, unless you say otherwise.
  const [inKana, setInKana] = useState(() => kanji !== null && usuallyKana(entry, kanji, kana));
  const senses = sensesFor(entry, kanji, kana);
  const [meaning, setMeaning] = useState(entryCoreMeaning(senses));
  const [busy, setBusy] = useState(false);
  const others = otherForms(entry);

  return (
    <form
      className="word-editor stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onAdd({ dictSeq: entry.seq, kanji: inKana ? null : kanji, kana, coreMeaning: meaning.trim() });
        setBusy(false);
      }}
    >
      {choices.length > 1 && (
        <label className="field">
          <span>Spelling</span>
          <select
            lang="ja"
            value={pick}
            onChange={(e) => {
              const i = Number(e.target.value);
              setPick(i);
              const [k, r] = choices[i];
              setMeaning(entryCoreMeaning(sensesFor(entry, k, r)));
              setInKana(k !== null && usuallyKana(entry, k, r));
            }}
          >
            {choices.map(([k, r], i) => (
              <option key={i} value={i}>
                {k ? `${k}（${r}）` : r}
              </option>
            ))}
          </select>
        </label>
      )}
      {choices.length <= 1 && others && (
        <p className="small muted" lang="ja">
          Also {others}
        </p>
      )}
      {kanji && (
        <p className="small">
          <span lang="ja" className="dict-reading">
            <Written word={{ kanji, kana, furigana: rubyFor(entry, kanji, kana) }} all />
          </span>
          {usuallyKana(entry, kanji, kana) && <span className="muted"> · usually written in kana</span>}
        </p>
      )}
      {/* Every sense, also those for other spellings: the meaning to learn starts from this spelling's. */}
      <SenseList senses={entry.senses} />
      {kanji && (
        <label className="toggle">
          <input type="checkbox" checked={inKana} onChange={(e) => setInKana(e.target.checked)} />
          <span>
            Learn it in kana only (<span lang="ja">{kana}</span>)
          </span>
        </label>
      )}
      <label className="field">
        <span>Meaning to learn</span>
        <input value={meaning} onChange={(e) => setMeaning(e.target.value)} required autoComplete="off" />
      </label>
      <button className="button button--primary" disabled={busy || !meaning.trim()}>
        Add to {listName}
      </button>
    </form>
  );
}
