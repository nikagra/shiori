// Loads the dictionary chunks made by scripts/dict-build.ts into the
// shiori-dict database, carrying on from the last chunk loaded:
//   npm run dict:load                      the laptop's database (all of it)
//   npm run dict:load -- --remote          the cloud one, up to a day's budget
// Options:
//   --dir .dict-data/sql    where dict:build wrote the chunks
//   --json file.json        load entries from a --forms fixture instead
//   --budget 90000          row writes allowed for this run (--remote only;
//                           the free plan allows 100,000 a day)
//   --persist-to dir        a local database somewhere else (the e2e one)
//   --fresh                 drop what's there first (a new dictionary version)
//   --status                only print complete=true or complete=false
//                           (for the nightly workflow)
// Each chunk costs about two row writes per entry: the entry and its search
// row. A chunk that fails (the day's limit, say) leaves nothing marked as
// loaded, so running again later redoes it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkSql, toChunks, type DictEntry } from '../shared/dictEntry.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
};
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const remote = flag('--remote');
const fresh = flag('--fresh');
const statusOnly = flag('--status');
const dir = option('--dir') ?? '.dict-data/sql';
const json = option('--json');
const persistTo = option('--persist-to');
const budget = Number(option('--budget') ?? 90_000);
if (args.length || !Number.isFinite(budget) || (remote && persistTo)) {
  console.error('usage: npm run dict:load -- [--remote] [--dir .dict-data/sql | --json fixture.json] [--budget 90000] [--persist-to dir] [--fresh] [--status]');
  process.exit(2);
}

const where = remote ? ['--remote'] : ['--local', ...(persistTo ? ['--persist-to', persistTo] : [])];
function wrangler(...rest: string[]): string {
  return execFileSync('npx', ['wrangler', 'd1', ...rest, ...where], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}
function query<T>(sql: string): T[] {
  const out = JSON.parse(wrangler('execute', 'shiori-dict', '--json', '--command', sql)) as { results: T[] }[];
  return out[0]?.results ?? [];
}

if (statusOnly) {
  wrangler('migrations', 'apply', 'shiori-dict');
  const meta = query<{ key: string; value: string }>('SELECT key, value FROM meta');
  const chunks = Number(meta.find((r) => r.key === 'chunks')?.value ?? 0);
  const loaded = meta.filter((r) => r.key.startsWith('loaded:')).length;
  console.log(`complete=${chunks > 0 && loaded >= chunks}`);
  process.exit(0);
}

/** Chunks as files: from dict:build, or made here from a fixture. */
interface ChunkFile {
  name: string;
  entries: number;
  file: string;
}
let version: string;
let chunks: ChunkFile[];
if (json) {
  const fixture = JSON.parse(readFileSync(json, 'utf8')) as { version: string; entries: DictEntry[] };
  const tmp = mkdtempSync(join(tmpdir(), 'shiori-dict-'));
  const made = toChunks(fixture.entries, 5000);
  version = `${fixture.version} (sample)`;
  chunks = made.map((c) => {
    const file = join(tmp, `${c.name}.sql`);
    writeFileSync(file, chunkSql(c, version, made.length));
    return { name: c.name, entries: c.entries.length, file };
  });
} else {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { version: string; chunks: { name: string; entries: number }[] };
  version = manifest.version;
  chunks = manifest.chunks.map((c) => ({ ...c, file: join(dir, `${c.name}.sql`) }));
}

wrangler('migrations', 'apply', 'shiori-dict');
if (fresh) {
  console.error('Dropping the dictionary that is there…');
  // The tables again as the migration makes them (meta is only emptied).
  const schema = readFileSync(join(import.meta.dirname, '..', 'dict-migrations', '0001_dictionary.sql'), 'utf8').replace(/CREATE TABLE meta[^;]*;/, '');
  const file = join(mkdtempSync(join(tmpdir(), 'shiori-dict-')), 'fresh.sql');
  writeFileSync(file, `DELETE FROM meta;\nDROP TABLE IF EXISTS entries_fts;\nDROP TABLE IF EXISTS entries;\n${schema}`);
  wrangler('execute', 'shiori-dict', '--file', file, ...(remote ? ['--yes'] : []));
}

const meta = new Map(query<{ key: string; value: string }>('SELECT key, value FROM meta').map((r) => [r.key, r.value]));
const there = meta.get('version');
if (there && there !== version) {
  console.error(`The database holds ${there}, not ${version}.`);
  console.error('Run again with --fresh to replace it; that loads everything again (about two row writes per entry).');
  process.exit(1);
}

let spent = 0;
let loaded = chunks.filter((c) => meta.has(`loaded:${c.name}`)).length;
for (const chunk of chunks) {
  if (meta.has(`loaded:${chunk.name}`)) continue;
  const cost = chunk.entries * 2 + 10;
  if (remote && spent + cost > budget) break;
  console.error(`Loading chunk ${chunk.name} (${chunk.entries} entries)…`);
  wrangler('execute', 'shiori-dict', '--file', chunk.file, ...(remote ? ['--yes'] : []));
  spent += cost;
  loaded++;
}
console.error(
  loaded === chunks.length
    ? `The dictionary is complete: ${version}, ${chunks.length} chunks.`
    : `Loaded ${loaded} of ${chunks.length} chunks (about ${spent} row writes this run). Run again tomorrow to carry on.`,
);
