import { backupDate, backupFileName, dateOfBackupFile, KEEP_DAYS, type NightlyStatus } from '../shared/backup';
import { exportAll } from './db';

// Nightly copies of the whole database, kept in a private R2 bucket. One file
// per day: a second run on the same day replaces that day's file.

export const NIGHTLY_PREFIX = 'nightly/';

const dateOfKey = (key: string) => (key.startsWith(NIGHTLY_PREFIX) ? dateOfBackupFile(key.slice(NIGHTLY_PREFIX.length)) : null);

async function listNightly(bucket: R2Bucket): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: NIGHTLY_PREFIX, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Saves today's copy, then keeps only the last KEEP_DAYS days' copies. Returns the new key. */
export async function saveNightly(db: D1Database, bucket: R2Bucket, now: Date): Promise<string> {
  const backup = await exportAll(db, now);
  const key = NIGHTLY_PREFIX + backupFileName(backup.exportedAt);
  await bucket.put(key, JSON.stringify(backup), { httpMetadata: { contentType: 'application/json' } });

  const oldest = backupDate(new Date(now.getTime() - (KEEP_DAYS - 1) * 86_400_000).toISOString());
  const stale = (await listNightly(bucket)).map((o) => o.key).filter((k) => {
    const date = dateOfKey(k);
    return date !== null && date < oldest;
  });
  if (stale.length) await bucket.delete(stale);
  return key;
}

export async function nightlyStatus(bucket: R2Bucket): Promise<NightlyStatus> {
  const objects = (await listNightly(bucket)).filter((o) => dateOfKey(o.key));
  const latest = objects.reduce<R2Object | null>((a, o) => (!a || o.key > a.key ? o : a), null);
  return {
    latest: latest && { date: dateOfKey(latest.key)!, savedAt: latest.uploaded.toISOString(), size: latest.size },
    count: objects.length,
  };
}

/** Test support: removes every nightly copy. */
export async function clearNightly(bucket: R2Bucket): Promise<void> {
  const keys = (await listNightly(bucket)).map((o) => o.key);
  if (keys.length) await bucket.delete(keys);
}
