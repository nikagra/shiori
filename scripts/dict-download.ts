// Downloads the dictionary releases named in dict-sources.json into .dict-data/:
//   npm run dict:download
// It writes .dict-data/jmdict-eng.json and .dict-data/JmdictFurigana.json,
// which npm run dict:build reads. Needs `unzip`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sources from '../dict-sources.json' with { type: 'json' };

const dir = '.dict-data';
mkdirSync(dir, { recursive: true });

async function download(repo: string, tag: string, asset: string, to: string) {
  if (existsSync(to)) return console.error(`${to} is there already`);
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
  console.error(`Downloading ${url}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

const { jmdict, furigana } = sources;
const zip = join(dir, 'jmdict-eng.json.zip');
const json = join(dir, 'jmdict-eng.json');
await download(jmdict.repo, jmdict.tag, jmdict.asset, zip);
if (!existsSync(json)) {
  const unpacked = join(dir, 'unzip');
  rmSync(unpacked, { recursive: true, force: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', unpacked], { stdio: 'inherit' });
  const [file] = readdirSync(unpacked).filter((f) => f.endsWith('.json'));
  if (!file) throw new Error(`no JSON file in ${zip}`);
  renameSync(join(unpacked, file), json);
  rmSync(unpacked, { recursive: true, force: true });
}
await download(furigana.repo, furigana.tag, furigana.asset, join(dir, 'JmdictFurigana.json'));
console.error(`Ready in ${dir}/. Next: npm run dict:build, then npm run dict:load.`);
