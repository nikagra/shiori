// Parsers for Renshuu list exports.
//
// Basic:  `漢字/かな - meaning; meaning` (kana-only words have no slash)
// Custom (all fields, space separated):
//         `かな 漢字 漢字/かな meanings POS mastery`
//         Kana-only words leave the kanji field empty, so there are two spaces.
//         Mastery is a percentage, `--` when never studied, and 255 is a
//         placeholder the export writes for some words (the app shows a real
//         percentage for them), so we treat it as unknown.

export interface ImportedWord {
  kana: string;
  kanji: string | null;
  /** Sense groups as exported, separated by ";" in Renshuu. */
  senses: string[];
  pos: string | null;
  /** 0–100, or null when unknown / never studied. */
  mastery: number | null;
  /** 1-based line number in the source file, used to keep source order. */
  line: number;
}

export interface ParseIssue {
  line: number;
  text: string;
  reason: string;
}

export interface ParseResult {
  format: 'basic' | 'custom';
  words: ImportedWord[];
  issues: ParseIssue[];
}

const POS_ATOM = [
  'Godan verb - \\S(?: \\(ます = stem\\+\\S+\\))?',
  'Ichidan verb \\(ます = stem\\+ます\\)',
  '\\S+ verb',
  'Pre-noun adjective',
  'noun, suffix',
  '[Nn]oun',
  '[Aa]dverb',
  '[Aa]djective',
  '[Ee]xpression',
  '[Cc]onjunction',
  '[Pp]article',
  '[Ss]uffix',
  '[Pp]refix',
  '[Oo]ther',
  '[Pp]ronoun',
  '[Ii]nterjection',
  '[Cc]ounter',
  '[Nn]umeric',
  '-な',
  '-い',
  'な-adjective',
  'transitive,intransitive',
  'transitive',
  'intransitive',
].join('|');

const POS_AT_END = new RegExp(` ((?:${POS_ATOM})(?:/(?:${POS_ATOM}))*)$`);
const MASTERY_AT_END = / (--|\d{1,3})$/;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・〜～]+$/u;

export function splitSenses(definitions: string): string[] {
  return definitions
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseMastery(token: string): number | null {
  if (token === '--') return null;
  const n = Number(token);
  if (!Number.isInteger(n) || n < 0 || n > 100) return null;
  return n;
}

function splitHead(head: string): { kanji: string | null; kana: string } | null {
  const slash = head.indexOf('/');
  if (slash === -1) return head ? { kanji: null, kana: head } : null;
  const kanji = head.slice(0, slash);
  const kana = head.slice(slash + 1);
  if (!kanji || !kana) return null;
  return { kanji, kana };
}

export function parseBasicLine(text: string, line: number): ImportedWord | ParseIssue {
  const sep = text.indexOf(' - ');
  if (sep === -1) return { line, text, reason: 'missing " - " between word and meaning' };
  const head = splitHead(text.slice(0, sep).trim());
  if (!head) return { line, text, reason: 'could not read the word' };
  const senses = splitSenses(text.slice(sep + 3));
  if (senses.length === 0) return { line, text, reason: 'no meaning' };
  return { ...head, senses, pos: null, mastery: null, line };
}

export function parseCustomLine(text: string, line: number): ImportedWord | ParseIssue {
  const first = text.indexOf(' ');
  const second = text.indexOf(' ', first + 1);
  const third = text.indexOf(' ', second + 1);
  if (first < 1 || second === -1 || third === -1) {
    return { line, text, reason: 'not enough fields' };
  }
  const kana = text.slice(0, first);
  const kanjiField = text.slice(first + 1, second);
  const rest = text.slice(third + 1);

  const masteryMatch = rest.match(MASTERY_AT_END);
  if (!masteryMatch) return { line, text, reason: 'missing mastery at end of line' };
  const withoutMastery = rest.slice(0, masteryMatch.index);

  const posMatch = withoutMastery.match(POS_AT_END);
  const pos = posMatch ? posMatch[1] : null;
  const definitions = posMatch ? withoutMastery.slice(0, posMatch.index) : withoutMastery;
  const senses = splitSenses(definitions);
  if (senses.length === 0) return { line, text, reason: 'no meaning' };

  return {
    kana,
    kanji: kanjiField === '' ? null : kanjiField,
    senses,
    pos,
    mastery: parseMastery(masteryMatch[1]),
    line,
  };
}

export function detectFormat(lines: string[]): 'basic' | 'custom' {
  const sample = lines.slice(0, 20);
  const custom = sample.filter((l) => MASTERY_AT_END.test(l)).length;
  const basic = sample.filter((l) => l.includes(' - ') && !MASTERY_AT_END.test(l)).length;
  return custom > basic ? 'custom' : 'basic';
}

export function parseRenshuuExport(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  const format = detectFormat(nonEmpty);
  const words: ImportedWord[] = [];
  const issues: ParseIssue[] = [];
  lines.forEach((raw, i) => {
    const text = raw.trimEnd();
    if (text.trim() === '') return;
    const result = format === 'custom' ? parseCustomLine(text, i + 1) : parseBasicLine(text, i + 1);
    if ('reason' in result) issues.push(result);
    else words.push(result);
  });
  return { format, words, issues };
}

export function isKanaOnly(s: string): boolean {
  return KANA_ONLY.test(s);
}
