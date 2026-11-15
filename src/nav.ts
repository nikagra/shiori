export function navigate(path: string) {
  window.location.hash = path;
}

/** The address after "#/": its path parts and its ?query (#/dict?q=食べた). */
export function readHash(hash = window.location.hash): { parts: string[]; params: URLSearchParams } {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(query) };
}

/** "#/path?a=1", leaving out empty values. */
export function hashFor(path: string, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const query = q.toString();
  return `#/${path}${query ? `?${query}` : ''}`;
}

/** Where the dictionary was opened from: what you searched for, and the list to add words to. */
export interface DictContext {
  q?: string;
  list?: number | null;
}

/** The dictionary's search, with your query in the address so Back returns to it. */
export const dictHref = (ctx: DictContext = {}) => hashFor('dict', { q: ctx.q, list: ctx.list });

/** A dictionary entry's page. */
export const entryHref = (seq: number, ctx: DictContext = {}) => hashFor(`dict/${seq}`, { q: ctx.q, list: ctx.list });

/** The list number in `?list=`, when it's one. */
export function listParam(params: URLSearchParams): number | null {
  const n = Number(params.get('list'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Changes the address without a new history step or a hashchange (the search box, as you type). */
export function replaceHash(hash: string) {
  if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
}
