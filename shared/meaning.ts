// Turning full dictionary definitions into something recallable.
//
// Renshuu exports every JMdict sense (取る has over 20 glosses). Nobody can
// recall all of them, so a card asks for a short "core meaning": the first
// sense, without tags like {adj-no}, cut to a few glosses.

const TAG = /\{[^}]*\}\s*/g;

export function stripTags(s: string): string {
  return s.replace(TAG, '').replace(/\s+/g, ' ').trim();
}

/** Splits a sense on top-level commas, keeping "(e.g. a, b)" together. */
export function splitGlosses(sense: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of sense) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter((g) => g.length > 0);
}

export function coreMeaning(senses: string[], maxGlosses = 3): string {
  for (const sense of senses) {
    const glosses = splitGlosses(stripTags(sense));
    if (glosses.length > 0) return glosses.slice(0, maxGlosses).join(', ');
  }
  return '';
}
