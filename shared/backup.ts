// The backup file: every table, row for row, as JSON. The download button and
// the nightly copy write it; scripts/backup-to-sql.ts turns it back into SQL to
// load into a fresh database. No imports, so Node can run that script directly.

/** Tables in an order that satisfies the foreign keys when loading. */
export const BACKUP_TABLES = ['words', 'pages', 'page_words', 'cards', 'review_log', 'settings', 'kanji_hints'] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** The migration that added each table: a backup from before it has no rows for it. */
export const TABLE_SINCE: Record<BackupTable, string> = {
  words: '0001_init',
  pages: '0001_init',
  page_words: '0001_init',
  cards: '0001_init',
  review_log: '0001_init',
  settings: '0002_furigana',
  kanji_hints: '0002_furigana',
};

/** The latest migration the backup's rows fit. A test keeps it in step with migrations/. */
export const BACKUP_SCHEMA = '0002_furigana';
export const BACKUP_FORMAT = 1;

/** How long the nightly copies are kept (worker/backup.ts). */
export const KEEP_DAYS = 30;

export type BackupValue = string | number | null;
export type BackupRow = Record<string, BackupValue>;

export interface Backup {
  app: 'shiori';
  format: typeof BACKUP_FORMAT;
  schema: string;
  exportedAt: string;
  tables: Record<BackupTable, BackupRow[]>;
}

/** "2026-10-25" from an ISO time, for file names. */
export const backupDate = (exportedAt: string) => exportedAt.slice(0, 10);

export const backupFileName = (exportedAt: string) => `shiori-backup-${backupDate(exportedAt)}.json`;

/** The date in a name made by backupFileName, or null for any other name. */
export const dateOfBackupFile = (name: string) => /^shiori-backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1] ?? null;

export interface NightlyStatus {
  latest: { date: string; savedAt: string; size: number } | null;
  count: number;
}

/** A copy is saved every night, so one older than a day and a half means runs are failing. */
export const nightlyIsStale = (savedAt: string, now: Date) => now.getTime() - new Date(savedAt).getTime() > 36 * 3_600_000;

/**
 * Whether a backup fits a checkout with these migration files: an error if the
 * backup comes from a migration this code doesn't have, a note if it is older.
 */
export function schemaCheck(schema: string, migrationFiles: string[]): { error?: string; note?: string } {
  const names = migrationFiles.filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort();
  if (!names.includes(schema)) return { error: `the backup is from migration ${schema}, which this code doesn't have; update the code first` };
  if (schema !== names.at(-1)) return { note: `the backup is from migration ${schema}; tables and columns added since then start empty or with their defaults` };
  return {};
}

export class BackupError extends Error {}

const COLUMN = /^[a-z_]+$/;

/** Checks a parsed backup file before anything is built from it. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('not a JSON file');
  }
  const b = data as Partial<Backup> | null;
  if (!b || b.app !== 'shiori') throw new BackupError('not a Shiori backup');
  if (b.format !== BACKUP_FORMAT) throw new BackupError(`unsupported backup format ${String(b.format)}`);
  if (typeof b.schema !== 'string' || typeof b.exportedAt !== 'string') throw new BackupError('missing schema or exportedAt');
  if (!b.tables || typeof b.tables !== 'object') throw new BackupError('missing tables');
  for (const name of Object.keys(b.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(name)) throw new BackupError(`unknown table ${name}`);
  }
  for (const table of BACKUP_TABLES) {
    // Migration names sort in order, so an older backup simply lacks the newer tables.
    if (b.tables[table] === undefined && b.schema < TABLE_SINCE[table]) b.tables[table] = [];
    const rows = b.tables[table];
    if (!Array.isArray(rows)) throw new BackupError(`missing table ${table}`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new BackupError(`bad row in ${table}`);
      for (const [col, value] of Object.entries(row)) {
        if (!COLUMN.test(col)) throw new BackupError(`bad column name in ${table}: ${col}`);
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new BackupError(`bad value in ${table}.${col}`);
        if (typeof value === 'number' && !Number.isFinite(value)) throw new BackupError(`bad number in ${table}.${col}`);
      }
    }
  }
  return b as Backup;
}

function literal(value: BackupValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * One INSERT per row, parents before children, for `wrangler d1 execute --file`
 * on a database that has the migrations applied. With `replace`, it first
 * deletes every row, children before parents, so it can load over old data.
 */
export function backupToSql(backup: Backup, { replace = false } = {}): string {
  const lines = [`-- Shiori backup from ${backup.exportedAt}, schema ${backup.schema}`];
  if (replace) for (const table of [...BACKUP_TABLES].reverse()) lines.push(`DELETE FROM ${table};`);
  for (const table of BACKUP_TABLES) {
    for (const row of backup.tables[table]) {
      const cols = Object.keys(row);
      lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')});`);
    }
  }
  return lines.join('\n') + '\n';
}
