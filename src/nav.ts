export function navigate(path: string) {
  window.location.hash = path;
}

/** The address after "#/": its path parts and its ?query (#/dict?q=食べた). */
export function readHash(hash = window.location.hash): { parts: string[]; params: URLSearchParams } {
  const raw = hash.replace(/^#\/?/, '');
  const at = raw.indexOf('?');
  const [path, query] = at < 0 ? [raw, ''] : [raw.slice(0, at), raw.slice(at + 1)];
  return { parts: path.split('/').filter(Boolean).map(decode), params: new URLSearchParams(query) };
}

/** A path part as written, or as it is when it isn't a valid %-escape (a mistyped link shows "not found" instead of breaking the app). */
function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** A positive whole number from the address, or null. */
export function idParam(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
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
export const listParam = (params: URLSearchParams) => idParam(params.get('list'));

/** A list with one of its words open (`?word=` is the word's id). */
export const wordHref = (listId: number, wordId: number) => hashFor(`lists/${listId}`, { word: wordId });

/** Changes the address without a new history step or a hashchange (the search box, as you type). */
export function replaceHash(hash: string) {
  if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
}
