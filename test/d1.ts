import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkSql, toChunks, type DictEntry } from '../shared/dictEntry';

// A small in-memory stand-in for Cloudflare D1, backed by node:sqlite, so the
// database layer can be tested in plain Vitest. It covers only what Shiori
// uses: prepare/bind/first/all/run and batch.

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : (p as SQLInputValue))));
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    // D1 returns rows in a batch too, from any statement that has them.
    const stmt = this.db.prepare(this.sql);
    if (stmt.columns().length > 0) {
      const results = stmt.all(...this.params);
      // INSERT … RETURNING changes rows as well as returning them.
      const changes = /\bRETURNING\b/i.test(this.sql) ? Number((this.db.prepare('SELECT changes() AS c').get() as { c: number }).c) : 0;
      return { success: true, results, meta: { changes, last_row_id: 0 } };
    }
    const r = stmt.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

class FakeD1 {
  constructor(private db: DatabaseSync) {}

  prepare(sql: string) {
    return new Statement(this.db, sql);
  }

  async batch(statements: Statement[]) {
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => s.runSync());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string) {
    this.db.exec(sql);
  }
}

export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return new FakeD1(db) as unknown as D1Database;
}

/**
 * The dictionary database, with the sample entries in test/fixtures/dict_sample.json
 * loaded as the loader would: the first `loaded` chunks (all by default).
 */
export function createDictDb(chunkSize = 1000, loaded = Infinity): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(import.meta.dirname, '..', 'dict-migrations', '0001_dictionary.sql'), 'utf8'));
  const sample = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'dict_sample.json'), 'utf8')) as { version: string; entries: DictEntry[] };
  const chunks = toChunks(sample.entries, chunkSize);
  for (const chunk of chunks.slice(0, loaded)) db.exec(chunkSql(chunk, sample.version, chunks.length));
  return new FakeD1(db) as unknown as D1Database;
}
