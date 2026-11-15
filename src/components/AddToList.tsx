import { useEffect, useState } from 'react';
import { api, type ListSummary, type MyEntryWord } from '../api';
import { Notice } from './ui';
import { useSettings } from '../settings';
import { entryCoreMeaning, headPair, pairs, sensesFor, usuallyKana, type DictEntry } from '../../shared/dictionary';

// Adding a dictionary entry to a list, where it waits for a page: under the
// entry, once you've read it (look up first, add second).

/**
 * The list to add to and the word as you'll learn it. `listId` is the list
 * you came from (a list's "Add a word"); otherwise the last list you added to.
 */
export function AddToList({ entry, listId, onAdded }: { entry: DictEntry; listId: number | null; onAdded: (word: MyEntryWord, message: string) => void }) {
  const [settings, update] = useSettings();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState(listId ?? settings.addList);

  useEffect(() => {
    api.lists().then(setLists, (e: Error) => setError(e.message));
  }, []);

  if (!lists) return error ? <Notice kind="error">{error}</Notice> : <p className="muted">Loading…</p>;
  const open = lists.filter((l) => !l.archived);
  const chosen = open.find((l) => l.id === chosenId) ?? open[0];
  if (!chosen) return <Notice kind="error">Every list is archived. Make a list in Lists first.</Notice>;

  return (
    <div className="stack stack--tight">
      <label className="field">
        <span>To list</span>
        <select
          value={chosen.id}
          onChange={(e) => {
            const id = Number(e.target.value);
            setChosenId(id);
            update({ addList: id });
          }}
        >
          {open.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <AddForm
        entry={entry}
        listName={chosen.name}
        onAdd={async (word) => {
          try {
            const w = await api.addFromDict(chosen.id, word);
            setError(null);
            onAdded(
              { id: w.id, dictSeq: entry.seq, kana: w.kana, kanji: w.kanji, status: w.status, listId: chosen.id, listName: chosen.name },
              `Added ${w.kanji ?? w.kana} to ${chosen.name}. It waits for a page.`,
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}

/** The word as you'll learn it: which spelling, kana only or not, and the meaning. */
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
  const [meaning, setMeaning] = useState(() => entryCoreMeaning(sensesFor(entry, kanji, kana)));
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="stack stack--tight"
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
