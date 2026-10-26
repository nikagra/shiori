import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

export const FIXTURE = join(import.meta.dirname, '..', 'test', 'fixtures', 'renshuu_custom_sample.txt');

/** A list's id by its name. */
export async function listId(request: APIRequestContext, name: string): Promise<number> {
  const lists = (await (await request.get(`/api/lists?dayStart=${new Date().toISOString()}&dayEnd=${new Date().toISOString()}`)).json()) as { id: number; name: string }[];
  return lists.find((l) => l.name === name)!.id;
}

export async function resetDb(request: APIRequestContext) {
  const r = await request.post('/api/test/reset');
  expect(r.ok()).toBeTruthy();
}

export function studyDay() {
  const start = new Date();
  start.setHours(4, 0, 0, 0);
  if (new Date() < start) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Imports the fixture and sorts the first words through the API, to set up a state quickly. */
export async function seedWords(request: APIRequestContext, opts: { unknown: number; known?: number }) {
  const text = readFileSync(FIXTURE, 'utf8');
  expect((await request.post('/api/import', { data: { text, list: 'manga' } })).ok()).toBeTruthy();
  const triage = await (await request.get('/api/triage')).json();
  const words = triage.words as { id: number }[];
  const known = opts.known ?? 0;
  for (const w of words.slice(0, known)) await request.post(`/api/triage/${w.id}`, { data: { result: 'known' } });
  for (const w of words.slice(known, known + opts.unknown)) await request.post(`/api/triage/${w.id}`, { data: { result: 'unknown' } });
}

export interface PageWord {
  id: number;
  kana: string;
  kanji: string | null;
  coreMeaning: string;
  position: number;
}

export async function graduatePage(request: APIRequestContext, size: number) {
  const page = await (await request.post('/api/pages', { data: { size } })).json();
  const nextDayStart = studyDay().end.toISOString();
  await request.post(`/api/pages/${page.id}/complete`, { data: { stage: 'ordered', nextDayStart } });
  await request.post(`/api/pages/${page.id}/complete`, { data: { stage: 'shuffled', nextDayStart } });
  return page as { id: number; words: PageWord[] };
}

/** Fails if the page scrolls sideways: everything must fit a phone screen. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  await page.screenshot({ path: join('test-results', 'screens', testInfo.project.name, `${name}.png`), fullPage: true });
}
