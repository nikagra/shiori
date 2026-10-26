// Turns a Shiori backup file into SQL for a database with the migrations applied:
//   npm run backup:sql -- shiori-backup-2026-10-25.json > restore.sql
// --replace deletes the rows already there first.
// See "Backup and restore" in docs/DESIGN.md for the whole restore.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BackupError, backupToSql, parseBackup, schemaCheck } from '../shared/backup.ts';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const [file, ...rest] = args.filter((a) => a !== '--replace');
if (!file || rest.length || file.startsWith('-')) {
  console.error('usage: npm run backup:sql -- <backup.json> [--replace] > restore.sql');
  process.exit(2);
}
try {
  const backup = parseBackup(readFileSync(file, 'utf8'));
  const { error, note } = schemaCheck(backup.schema, readdirSync(join(import.meta.dirname, '..', 'migrations')));
  if (error) throw new BackupError(error);
  if (note) console.error(`note: ${note}`);
  process.stdout.write(backupToSql(backup, { replace }));
} catch (e) {
  if (!(e instanceof BackupError)) throw e;
  console.error(`${file}: ${e.message}`);
  process.exit(1);
}
