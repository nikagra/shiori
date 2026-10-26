import { Hono } from 'hono';
import { backupFileName } from '../shared/backup';
import { parseRenshuuExport } from '../shared/renshuu';
import { Rating, type Grade } from '../shared/scheduler';
import { clearNightly, nightlyStatus, saveNightly } from './backup';
import * as db from './db';

export interface Env {
  DB: D1Database;
  /** Private bucket for the nightly copies (worker/backup.ts). */
  BACKUPS: R2Bucket;
  /** Set to "1" only by the end-to-end test server (vite.config.ts); enables reset and time-travel endpoints. */
  ALLOW_TEST_ENDPOINTS?: string;
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof db.AppError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

function dateParam(value: string | undefined, name: string): Date {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new db.AppError(400, `${name} must be an ISO date`);
  return d;
}

function intParam(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new db.AppError(400, `${name} must be an integer`);
  return n;
}

app.get('/stats', async (c) => {
  const start = dateParam(c.req.query('dayStart'), 'dayStart');
  const end = dateParam(c.req.query('dayEnd'), 'dayEnd');
  return c.json(await db.stats(c.env.DB, start, end));
});

app.post('/import', async (c) => {
  const body = await c.req.json<{ text?: string; list?: string }>();
  if (!body.text?.trim()) throw new db.AppError(400, 'the file is empty');
  const parsed = parseRenshuuExport(body.text);
  const list = body.list?.trim() || null;
  const summary = await db.importWords(c.env.DB, parsed.words, list, new Date());
  return c.json({ format: parsed.format, ...summary, issues: parsed.issues });
});

app.get('/triage', async (c) => {
  return c.json(await db.triageNext(c.env.DB, 20));
});

app.post('/triage/:id', async (c) => {
  const { result } = await c.req.json<{ result: db.TriageResult }>();
  if (!['known', 'unknown', 'ignore'].includes(result)) throw new db.AppError(400, 'result must be known, unknown or ignore');
  await db.triageAnswer(c.env.DB, intParam(c.req.param('id'), 'id'), result, new Date());
  return c.json({ ok: true });
});

app.patch('/words/:id', async (c) => {
  const { coreMeaning } = await c.req.json<{ coreMeaning: string }>();
  return c.json(await db.updateCoreMeaning(c.env.DB, intParam(c.req.param('id'), 'id'), coreMeaning ?? '', new Date()));
});

app.get('/pages', async (c) => c.json(await db.listPages(c.env.DB)));

app.post('/pages', async (c) => {
  const { size } = await c.req.json<{ size: number }>();
  return c.json(await db.createPage(c.env.DB, intParam(size, 'size'), new Date()), 201);
});

app.get('/pages/:id', async (c) => c.json(await db.getPage(c.env.DB, intParam(c.req.param('id'), 'id'))));

app.post('/pages/:id/complete', async (c) => {
  const body = await c.req.json<{ stage: 'ordered' | 'shuffled'; nextDayStart: string }>();
  if (body.stage !== 'ordered' && body.stage !== 'shuffled') throw new db.AppError(400, 'stage must be ordered or shuffled');
  const nextDay = dateParam(body.nextDayStart, 'nextDayStart');
  return c.json(await db.completeStage(c.env.DB, intParam(c.req.param('id'), 'id'), body.stage, nextDay, new Date()));
});

app.get('/review', async (c) => {
  const start = dateParam(c.req.query('dayStart'), 'dayStart');
  const end = dateParam(c.req.query('dayEnd'), 'dayEnd');
  return c.json(await db.reviewQueue(c.env.DB, start, end, 50));
});

app.post('/review/:cardId', async (c) => {
  const body = await c.req.json<{ rating: number; hintUsed?: boolean; answer?: string; correct?: boolean; durationMs?: number }>();
  const grades: number[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
  if (!grades.includes(body.rating)) throw new db.AppError(400, 'rating must be 1–4');
  const result = await db.submitReview(
    c.env.DB,
    {
      cardId: intParam(c.req.param('cardId'), 'cardId'),
      rating: body.rating as Grade,
      hintUsed: Boolean(body.hintUsed),
      answer: body.answer ?? null,
      correct: body.correct ?? null,
      durationMs: typeof body.durationMs === 'number' ? Math.round(body.durationMs) : null,
    },
    new Date(),
  );
  return c.json(result);
});

app.get('/furigana', async (c) => c.json(await db.getFurigana(c.env.DB)));

app.put('/furigana', async (c) => c.json(await db.setFurigana(c.env.DB, await c.req.json(), new Date())));

app.post('/furigana/hint', async (c) => {
  const body = await c.req.json<{ wordId: number; kanji: string }>();
  return c.json(await db.recordFuriganaHint(c.env.DB, intParam(body.wordId, 'wordId'), String(body.kanji ?? ''), new Date()));
});

app.get('/backup', async (c) => {
  const backup = await db.exportAll(c.env.DB, new Date());
  c.header('Content-Disposition', `attachment; filename="${backupFileName(backup.exportedAt)}"`);
  c.header('Cache-Control', 'no-store');
  return c.json(backup);
});

app.get('/backup/nightly', async (c) => c.json(await nightlyStatus(c.env.BACKUPS)));

// Test-only endpoints, never enabled in production.
app.use('/test/*', async (c, next) => {
  if (c.env.ALLOW_TEST_ENDPOINTS !== '1') return c.json({ error: 'not found' }, 404);
  await next();
});
app.post('/test/reset', async (c) => {
  await db.resetAll(c.env.DB);
  await clearNightly(c.env.BACKUPS);
  return c.json({ ok: true });
});
app.post('/test/nightly', async (c) => c.json({ key: await saveNightly(c.env.DB, c.env.BACKUPS, new Date()) }));
app.post('/test/make-due', async (c) => {
  const direction = c.req.query('direction');
  if (direction !== undefined && direction !== 'jp_en' && direction !== 'en_jp') throw new db.AppError(400, 'direction must be jp_en or en_jp');
  await db.makeAllDue(c.env.DB, new Date(), direction);
  return c.json({ ok: true });
});

app.all('*', (c) => c.json({ error: 'not found' }, 404));

export default {
  fetch: app.fetch,
  // The cron in wrangler.jsonc: one copy of the database a night.
  async scheduled(controller, env) {
    await saveNightly(env.DB, env.BACKUPS, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
