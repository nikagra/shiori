// Words close in meaning on one page: two of them meaning "rescue" compete
// for the same spot in memory, so the page builder points them out and you can
// swap one for another word. Pure, so it's unit tested.

/** Words that say little about the meaning on their own. */
const FILLER = new Set(
  'to be a an the of in on at by for with from up out off into as and or not no one some something someone somebody thing things do does make get have has is it its very more most much many lot kind sort way type usually especially also than that this which who what used use (e.g. etc'.split(
    ' ',
  ),
);

/** The meaning words of a core meaning: "to save, to rescue" → save, rescue. */
export function meaningWords(meaning: string): Set<string> {
  const words = meaning
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !FILLER.has(w));
  return new Set(words);
}

export interface Similar<T> {
  a: T;
  b: T;
  /** The meaning words both share, e.g. ["rescue"]. */
  shared: string[];
}

/** Every pair of words whose core meanings share a meaning word, in page order. */
export function similarPairs<T extends { coreMeaning: string }>(words: readonly T[]): Similar<T>[] {
  const sets = words.map((w) => meaningWords(w.coreMeaning));
  const pairs: Similar<T>[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const shared = [...sets[i]].filter((w) => sets[j].has(w));
      if (shared.length > 0) pairs.push({ a: words[i], b: words[j], shared });
    }
  }
  return pairs;
}
