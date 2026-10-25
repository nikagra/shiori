import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    const r = this.db.prepare(this.sql).run(...this.params);
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
