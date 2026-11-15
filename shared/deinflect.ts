// Inflected forms read back to their dictionary form: 食べた is 食べる in the
// past, 構わない is 構う negative, 大きくなかった is 大きい negative past.
// It covers the forms an N5–N4 reader meets most (a rare irregular verb
// like 問う, 問うた, isn't read back). A rule only says what a form could
// be; the dictionary decides, since the base must be an entry of the right
// kind (食べた → 食べる is an ichidan verb, so it fits).
//
// Rules work from the end of the word, one ending at a time, as in
// Yomichan: 食べたくなかった → 食べたくない (past) → 食べたい (negative) →
// 食べる (want to).

/** The kinds of word a rule turns a form into. 'te' is a て form waiting for its verb (食べて from 食べている): never a dictionary word. */
export type WordKind = 'v1' | 'v5' | 'vs' | 'vk' | 'adj-i' | 'te';

interface Rule {
  /** The ending of the inflected form. */
  from: string;
  /** The ending of the form it comes from. */
  to: string;
  /** What the inflected form behaves as, so another rule can read it back further (食べない is like an い-adjective). Empty: nothing further. */
  actsAs: WordKind[];
  /** The kind of word it comes from. */
  kind: WordKind;
  reason: string;
}

const rule = (from: string, to: string, kind: WordKind, reason: string, actsAs: WordKind[] = []): Rule => ({ from, to, actsAs, kind, reason });

/** Endings that follow a verb's stem, the same for every kind of verb. */
const AFTER_STEM: [ending: string, reason: string, actsAs?: WordKind[]][] = [
  ['ます', 'polite'],
  ['ました', 'polite past'],
  ['ません', 'polite negative'],
  ['ませんでした', 'polite negative past'],
  ['ましょう', 'let’s'],
  ['たい', 'want to', ['adj-i']],
];

/** Godan verbs by their last kana: its a, i, e and o forms, and its て and た forms. */
const GODAN: [u: string, a: string, i: string, e: string, o: string, te: string, ta: string][] = [
  ['う', 'わ', 'い', 'え', 'お', 'って', 'った'],
  ['く', 'か', 'き', 'け', 'こ', 'いて', 'いた'],
  ['ぐ', 'が', 'ぎ', 'げ', 'ご', 'いで', 'いだ'],
  ['す', 'さ', 'し', 'せ', 'そ', 'して', 'した'],
  ['つ', 'た', 'ち', 'て', 'と', 'って', 'った'],
  ['ぬ', 'な', 'に', 'ね', 'の', 'んで', 'んだ'],
  ['ぶ', 'ば', 'び', 'べ', 'ぼ', 'んで', 'んだ'],
  ['む', 'ま', 'み', 'め', 'も', 'んで', 'んだ'],
  ['る', 'ら', 'り', 'れ', 'ろ', 'って', 'った'],
];

function godanRules(): Rule[] {
  const out: Rule[] = [];
  for (const [u, a, i, e, o, te, ta] of GODAN) {
    out.push(
      rule(`${a}ない`, u, 'v5', 'negative', ['adj-i']),
      rule(`${a}ず`, u, 'v5', 'negative'),
      rule(te, u, 'v5', 'te-form', ['te']),
      rule(ta, u, 'v5', 'past'),
      rule(`${ta}ら`, u, 'v5', 'conditional (たら)'),
      rule(`${e}ば`, u, 'v5', 'conditional (ば)'),
      rule(`${e}る`, u, 'v5', 'potential', ['v1']),
      rule(`${o}う`, u, 'v5', 'volitional'),
      rule(`${a}れる`, u, 'v5', 'passive', ['v1']),
      rule(`${a}せる`, u, 'v5', 'causative', ['v1']),
      ...AFTER_STEM.map(([end, reason, actsAs]) => rule(`${i}${end}`, u, 'v5', reason, actsAs)),
    );
  }
  // 行く has its own て and た: 行って, 行った.
  for (const go of ['行', 'い']) out.push(rule(`${go}って`, `${go}く`, 'v5', 'te-form', ['te']), rule(`${go}った`, `${go}く`, 'v5', 'past'), rule(`${go}ったら`, `${go}く`, 'v5', 'conditional (たら)'));
  // Polite verbs (下さる, いらっしゃる) take い before ます: くださいます.
  for (const [end, reason, actsAs] of AFTER_STEM.filter(([end]) => end.startsWith('ま'))) out.push(rule(`い${end}`, 'る', 'v5', reason, actsAs));
  return out;
}

/** Endings after an ichidan stem (食べ), which take the place of る. */
const ICHIDAN: [ending: string, reason: string, actsAs?: WordKind[]][] = [
  ['ない', 'negative', ['adj-i']],
  ['ず', 'negative'],
  ['て', 'te-form', ['te']],
  ['た', 'past'],
  ['たら', 'conditional (たら)'],
  ['れば', 'conditional (ば)'],
  ['られる', 'potential or passive', ['v1']],
  ['れる', 'potential', ['v1']],
  ['させる', 'causative', ['v1']],
  ['よう', 'volitional'],
  ...AFTER_STEM,
];

/** する's forms, whole (勉強した is 勉強する, which the dictionary files as 勉強). */
const SURU: [form: string, reason: string, actsAs?: WordKind[]][] = [
  ['しない', 'negative', ['adj-i']],
  ['せず', 'negative'],
  ['して', 'te-form', ['te']],
  ['した', 'past'],
  ['したら', 'conditional (たら)'],
  ['すれば', 'conditional (ば)'],
  ['できる', 'potential', ['v1']],
  ['される', 'passive', ['v1']],
  ['させる', 'causative', ['v1']],
  ['しよう', 'volitional'],
  ...AFTER_STEM.map(([end, reason, actsAs]): [string, string, WordKind[]?] => [`し${end}`, reason, actsAs]),
];

/** 来る's forms by the kana its stem takes (来ない is こない, 来た is きた), in kana and with 来. */
const KURU: [stem: 'こ' | 'き' | 'く', ending: string, reason: string, actsAs?: WordKind[]][] = [
  ['こ', 'ない', 'negative', ['adj-i']],
  ['こ', 'ず', 'negative'],
  ['き', 'て', 'te-form', ['te']],
  ['き', 'た', 'past'],
  ['き', 'たら', 'conditional (たら)'],
  ['く', 'れば', 'conditional (ば)'],
  ['こ', 'られる', 'potential or passive', ['v1']],
  ['こ', 'れる', 'potential', ['v1']],
  ['こ', 'させる', 'causative', ['v1']],
  ['こ', 'よう', 'volitional'],
  ...AFTER_STEM.map(([end, reason, actsAs]): ['き', string, string, WordKind[]?] => ['き', end, reason, actsAs]),
];

/** い-adjectives: 大きい. */
const ADJECTIVE: [ending: string, reason: string, actsAs?: WordKind[]][] = [
  ['くない', 'negative', ['adj-i']],
  ['かった', 'past'],
  ['くて', 'te-form', ['te']],
  ['く', 'adverb (く)'],
  ['ければ', 'conditional (ば)'],
  ['かったら', 'conditional (たら)'],
];

const RULES: readonly Rule[] = [
  ...godanRules(),
  ...ICHIDAN.map(([end, reason, actsAs]) => rule(end, 'る', 'v1', reason, actsAs)),
  ...SURU.map(([form, reason, actsAs]) => rule(form, 'する', 'vs', reason, actsAs)),
  ...KURU.flatMap(([stem, end, reason, actsAs]) => [rule(`${stem}${end}`, 'くる', 'vk', reason, actsAs), rule(`来${end}`, '来る', 'vk', reason, actsAs)]),
  ...ADJECTIVE.map(([end, reason, actsAs]) => rule(end, 'い', 'adj-i', reason, actsAs)),
  // 食べないで: the negative's own て form.
  rule('ないで', 'ない', 'adj-i', 'te-form'),
  // 食べている, 読んでいる (and 食べてる): a て form with いる, itself like an ichidan verb (食べています).
  ...['て', 'で'].flatMap((te) => [rule(`${te}いる`, te, 'te', 'ongoing (ている)', ['v1']), rule(`${te}る`, te, 'te', 'ongoing (ている)', ['v1'])]),
];

export interface Deinflection {
  /** The dictionary form it could be. */
  base: string;
  /** The kind of word the base must be. */
  kind: WordKind;
  /** How the form was made from the base, from the base outward: 食べたくなかった is want to, negative, past. */
  reasons: string[];
}

/** Rules applied one after another at most this many times: 食べさせられなかった takes four. */
const MAX_STEPS = 5;

/**
 * Every dictionary form `word` could come from, nearest first, with how it
 * was made. Most are not words: the dictionary checks them. A base is at
 * least two characters (見る, する), so no lone る comes out.
 */
export function deinflect(word: string): Deinflection[] {
  const out: Deinflection[] = [];
  const seen = new Set<string>();
  let level: { text: string; kinds: WordKind[] | null; reasons: string[] }[] = [{ text: word, kinds: null, reasons: [] }];
  for (let step = 0; step < MAX_STEPS && level.length; step++) {
    const next: typeof level = [];
    for (const form of level) {
      for (const r of RULES) {
        if (!form.text.endsWith(r.from)) continue;
        // After the first step, the form must be one the rule makes: 食べない (like an い-adjective) can be read back further, 食べた can't.
        if (form.kinds && !form.kinds.some((k) => r.actsAs.includes(k))) continue;
        const base = form.text.slice(0, form.text.length - r.from.length) + r.to;
        // A dictionary form read round to itself (捨てる as 捨て + てる) is no inflection.
        if ([...base].length < 2 || base === word) continue;
        const key = `${base}|${r.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const reasons = [r.reason, ...form.reasons];
        out.push({ base, kind: r.kind, reasons });
        next.push({ text: base, kinds: [r.kind], reasons });
      }
    }
    level = next;
  }
  return out;
}

/** Whether an entry's parts of speech (JMdict codes) make it a word of this kind. */
export function posFits(pos: string[], kind: WordKind): boolean {
  switch (kind) {
    case 'v1':
      return pos.some((p) => p === 'v1' || p === 'v1-s');
    case 'v5':
      return pos.some((p) => p.startsWith('v5'));
    case 'vs':
      return pos.some((p) => p === 'vs-i' || p === 'vs-s');
    case 'vk':
      return pos.includes('vk');
    case 'adj-i':
      return pos.some((p) => p === 'adj-i' || p === 'adj-ix');
    case 'te':
      return false;
  }
}

/** "食べた is 食べる: past." */
export const inflectionLine = (form: string, base: string, reasons: string[]) => `${form} is ${base}: ${reasons.join(', ')}.`;
