import { useEffect, useState } from 'react';
import { api, type MyEntryWord } from '../api';
import { DictResults, DictSearchBox, otherForms, SenseList, useDictSearch } from '../components/DictSearch';
import { AddToList } from '../components/AddToList';
import { WordParts } from '../components/HookEditor';
import { Notice, SpeakButton, Written } from '../components/ui';
import { dictHref, entryHref, hashFor, replaceHash, wordHref, type DictContext } from '../nav';
import { headPair, rubyFor, usuallyKana, type DictEntry } from '../../shared/dictionary';
import { STATE_LABELS } from '../../shared/wordSearch';

// The dictionary on its own: look a word up, read its whole entry, and only
// then decide whether to add it (Mikita, 28 Oct). Inflected forms find their
// dictionary form (食べた: 食べる), and a compound's parts open their own
// entries. Routes: #/dict?q=…&list=… and #/dict/<JMdict number>?q=…&list=…,
// where q is what you searched for and list the list to add to.

/** The search. `list` is the list you came from, kept for adding. */
export function Dictionary({ q, list }: { q: string; list: number | null }) {
  const search = useDictSearch(q);
  // The query stays in the address, so Back from an entry comes back to it.
  useEffect(() => replaceHash(dictHref({ q: search.query.trim(), list })), [search.query, list]);
  const ctx: DictContext = { q: search.results?.query, list };

  return (
    <div className="stack">
      {list !== null && <BackToList list={list} />}
      <h1>Dictionary</h1>
      <DictSearchBox search={search} autoFocus={!q} />
      {!search.query.trim() && (
        <p className="muted small">
          Type a word as you met it: <span lang="ja">食べた</span> finds <span lang="ja">食べる</span>. Open a result to read the whole entry and add it to a list.
        </p>
      )}
      <DictResults search={search} href={(e) => entryHref(e.seq, ctx)} mineLabel={(m) => (m.listName ? `in ${m.listName}` : 'yours')} />
    </div>
  );
}

/** The list a list's "Add a word" came from: back to it. */
function BackToList({ list }: { list: number }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    api.lists().then(
      (ls) => setName(ls.find((l) => l.id === list)?.name ?? null),
      () => undefined,
    );
  }, [list]);
  return name ? (
    <a href={hashFor(`lists/${list}`)} className="link-button link-button--back">
      ← {name}
    </a>
  ) : null;
}

/** One entry, laid out like jisho's word page, with where you have it or a way to add it. */
export function DictEntryPage({ seq, ctx }: { seq: number; ctx: DictContext }) {
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [mine, setMine] = useState<MyEntryWord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.dictEntry(seq).then(
      (r) => {
        if (!live) return;
        setEntry(r.entry);
        setMine(r.mine);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [seq]);

  const back = (
    <a href={dictHref(ctx)} className="link-button link-button--back">
      ← {ctx.q ? <>Results for “{ctx.q}”</> : 'Dictionary'}
    </a>
  );
  if (!entry) return <div className="stack">{back}{error ? <Notice kind="error">{error}</Notice> : <p className="muted">Loading…</p>}</div>;

  const [kanji, kana] = headPair(entry);
  const others = otherForms(entry);
  return (
    <div className="stack">
      {back}
      <section className="dict-entry stack stack--tight" aria-label="Entry">
        <div className="row">
          <h1 className="dict-entry__word" lang="ja" data-written={kanji ?? kana}>
            {kanji ? <Written word={{ kanji, kana, furigana: rubyFor(entry, kanji, kana) }} all /> : kana}
          </h1>
          <SpeakButton text={kana} />
          {entry.common && <span className="badge">common</span>}
        </div>
        {(others || (kanji && usuallyKana(entry, kanji, kana))) && (
          <p className="small muted">
            {others && (
              <>
                Also <span lang="ja">{others}</span>
              </>
            )}
            {others && kanji && usuallyKana(entry, kanji, kana) && ' · '}
            {kanji && usuallyKana(entry, kanji, kana) && 'usually written in kana'}
          </p>
        )}
        {kanji && <WordParts word={{ kanji }} linkTo={(part) => entryHref(part, ctx)} />}
      </section>

      <section className="stack stack--tight" aria-label="Meanings">
        <h2>Meanings</h2>
        <SenseList senses={entry.senses} />
      </section>

      {added && <Notice kind="success">{added}</Notice>}
      {mine.length > 0 ? (
        <section className="card stack stack--tight" data-testid="dict-mine">
          {mine.map((m) => (
            <p key={m.id}>
              You have <span lang="ja">{m.kanji ?? m.kana}</span>
              {m.listName ? ` in ${m.listName}` : ''}, {STATE_LABELS[m.status].toLowerCase()}.{' '}
              {m.listId !== null && <a href={wordHref(m.listId, m.id)}>Open it in {m.listName}</a>}
            </p>
          ))}
        </section>
      ) : adding ? (
        <section className="card stack stack--tight" aria-label="Add to a list">
          <h2>Add to a list</h2>
          <AddToList
            entry={entry}
            listId={ctx.list ?? null}
            onAdded={(word, message) => {
              setMine([word]);
              setAdded(message);
              setAdding(false);
            }}
          />
        </section>
      ) : (
        <button type="button" className="button button--primary button--wide" onClick={() => setAdding(true)}>
          Add to list
        </button>
      )}
    </div>
  );
}
