import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBasicLine, parseCustomLine, parseMastery, parseRenshuuExport } from '../shared/renshuu';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('Renshuu Custom export', () => {
  const result = parseRenshuuExport(fixture('renshuu_custom_sample.txt'));

  it('detects the format and reads every line', () => {
    expect(result.format).toBe('custom');
    expect(result.issues).toEqual([]);
    expect(result.words).toHaveLength(48);
  });

  it('reads a kanji word with adjective POS and mastery', () => {
    expect(result.words[0]).toEqual({
      kana: 'ざんこく',
      kanji: '残酷',
      senses: ['cruel, brutal, ruthless, merciless, inhuman'],
      pos: 'Adjective/-な',
      mastery: 28,
      line: 1,
    });
  });

  it('separates a verb POS that contains spaces from the meanings', () => {
    const w = result.words.find((w) => w.kanji === '戻る')!;
    expect(w.pos).toBe('Godan verb - る (ます = stem+ります)/intransitive');
    expect(w.senses[0]).toBe('to turn back (e.g. half-way)');
    expect(w.senses.at(-1)).toBe('to rebound, to spring back');
  });

  it('reads kana-only words (empty kanji field)', () => {
    const w = result.words.find((w) => w.kana === 'どうしたら')!;
    expect(w.kanji).toBeNull();
    expect(w.senses).toEqual(['how can (one) do something']);
    expect(w.pos).toBe('expression');
    expect(w.mastery).toBeNull(); // "--" = never studied
  });

  it('treats the 255 placeholder as unknown mastery', () => {
    const furu = result.words.filter((w) => w.kana === 'ふる');
    expect(furu.map((w) => [w.kanji, w.mastery])).toEqual([
      ['降る', null],
      ['振る', 28],
    ]);
  });

  it('keeps katakana words and POS with する verb', () => {
    const tunnel = result.words.find((w) => w.kana === 'トンネル')!;
    expect(tunnel.kanji).toBeNull();
    const motamota = result.words.find((w) => w.kana === 'もたもた')!;
    expect(motamota.pos).toBe('adverb/する verb');
  });
});

describe('Renshuu Basic export', () => {
  const result = parseRenshuuExport(fixture('renshuu_basic_sample.txt'));

  it('detects the format and reads every line', () => {
    expect(result.format).toBe('basic');
    expect(result.issues).toEqual([]);
    expect(result.words).toHaveLength(22);
  });

  it('reads kanji/kana and kana-only heads', () => {
    expect(result.words[0]).toMatchObject({ kana: 'ざんこく', kanji: '残酷', pos: null, mastery: null });
    expect(result.words.find((w) => w.kana === 'ずっと')?.kanji).toBeNull();
    expect(result.words.find((w) => w.kana === 'クラクラ')?.senses).toEqual(['{on-mim} dizzy, giddy']);
  });
});

describe('line parsers', () => {
  it('reports lines it cannot read instead of guessing', () => {
    expect(parseBasicLine('just some text', 3)).toMatchObject({ line: 3, reason: expect.any(String) });
    expect(parseCustomLine('かな 仮名 仮名/かな meaning noun', 4)).toMatchObject({ line: 4, reason: expect.stringContaining('mastery') });
  });

  it('skips blank lines and a byte-order mark', () => {
    const r = parseRenshuuExport('﻿犬/いぬ - dog\r\n\r\n猫/ねこ - cat\r\n');
    expect(r.words.map((w) => w.kanji)).toEqual(['犬', '猫']);
    expect(r.words.map((w) => w.line)).toEqual([1, 3]);
  });

  it('parses mastery values', () => {
    expect(parseMastery('--')).toBeNull();
    expect(parseMastery('0')).toBe(0);
    expect(parseMastery('88')).toBe(88);
    expect(parseMastery('255')).toBeNull();
  });
});
