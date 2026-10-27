import { Hono } from 'hono';
import { backupFileName } from '../shared/backup';
import { parseRenshuuExport } from '../shared/renshuu';
import { Rating, type Grade } from '../shared/scheduler';
import { clearNightly, nightlyStatus, saveNightly } from './backup';
import * as db from './db';
import { dictStatus, entryBySeq, lookUpWords, searchDict } from './dict';

export interface Env {
  DB: D1Database;
  /** The dictionary (JMdict), its own database: worker/dict.ts. */
  DICT: D1Database;
  /** Private bucket for the nightly copies (worker/backup.ts). */
  BACKUPS: R2Bucket;
  /** Set to "1" only by the end-to-end test server (vite.config.ts); enables the /test endpoints (reset, time travel, a nightly backup run). */
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
  // `list` imports by list name: what the app sent before lists had ids, and
  // what the end-to-end helpers use. An unknown name is refused.
  const body = await c.req.json<{ text?: string; listId?: number; list?: string }>();
  if (!body.text?.trim()) throw new db.AppError(400, 'the file is empty');
  const listId = body.listId !== undefined ? intParam(body.listId, 'listId') : body.list?.trim() ? await db.listIdByName(c.env.DB, body.list) : null;
  if (listId === null) throw new db.AppError(400, 'pick a list for the words');
  const parsed = parseRenshuuExport(body.text);
  const summary = await db.importWords(c.env.DB, parsed.words, listId, new Date());
  return c.json({ format: parsed.format, ...summary, issues: parsed.issues });
});

app.get('/triage', async (c) => {
  const list = c.req.query('list');
  return c.json(await db.triageNext(c.env.DB, 20, { listId: list ? intParam(list, 'list') : null, now: new Date() }));
});

app.post('/triage/:id', async (c) => {
  const { result } = await c.req.json<{ result: db.TriageResult }>();
  if (!['known', 'unknown', 'ignore'].includes(result)) throw new db.AppError(400, 'result must be known, unknown or ignore');
  await db.triageAnswer(c.env.DB, intParam(c.req.param('id'), 'id'), result, new Date());
  return c.json({ ok: true });
});

app.patch('/words/:id', async (c) => {
  const id = intParam(c.req.param('id'), 'id');
  const body = await c.req.json<db.WordChanges & { dictSeq?: unknown }>();
  const { dictSeq, ...changes } = body;
  let word = await db.updateWord(c.env.DB, id, changes, new Date());
  if (dictSeq !== undefined) {
    // The entry you picked for it, or null: none fits.
    const entry = dictSeq === null ? null : await entryBySeq(c.env.DICT, intParam(dictSeq, 'dictSeq'));
    if (dictSeq !== null && !entry) throw new db.AppError(404, 'dictionary entry not found');
    word = await db.linkEntry(c.env.DB, id, entry, new Date());
  } else if (word.dict === 'unchecked') {
    // A new spelling (or a word never looked up): look it up now.
    await lookUpWords(c.env.DB, c.env.DICT, id);
    word = await db.getListWord(c.env.DB, id);
  }
  return c.json(word);
});

app.post('/words/:id/set-aside', async (c) => c.json(await db.setAside(c.env.DB, intParam(c.req.param('id'), 'id'), new Date())));
app.post('/words/:id/bring-back', async (c) => c.json(await db.bringBack(c.env.DB, intParam(c.req.param('id'), 'id'), new Date())));
app.post('/words/:id/check-again', async (c) => c.json(await db.checkAgain(c.env.DB, intParam(c.req.param('id'), 'id'), new Date())));

app.delete('/words/:id', async (c) => {
  await db.deleteWord(c.env.DB, intParam(c.req.param('id'), 'id'));
  return c.json({ ok: true });
});

app.get('/pages', async (c) => c.json(await db.listPages(c.env.DB)));

app.post('/pages', async (c) => {
  const { size, listId, wordIds } = await c.req.json<{ size: number; listId?: number | null; wordIds?: unknown }>();
  const list = listId === undefined || listId === null ? null : intParam(listId, 'listId');
  if (wordIds !== undefined && !Array.isArray(wordIds)) throw new db.AppError(400, 'wordIds must be a list of word ids');
  const picked = wordIds?.map((id) => intParam(id, 'wordIds'));
  return c.json(await db.createPage(c.env.DB, intParam(size, 'size'), list, new Date(), picked), 201);
});

app.get('/pages/:id', async (c) => c.json(await db.getPage(c.env.DB, intParam(c.req.param('id'), 'id'))));

// Swap, take off or add one word of a page still in step 1.
app.post('/pages/:id/words', async (c) => {
  const body = await c.req.json<{ wordId?: unknown; replacement?: unknown; setAside?: unknown }>();
  const wordId = body.wordId === undefined || body.wordId === null ? null : intParam(body.wordId, 'wordId');
  const replacement = body.replacement === 'next' ? 'next' : body.replacement === undefined || body.replacement === null ? null : intParam(body.replacement, 'replacement');
  return c.json(await db.changePageWord(c.env.DB, intParam(c.req.param('id'), 'id'), { wordId, replacement, setAside: body.setAside === true }, new Date()));
});

app.delete('/pages/:id', async (c) => {
  await db.deletePage(c.env.DB, intParam(c.req.param('id'), 'id'), new Date());
  return c.json({ ok: true });
});

app.post('/pages/:id/complete', async (c) => {
  const body = await c.req.json<{ stage: 'ordered' | 'shuffled'; nextDayStart: string }>();
  if (body.stage !== 'ordered' && body.stage !== 'shuffled') throw new db.AppError(400, 'stage must be ordered or shuffled');
  const nextDay = dateParam(body.nextDayStart, 'nextDayStart');
  return c.json(await db.completeStage(c.env.DB, intParam(c.req.param('id'), 'id'), body.stage, nextDay, new Date()));
});

app.get('/review', async (c) => {
  const start = dateParam(c.req.query('dayStart'), 'dayStart');
  const end = dateParam(c.req.query('dayEnd'), 'dayEnd');
  return c.json(await db.reviewQueue(c.env.DB, start, end, 50, new Date()));
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

app.get('/lists', async (c) => {
  const start = dateParam(c.req.query('dayStart'), 'dayStart');
  const end = dateParam(c.req.query('dayEnd'), 'dayEnd');
  return c.json(await db.listLists(c.env.DB, start, end, new Date()));
});

app.post('/lists', async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  return c.json(await db.createList(c.env.DB, name, new Date()), 201);
});

app.patch('/lists/:id', async (c) => {
  await db.updateList(c.env.DB, intParam(c.req.param('id'), 'id'), await c.req.json<db.ListChanges>(), new Date());
  return c.json({ ok: true });
});

app.get('/lists/:id/words', async (c) => c.json(await db.listWords(c.env.DB, intParam(c.req.param('id'), 'id'))));

// A word from the dictionary.
app.post('/lists/:id/words', async (c) => {
  const body = await c.req.json<{ dictSeq?: unknown; kanji?: unknown; kana?: unknown; coreMeaning?: unknown }>();
  const entry = await entryBySeq(c.env.DICT, intParam(body.dictSeq, 'dictSeq'));
  if (!entry) throw new db.AppError(404, 'dictionary entry not found');
  const kanji = body.kanji === null || body.kanji === undefined ? null : String(body.kanji);
  const word = await db.addFromDict(c.env.DB, intParam(c.req.param('id'), 'id'), entry, { kanji, kana: String(body.kana ?? ''), coreMeaning: body.coreMeaning }, new Date());
  return c.json(word, 201);
});

app.post('/lists/:id/merge', async (c) => {
  const { into } = await c.req.json<{ into: number }>();
  await db.mergeList(c.env.DB, intParam(c.req.param('id'), 'id'), intParam(into, 'into'), new Date());
  return c.json({ ok: true });
});

app.delete('/lists/:id', async (c) => {
  await db.deleteList(c.env.DB, intParam(c.req.param('id'), 'id'));
  return c.json({ ok: true });
});

app.get('/dict/status', async (c) => c.json({ ...(await dictStatus(c.env.DICT)), words: await db.dictCounts(c.env.DB) }));

app.get('/dict/search', async (c) => {
  const entries = await searchDict(c.env.DICT, c.req.query('q') ?? '');
  return c.json({ entries, mine: await db.wordsForEntries(c.env.DB, entries.map((e) => e.seq)) });
});

app.get('/dict/entries/:seq', async (c) => {
  const entry = await entryBySeq(c.env.DICT, intParam(c.req.param('seq'), 'seq'));
  if (!entry) throw new db.AppError(404, 'dictionary entry not found');
  return c.json(entry);
});

// Looks up the next batch of words that have no entry yet; call until remaining is 0.
app.post('/dict/look-up', async (c) => c.json(await lookUpWords(c.env.DB, c.env.DICT)));

app.get('/study', async (c) => c.json(await db.getStudy(c.env.DB)));

app.put('/study', async (c) => c.json(await db.setStudy(c.env.DB, await c.req.json(), new Date())));

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
