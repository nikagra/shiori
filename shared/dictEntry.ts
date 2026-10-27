// A dictionary entry: JMdict (English) from jmdict-simplified, with per-kanji
// readings from JmdictFurigana, as the dictionary database stores it, and
// how to read it. No imports, so the loader script runs it in Node directly;
// searching and matching your words are in dictionary.ts.

/** A reading lined up with part of the written form: [text, reading]. Kana parts have no reading. (The same as Ruby in furigana.ts.) */
export type Ruby = [text: string, reading?: string];

export interface DictForm {
  text: string;
  common?: true;
  /** JMdict tags: sK/sk search-only, rK/rk rare, iK/ik irregular, oK/ok outdated, ateji, gikun. */
  tags?: string[];
  /** Kana only: the kanji forms this reading goes with, when not all of them (empty: written in kana only). */
  kanji?: string[];
}

export interface DictSense {
  /** JMdict part-of-speech codes (v1, vt, n, adj-na, ...). */
  pos: string[];
  gloss: string[];
  /** JMdict misc codes: uk (usually written in kana), col, hon, ... */
  misc?: string[];
  info?: string[];
  /** Only for these forms, when not all of them. */
  kanji?: string[];
  kana?: string[];
}

export interface DictEntry {
  /** JMdict's own entry number: stays the same across dictionary versions. */
  seq: number;
  common: boolean;
  kanji: DictForm[];
  kana: DictForm[];
  senses: DictSense[];
  /** Readings per kanji, by "written|reading", from JmdictFurigana. */
  furigana?: Record<string, Ruby[]>;
}

/** Where the dictionary data comes from: shown in Settings, as CC BY-SA 4.0 asks. */
export const DICT_CREDITS = [
  { name: 'JMdict', by: 'the Electronic Dictionary Research and Development Group', url: 'https://www.edrdg.org/edrdg/licence.html' },
  { name: 'jmdict-simplified', by: 'scriptin', url: 'https://github.com/scriptin/jmdict-simplified' },
  { name: 'JmdictFurigana', by: 'Doublevil', url: 'https://github.com/Doublevil/JmdictFurigana' },
] as const;

// ---------------------------------------------------------------- building

/** One entry as jmdict-simplified writes it (only the fields used here). */
export interface JmdictWord {
  id: string;
  kanji: { common: boolean; text: string; tags: string[] }[];
  kana: { common: boolean; text: string; tags: string[]; appliesToKanji: string[] }[];
  sense: {
    partOfSpeech: string[];
    appliesToKanji: string[];
    appliesToKana: string[];
    misc: string[];
    info: string[];
    gloss: { lang: string; text: string }[];
  }[];
}

/** One JmdictFurigana item. */
export interface FuriganaItem {
  text: string;
  reading: string;
  furigana: { ruby: string; rt?: string }[];
}

/** "*" means every form; an empty list (a reading with no kanji) stays empty. */
const only = (list: string[]) => (list.includes('*') ? undefined : list);
const nonEmpty = <T>(list: T[]) => (list.length ? list : undefined);

/** The compact entry stored in the dictionary database. `furigana` is looked up by "written|reading". */
export function toEntry(w: JmdictWord, furigana: (written: string, reading: string) => Ruby[] | undefined): DictEntry {
  const entry: DictEntry = {
    seq: Number(w.id),
    common: [...w.kanji, ...w.kana].some((f) => f.common),
    kanji: w.kanji.map((k) => clean({ text: k.text, common: k.common || undefined, tags: nonEmpty(k.tags) })),
    kana: w.kana.map((k) => clean({ text: k.text, common: k.common || undefined, tags: nonEmpty(k.tags), kanji: only(k.appliesToKanji) })),
    senses: w.sense.map((s) =>
      clean({
        pos: s.partOfSpeech,
        gloss: s.gloss.filter((g) => g.lang === 'eng').map((g) => g.text),
        misc: nonEmpty(s.misc),
        info: nonEmpty(s.info),
        kanji: nonEmpty(only(s.appliesToKanji) ?? []),
        kana: nonEmpty(only(s.appliesToKana) ?? []),
      }),
    ),
  };
  const rubies: Record<string, Ruby[]> = {};
  for (const [kanji, kana] of pairs(entry, true)) {
    if (!kanji) continue;
    const r = furigana(kanji, kana);
    if (r) rubies[`${kanji}|${kana}`] = r;
  }
  if (Object.keys(rubies).length) entry.furigana = rubies;
  return entry;
}

/** Drops the keys left undefined, so the stored JSON stays small. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** JmdictFurigana's segments as Ruby, merging neighbouring kana. */
export function toRuby(item: FuriganaItem): Ruby[] {
  const out: Ruby[] = [];
  for (const { ruby, rt } of item.furigana) {
    const last = out[out.length - 1];
    if (!rt && last && last[1] === undefined) last[0] += ruby;
    else out.push(rt ? [ruby, rt] : [ruby]);
  }
  return out;
}

/** The text the search index holds for an entry: every written form and reading, and every meaning. */
export function indexText(e: DictEntry): { forms: string; glosses: string } {
  const forms = [...e.kanji, ...e.kana].map((f) => f.text);
  return {
    // Also as NFKC, the way searches and your words are normalized: Ｔシャツ is found as Tシャツ.
    forms: [...new Set([...forms, ...forms.map((f) => f.normalize('NFKC'))])].join(' '),
    glosses: e.senses.flatMap((s) => s.gloss).join(' ; '),
  };
}

// ---------------------------------------------------------------- reading an entry

const HIDDEN = ['sK', 'sk'];
/** Forms worth showing: not search-only. */
export const shownForms = (forms: DictForm[]) => forms.filter((f) => !f.tags?.some((t) => HIDDEN.includes(t)));

/** Every (kanji, kana) pair the entry allows; kana-only readings pair with null. `all` keeps search-only forms. */
export function pairs(e: DictEntry, all = false): [kanji: string | null, kana: string][] {
  const kanji = all ? e.kanji : shownForms(e.kanji);
  const kana = all ? e.kana : shownForms(e.kana);
  const out: [string | null, string][] = [];
  for (const r of kana) {
    if (kanji.length === 0 || r.kanji?.length === 0) {
      out.push([null, r.text]);
      continue;
    }
    for (const k of kanji) if (!r.kanji || r.kanji.includes(k.text)) out.push([k.text, r.text]);
  }
  return out;
}

/** The senses that go with this written form and reading. */
export function sensesFor(e: DictEntry, kanji: string | null, kana: string): DictSense[] {
  const fits = e.senses.filter((s) => (!kanji || !s.kanji || s.kanji.includes(kanji)) && (!s.kana || s.kana.includes(kana)));
  return fits.length ? fits : e.senses;
}

/** The form to show first: the first common pair, else the first. */
export function headPair(e: DictEntry): [string | null, string] {
  const all = pairs(e);
  const common = all.find(([k, r]) => (!k || e.kanji.find((f) => f.text === k)?.common) && e.kana.find((f) => f.text === r)?.common);
  return common ?? all[0] ?? [null, e.kana[0]?.text ?? ''];
}

/** "Usually written in kana": the first sense says so. */
export const usuallyKana = (e: DictEntry, kanji: string | null, kana: string) => Boolean(sensesFor(e, kanji, kana)[0]?.misc?.includes('uk'));

/** Readings per kanji for this written form, when the dictionary has them. */
export const rubyFor = (e: DictEntry, kanji: string | null, kana: string): Ruby[] | null => (kanji ? (e.furigana?.[`${kanji}|${kana}`] ?? null) : null);

/** Senses as Shiori stores them: one string per sense, glosses joined by commas (the Renshuu layout). */
export const senseStrings = (senses: DictSense[]) => senses.map((s) => s.gloss.join(', ')).filter(Boolean);

// Short labels for the part-of-speech codes a learner meets; the rest show as their code.
const POS: Record<string, string> = {
  n: 'noun',
  pn: 'pronoun',
  'n-suf': 'noun suffix',
  'n-pref': 'noun prefix',
  'adj-i': 'い-adjective',
  'adj-ix': 'い-adjective (いい)',
  'adj-na': 'な-adjective',
  'adj-no': 'の-adjective',
  'adj-pn': 'pre-noun adjective',
  'adj-t': 'たる-adjective',
  'adj-f': 'pre-noun',
  adv: 'adverb',
  'adv-to': 'adverb (と)',
  'aux-v': 'auxiliary verb',
  'aux-adj': 'auxiliary adjective',
  conj: 'conjunction',
  cop: 'copula',
  ctr: 'counter',
  exp: 'expression',
  int: 'interjection',
  num: 'number',
  pref: 'prefix',
  prt: 'particle',
  suf: 'suffix',
  v1: 'Ichidan verb',
  'v1-s': 'Ichidan verb',
  'v5aru': 'Godan verb',
  v5b: 'Godan verb',
  v5g: 'Godan verb',
  v5k: 'Godan verb',
  'v5k-s': 'Godan verb (行く)',
  v5m: 'Godan verb',
  v5n: 'Godan verb',
  v5r: 'Godan verb',
  'v5r-i': 'Godan verb',
  v5s: 'Godan verb',
  v5t: 'Godan verb',
  v5u: 'Godan verb',
  'v5u-s': 'Godan verb',
  vk: 'くる verb',
  vs: 'する verb',
  'vs-i': 'する verb',
  'vs-s': 'する verb',
  'vs-c': 'す verb',
  vz: 'ずる verb',
  vi: 'intransitive',
  vt: 'transitive',
};

/** "Ichidan verb · transitive". */
export function posLabel(codes: string[]): string {
  return [...new Set(codes.map((c) => POS[c] ?? c))].join(' · ');
}

const MISC: Record<string, string> = {
  uk: 'usually in kana',
  col: 'colloquial',
  hon: 'honorific',
  hum: 'humble',
  pol: 'polite',
  sl: 'slang',
  abbr: 'abbreviation',
  arch: 'archaic',
  dated: 'dated',
  rare: 'rare',
  vulg: 'vulgar',
  derog: 'derogatory',
  male: 'male language',
  fem: 'female language',
  'on-mim': 'onomatopoeia',
  id: 'idiom',
  yoji: 'four-character idiom',
  proverb: 'proverb',
  joc: 'jocular',
  poet: 'poetic',
  form: 'formal',
};

/** Notes worth showing next to a sense ("colloquial", "honorific"). */
export const miscLabels = (s: DictSense) => (s.misc ?? []).map((m) => MISC[m]).filter((m): m is string => Boolean(m));

/** A first core meaning for a word added from the dictionary: its first sense, a few glosses. */
export function entryCoreMeaning(senses: DictSense[], maxGlosses = 3): string {
  return senses[0]?.gloss.slice(0, maxGlosses).join(', ') ?? '';
}


// ---------------------------------------------------------------- loading

/** A SQL string literal. */
const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** D1 refuses statements over 100 KB; multi-row inserts stay well under it (in UTF-8 bytes). */
const MAX_STATEMENT = 50_000;
const bytes = (s: string) => new TextEncoder().encode(s).length;

function inserts(head: string, rows: string[]): string[] {
  const out: string[] = [];
  let batch: string[] = [];
  let size = 0;
  for (const row of rows) {
    const length = bytes(row);
    if (batch.length && size + length > MAX_STATEMENT) {
      out.push(`${head}\n${batch.join(',\n')};`);
      batch = [];
      size = 0;
    }
    batch.push(row);
    size += length + 2;
  }
  if (batch.length) out.push(`${head}\n${batch.join(',\n')};`);
  return out;
}

export interface Chunk {
  /** "0001": loaded in name order. */
  name: string;
  /** Entry ids from first to first + entries.length - 1. */
  first: number;
  entries: DictEntry[];
}

/**
 * The SQL that loads one chunk of entries. It clears the chunk's ids first,
 * so a load cut off halfway can simply run again, and records the chunk in
 * meta last, so only a whole chunk counts as loaded.
 */
export function chunkSql(chunk: Chunk, version: string, chunks: number): string {
  const last = chunk.first + chunk.entries.length - 1;
  const ids = chunk.entries.map((e, i) => ({ id: chunk.first + i, e }));
  return [
    `DELETE FROM entries_fts WHERE rowid BETWEEN ${chunk.first} AND ${last};`,
    `DELETE FROM entries WHERE id BETWEEN ${chunk.first} AND ${last};`,
    ...inserts(
      'INSERT INTO entries (id, seq, data) VALUES',
      ids.map(({ id, e }) => `(${id}, ${e.seq}, ${sqlText(JSON.stringify(e))})`),
    ),
    ...inserts(
      'INSERT INTO entries_fts (rowid, forms, glosses, seq) VALUES',
      ids.map(({ id, e }) => {
        const t = indexText(e);
        return `(${id}, ${sqlText(t.forms)}, ${sqlText(t.glosses)}, '${e.seq}')`;
      }),
    ),
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ${sqlText(version)}), ('chunks', '${chunks}'), ('loaded:${chunk.name}', '${chunk.entries.length}');`,
    '',
  ].join('\n');
}

/** Common words first, so a dictionary still loading already has the words you're most likely to look up. */
export function toChunks(entries: DictEntry[], size: number): Chunk[] {
  const ordered = [...entries.filter((e) => e.common), ...entries.filter((e) => !e.common)];
  const out: Chunk[] = [];
  for (let i = 0; i < ordered.length; i += size) {
    out.push({ name: String(out.length + 1).padStart(4, '0'), first: i + 1, entries: ordered.slice(i, i + size) });
  }
  return out;
}
