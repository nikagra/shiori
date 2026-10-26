import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_SCHEMA, BACKUP_TABLES, backupToSql, LISTS_FROM_LABELS, dateOfBackupFile, KEEP_DAYS, nightlyIsStale, parseBackup, schemaCheck, TABLE_SINCE, type Backup } from '../shared/backup';
import { parseRenshuuExport } from '../shared/renshuu';
import { Rating } from '../shared/scheduler';
import { nightlyStatus, saveNightly } from '../worker/backup';
import * as repo from '../worker/db';
import { createTestDb } from './d1';

const root = join(import.meta.dirname, '..');
const words = parseRenshuuExport(readFileSync(join(root, 'test', 'fixtures', 'renshuu_custom_sample.txt'), 'utf8')).words;

const now = new Date('2026-10-25T20:00:00Z');
const dayStart = new Date('2026-10-25T03:00:00Z');
const dayEnd = new Date('2026-10-26T03:00:00Z');
const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** The starting lists are Manga, Books, School and Other, in that order. */
const MANGA = 1;

let db: D1Database;
const tempDirs: string[] = [];
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiori-backup-'));
  tempDirs.push(dir);
  return dir;
};

/** Some of everything: checked words, a graduated page, a review, furigana settings and a peek. */
async function studySomething() {
  await repo.importWords(db, words, MANGA, now);
  const { words: batch } = await repo.triageNext(db, 14);
  for (const w of batch.slice(0, 2)) await repo.triageAnswer(db, w.id, 'known', now);
  for (const w of batch.slice(2, 14)) await repo.triageAnswer(db, w.id, 'unknown', now);
  await repo.triageAnswer(db, (await repo.triageNext(db, 1)).words[0].id, 'ignore', now);
  const page = await repo.createPage(db, 10, null, now);
  await repo.completeStage(db, page.id, 'ordered', dayEnd, now);
  await repo.completeStage(db, page.id, 'shuffled', dayEnd, now);
  await repo.createPage(db, 10, null, now).catch(() => undefined);
  const later = days(now, 2);
  const q = await repo.reviewQueue(db, days(dayStart, 2), days(dayEnd, 2), 50);
  await repo.submitReview(db, { cardId: q.items[0].cardId, rating: Rating.Hard, hintUsed: true, answer: 'たすける', correct: true, durationMs: 4200 }, later);
  await repo.setFurigana(db, { kanjiLevel: 'n5', knownKanji: '誰', learningKanji: '' }, now);
  const withKanji = page.words.find((w) => w.kanji)!;
  await repo.recordFuriganaHint(db, withKanji.id, withKanji.kanji!.replace(/[^\p{Script=Han}]/gu, ''), later);
  // Quotes, semicolons and line breaks must survive the trip through SQL.
  await repo.updateCoreMeaning(db, batch[0].id, "it's; a test\n-- not a comment", now);
  return batch[0].id;
}

async function tableNames(d: D1Database) {
  const r = await d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all<{ name: string }>();
  return r.results.map((t) => t.name).sort();
}

describe('backup file', () => {
  it('covers every table in the schema', async () => {
    expect([...BACKUP_TABLES].sort()).toEqual(await tableNames(db));
  });

  it('names the latest migration as its schema', () => {
    const latest = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort().at(-1);
    expect(`${BACKUP_SCHEMA}.sql`).toBe(latest);
  });

  it('holds every row, and loads back into an empty database unchanged', async () => {
    const edited = await studySomething();
    const backup = await repo.exportAll(db, now);
    expect(backup).toMatchObject({ app: 'shiori', format: 1, schema: BACKUP_SCHEMA, exportedAt: now.toISOString() });
    for (const t of BACKUP_TABLES) {
      expect(backup.tables[t].length, t).toBeGreaterThan(0);
      const { n } = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!;
      expect(backup.tables[t].length, t).toBe(n);
    }

    const restored = createTestDb();
    await restored.exec(backupToSql(parseBackup(JSON.stringify(backup))));
    expect((await repo.exportAll(restored, now)).tables).toEqual(backup.tables);
    // The restored copy works as a study database, not just a pile of rows.
    expect(await repo.stats(restored, days(dayStart, 2), days(dayEnd, 2))).toEqual(await repo.stats(db, days(dayStart, 2), days(dayEnd, 2)));
    expect((await repo.getWord(restored, edited)).coreMeaning).toBe("it's; a test\n-- not a comment");
  });

  it('with replace, loads over a database that already has rows', async () => {
    await studySomething();
    const backup = await repo.exportAll(db, now);
    const other = createTestDb();
    await repo.importWords(other, words.slice(0, 5), MANGA + 2, now);
    await expect(other.exec(backupToSql(backup))).rejects.toThrow();
    await other.exec(backupToSql(backup, { replace: true }));
    expect((await repo.exportAll(other, now)).tables).toEqual(backup.tables);
  });

  it('loads a backup from before a table existed, with that table empty', async () => {
    await studySomething();
    const backup = await repo.exportAll(db, now);
    const old = structuredClone(backup) as unknown as Record<string, unknown> & Backup;
    old.schema = '0001_init';
    for (const t of BACKUP_TABLES) if (TABLE_SINCE[t] > '0001_init') delete (old.tables as Partial<Backup['tables']>)[t];
    const parsed = parseBackup(JSON.stringify(old));
    expect(parsed.tables.settings).toEqual([]);
    expect(parsed.tables.kanji_hints).toEqual([]);
    const restored = createTestDb();
    await restored.exec(backupToSql(parsed));
    expect((await repo.exportAll(restored, now)).tables.words).toEqual(backup.tables.words);
    // A current backup without a table is broken, not old.
    delete (backup.tables as Partial<Backup['tables']>).settings;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('missing table settings');
  });

  it('puts words and pages from a backup made before lists on their lists', async () => {
    await studySomething();
    await repo.importWords(db, words.slice(-3), MANGA + 2, now);
    const backup = await repo.exportAll(db, now);
    const old = structuredClone(backup);
    old.schema = '0002_furigana';
    delete (old.tables as Partial<Backup['tables']>).lists;
    for (const row of [...old.tables.words, ...old.tables.pages]) delete row.list_id;
    // An import label that isn't one of the starting lists becomes a list of its own.
    old.tables.words.at(-1)!.source_list = 'Yotsuba';
    for (const replace of [false, true]) {
      const restored = createTestDb();
      if (replace) await repo.importWords(restored, words.slice(0, 5), MANGA + 1, now);
      await restored.exec(backupToSql(parseBackup(JSON.stringify(old)), { replace }));
      const tables = (await repo.exportAll(restored, now)).tables;
      expect(tables.lists.map((l) => l.name)).toEqual(['Manga', 'Books', 'School', 'Other', 'Yotsuba']);
      expect(tables.words.slice(0, -1).map((w) => w.list_id)).toEqual(backup.tables.words.slice(0, -1).map((w) => w.list_id));
      expect(tables.words.at(-1)!.list_id).toBe(5);
      expect(tables.pages.map((p) => p.list_id)).toEqual(backup.tables.pages.map((p) => p.list_id));
    }
  });

  it('upgrades old backups with the same SQL as the lists migration', () => {
    const migration = readFileSync(join(root, 'migrations', '0003_lists.sql'), 'utf8');
    expect(migration.trimEnd().endsWith(LISTS_FROM_LABELS)).toBe(true);
  });

  it('knows which migration added each table', () => {
    const migrations = readdirSync(join(root, 'migrations')).map((f) => f.replace(/\.sql$/, ''));
    for (const t of BACKUP_TABLES) expect(migrations, t).toContain(TABLE_SINCE[t]);
  });

  it('refuses files that are not a Shiori backup', async () => {
    const good = await repo.exportAll(db, now);
    const bad = (change: (b: Backup) => unknown) => {
      const b = structuredClone(good) as unknown as Backup;
      change(b);
      return () => parseBackup(JSON.stringify(b));
    };
    expect(() => parseBackup('{oops')).toThrow('not a JSON file');
    expect(bad((b) => ((b as { app: string }).app = 'anki'))).toThrow('not a Shiori backup');
    expect(bad((b) => ((b as { format: number }).format = 2))).toThrow('unsupported backup format 2');
    expect(bad((b) => delete (b.tables as Partial<Backup['tables']>).cards)).toThrow('missing table cards');
    expect(bad((b) => ((b.tables as Record<string, unknown>).users = []))).toThrow('unknown table users');
    expect(bad((b) => b.tables.words.push({ 'id); DROP TABLE words; --': 1 }))).toThrow('bad column name');
    expect(bad((b) => b.tables.words.push({ senses: ['a'] as unknown as string }))).toThrow('bad value in words.senses');
  });
});

describe('backup helpers', () => {
  it('reads the date back from a backup file name only', () => {
    expect(dateOfBackupFile('shiori-backup-2026-10-25.json')).toBe('2026-10-25');
    expect(dateOfBackupFile('notes.txt')).toBeNull();
    expect(dateOfBackupFile('old-shiori-backup-2026-10-25.json')).toBeNull();
  });

  it('calls a nightly copy stale after a day and a half', () => {
    const saved = '2026-10-25T03:30:00Z';
    expect(nightlyIsStale(saved, new Date('2026-10-26T15:00:00Z'))).toBe(false);
    expect(nightlyIsStale(saved, new Date('2026-10-26T16:00:00Z'))).toBe(true);
  });

  it('checks the backup schema against the migrations', () => {
    const files = ['0002_furigana.sql', '0001_init.sql', 'README.md'];
    expect(schemaCheck('0002_furigana', files)).toEqual({});
    expect(schemaCheck('0001_init', files).note).toContain('tables and columns added since then start empty or with their defaults');
    expect(schemaCheck('0003_later', files).error).toContain("which this code doesn't have");
  });
});

describe('restore script', () => {
  const script = (...args: string[]) =>
    spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'scripts', 'backup-to-sql.ts'), ...args], { encoding: 'utf8' });

  it('prints the same SQL as the app builds', async () => {
    await studySomething();
    const backup = await repo.exportAll(db, now);
    const dir = tempDir();
    writeFileSync(join(dir, 'b.json'), JSON.stringify(backup));
    const r = script(join(dir, 'b.json'));
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(backupToSql(backup));
    expect(script(join(dir, 'b.json'), '--replace').stdout).toBe(backupToSql(backup, { replace: true }));
  });

  it('refuses a backup from newer code, and notes an older one', async () => {
    const dir = tempDir();
    const backup = await repo.exportAll(db, now);
    writeFileSync(join(dir, 'new.json'), JSON.stringify({ ...backup, schema: '9999_future' }));
    expect(script(join(dir, 'new.json'))).toMatchObject({ status: 1, stdout: '' });
    writeFileSync(join(dir, 'old.json'), JSON.stringify({ ...backup, schema: '0001_init' }));
    const old = script(join(dir, 'old.json'));
    expect(old.status).toBe(0);
    expect(old.stderr).toContain('note: the backup is from migration 0001_init');
  });

  it('says what is wrong with a bad file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'b.json'), '{"app":"anki"}');
    const r = script(join(dir, 'b.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a Shiori backup');
    expect(() => execFileSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts', 'backup-to-sql.ts')], { stdio: 'pipe' })).toThrow();
  });
});

/** Just enough of R2 for the nightly backup: put, paged list, delete. */
class FakeBucket {
  objects = new Map<string, { body: string; uploaded: Date }>();
  clock = now;

  async put(key: string, body: string) {
    this.objects.set(key, { body, uploaded: this.clock });
  }
  async list({ prefix = '', cursor }: { prefix?: string; cursor?: string }) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + 2);
    const truncated = start + 2 < keys.length;
    const objects = page.map((key) => ({ key, uploaded: this.objects.get(key)!.uploaded, size: this.objects.get(key)!.body.length }));
    return { objects, truncated, cursor: truncated ? String(start + 2) : undefined };
  }
  async delete(keys: string | string[]) {
    for (const k of [keys].flat()) this.objects.delete(k);
  }
}

describe('nightly backup', () => {
  it('saves one file a day and keeps the last 30 days', async () => {
    await studySomething();
    const bucket = new FakeBucket();
    const r2 = bucket as unknown as R2Bucket;
    expect(await nightlyStatus(r2)).toEqual({ latest: null, count: 0 });

    for (let i = 0; i <= KEEP_DAYS + 4; i++) {
      bucket.clock = days(now, i);
      await saveNightly(db, r2, days(now, i));
    }
    const last = days(now, KEEP_DAYS + 4);
    // A second run on the same day replaces that day's file.
    await saveNightly(db, r2, last);

    const keys = [...bucket.objects.keys()].sort();
    expect(keys).toHaveLength(KEEP_DAYS);
    expect(keys[0]).toBe(`nightly/shiori-backup-${days(last, 1 - KEEP_DAYS).toISOString().slice(0, 10)}.json`);
    expect(keys.at(-1)).toBe('nightly/shiori-backup-2026-11-28.json');

    const saved = parseBackup(bucket.objects.get(keys.at(-1)!)!.body);
    expect(saved.tables).toEqual((await repo.exportAll(db, last)).tables);

    const status = await nightlyStatus(r2);
    expect(status.count).toBe(KEEP_DAYS);
    expect(status.latest).toMatchObject({ date: '2026-11-28', savedAt: last.toISOString() });
    expect(status.latest!.size).toBeGreaterThan(1000);
  });

  it('leaves other files in the bucket alone', async () => {
    const bucket = new FakeBucket();
    await bucket.put('nightly/notes.txt', 'keep me');
    await bucket.put('manual/shiori-backup-2020-01-01.json', '{}');
    await saveNightly(db, bucket as unknown as R2Bucket, now);
    expect([...bucket.objects.keys()].sort()).toEqual(['manual/shiori-backup-2020-01-01.json', 'nightly/notes.txt', 'nightly/shiori-backup-2026-10-25.json']);
  });
});
