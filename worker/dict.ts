import { toHiragana, toKatakana } from 'wanakana';
import { dictInfo, formsMatch, lookupForm, matchWord, searchRank, searchSteps, type DictEntry, type Match, type WordToMatch } from '../shared/dictionary';
import { saveDictInfo, wordsToLookUp } from './db';

// Reading the dictionary database (DICT). It only holds JMdict, so nothing
// here writes to it; scripts/dict-load.ts fills it.

export interface DictStatus {
  /** The JMdict version loaded, or null while it's empty. */
  version: string | null;
  chunks: number;
  loaded: number;
  /** Every chunk is in: a word with no match really isn't in JMdict. */
  complete: boolean;
}

export async function dictStatus(dict: D1Database): Promise<DictStatus> {
  try {
    const rows = await dict.prepare('SELECT key, value FROM meta').all<{ key: string; value: string }>();
    const meta = new Map(rows.results.map((r) => [r.key, r.value]));
    const chunks = Number(meta.get('chunks') ?? 0);
    const loaded = [...meta.keys()].filter((k) => k.startsWith('loaded:')).length;
    return { version: meta.get('version') ?? null, chunks, loaded, complete: chunks > 0 && loaded >= chunks };
  } catch {
    // The dictionary database has no tables yet (its migration hasn't run).
    return { version: null, chunks: 0, loaded: 0, complete: false };
  }
}

/** Entries (as JSON text) whose ids the search index gave, in that order: common words first. */
async function rawEntries(dict: D1Database, match: string, limit: number): Promise<string[]> {
  try {
    const rows = await dict
      .prepare('SELECT data FROM entries WHERE id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ? ORDER BY rowid LIMIT ?) ORDER BY id')
      .bind(match, limit)
      .all<{ data: string }>();
    return rows.results.map((r) => r.data);
  } catch (e) {
    // A query the index can't read (only punctuation, say) finds nothing.
    if (String(e).includes('fts5')) return [];
    throw e;
  }
}

const entriesFor = async (dict: D1Database, match: string, limit: number) => (await rawEntries(dict, match, limit)).map((r) => JSON.parse(r) as DictEntry);

/** How many results a search looks at before ranking. */
const CANDIDATES = 120;

/** Entries for a search box: kana, romaji, kanji or English. Best first. */
export async function searchDict(dict: D1Database, query: string, limit = 30): Promise<DictEntry[]> {
  const seen = new Map<number, { entry: DictEntry; step: number; order: number }>();
  const steps = searchSteps(query);
  for (const [step, match] of steps.entries()) {
    for (const entry of await entriesFor(dict, match, CANDIDATES)) {
      if (!seen.has(entry.seq)) seen.set(entry.seq, { entry, step, order: seen.size });
    }
  }
  return [...seen.values()]
    .map((r) => ({ ...r, rank: searchRank(r.entry, query) }))
    .sort((a, b) => a.rank - b.rank || a.step - b.step || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.entry);
}

export async function entryBySeq(dict: D1Database, seq: number): Promise<DictEntry | null> {
  const [entry] = await entriesFor(dict, `seq : "${seq}"`, 1);
  return entry ?? null;
}

/**
 * Words per lookup query. A reading like かく has dozens of entries, and the
 * query keeps the first 1000 (common words first), so batches stay small.
 */
const WORDS_PER_QUERY = 10;

/** The dictionary entry for each word (null where none fits), in order. */
export async function matchWords(dict: D1Database, words: WordToMatch[]): Promise<(Match | null)[]> {
  const out: (Match | null)[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_QUERY) {
    const batch = words.slice(i, i + WORDS_PER_QUERY);
    // By written form and by reading, in hiragana and katakana (くらくら is
    // filed as クラクラ): the match itself decides which entry fits.
    const forms = batch.flatMap((w) => {
      const kana = lookupForm(w.kana);
      return [...(w.kanji ? [lookupForm(w.kanji)] : []), kana, toHiragana(kana, { passRomaji: true }), toKatakana(kana, { passRomaji: true })];
    });
    const raw = await rawEntries(dict, formsMatch(forms.filter(Boolean)), 1000);
    // Parsing JSON is most of the CPU time, so only entries that hold the
    // word's reading are parsed, each once.
    const parsed = new Map<string, DictEntry>();
    const parse = (r: string) => parsed.get(r) ?? parsed.set(r, JSON.parse(r) as DictEntry).get(r)!;
    for (const w of batch) {
      const kana = lookupForm(w.kana);
      const texts = [kana, toHiragana(kana, { passRomaji: true }), toKatakana(kana, { passRomaji: true })].map((k) => `"text":${JSON.stringify(k)}`);
      out.push(matchWord(w, raw.filter((r) => texts.some((t) => r.includes(t))).map(parse)));
    }
  }
  return out;
}

/** Words looked up per call, so one request stays well inside the Worker's limits. */
export const LOOKUPS_PER_CALL = 100;

/**
 * Looks up words that have no dictionary entry yet: new ones, and ones with
 * no match while the dictionary was still loading, a batch at a time (or
 * just word `id`). Returns how many are still waiting.
 */
export async function lookUpWords(db: D1Database, dict: D1Database, id?: number): Promise<{ looked: number; matched: number; remaining: number }> {
  const status = await dictStatus(dict);
  if (status.loaded === 0) return { looked: 0, matched: 0, remaining: 0 };
  const { words, remaining } = await wordsToLookUp(db, status.loaded, LOOKUPS_PER_CALL, id);
  const matches = await matchWords(dict, words);
  await saveDictInfo(
    db,
    words.map((w, i) => ({ word: w, info: dictInfo(w, matches[i]), checked: status.loaded })),
  );
  return { looked: words.length, matched: matches.filter(Boolean).length, remaining: remaining - words.length };
}
