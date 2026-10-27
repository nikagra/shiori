// Turns the dictionary downloads into SQL chunks for scripts/dict-load.ts:
//   npm run dict:build [-- <jmdict-eng.json> <JmdictFurigana.json>] [--out .dict-data/sql] [--chunk 5000]
// The files default to the ones npm run dict:download saves in .dict-data/
// (jmdict-eng from jmdict-simplified, not the -common one, and
// JmdictFurigana). --forms 食べる,テレビ --out file.json keeps only entries
// with those written forms or readings (for test fixtures) and writes them
// as JSON instead.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkSql, toChunks, toEntry, toRuby, type FuriganaItem, type JmdictWord, type Ruby } from '../shared/dictEntry.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const out = option('--out') ?? '.dict-data/sql';
const size = Number(option('--chunk') ?? 5000);
const forms = option('--forms');
const [jmdictFile = '.dict-data/jmdict-eng.json', furiganaFile = '.dict-data/JmdictFurigana.json', ...rest] = args;
if (!jmdictFile || !furiganaFile || rest.length || !Number.isInteger(size) || size < 1) {
  console.error('usage: npm run dict:build -- <jmdict-eng.json> <JmdictFurigana.json> [--out dir] [--chunk 5000] [--forms a,b]');
  process.exit(2);
}

const jmdict = JSON.parse(readFileSync(jmdictFile, 'utf8')) as { version: string; dictDate: string; words: JmdictWord[] };
// JmdictFurigana starts with a byte order mark.
const furiganaItems = JSON.parse(readFileSync(furiganaFile, 'utf8').replace(/^﻿/, '')) as FuriganaItem[];
const rubies = new Map<string, Ruby[]>();
for (const item of furiganaItems) rubies.set(`${item.text}|${item.reading}`, toRuby(item));

let words = jmdict.words;
if (forms) {
  const wanted = new Set(forms.split(','));
  words = words.filter((w) => [...w.kanji, ...w.kana].some((f) => wanted.has(f.text)));
}
const entries = words.map((w) => toEntry(w, (written, reading) => rubies.get(`${written}|${reading}`)));
const version = `JMdict ${jmdict.dictDate} (jmdict-simplified ${jmdict.version})`;

if (forms) {
  writeFileSync(out, `${JSON.stringify({ version, entries }, null, 1)}\n`);
  console.error(`${entries.length} entries → ${out}`);
  process.exit(0);
}

const chunks = toChunks(entries, size);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const chunk of chunks) writeFileSync(join(out, `${chunk.name}.sql`), chunkSql(chunk, version, chunks.length));
const common = entries.filter((e) => e.common).length;
writeFileSync(
  join(out, 'manifest.json'),
  `${JSON.stringify({ version, entries: entries.length, common, chunks: chunks.map((c) => ({ name: c.name, entries: c.entries.length })) }, null, 2)}\n`,
);
console.error(`${version}: ${entries.length} entries (${common} common) in ${chunks.length} chunks → ${out}`);
