import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWirePath, wirePathSchema } from '../src/index.ts';

const DIR = join(import.meta.dirname, '../../test-fixtures/fixtures/wire-path');

const valid = JSON.parse(readFileSync(join(DIR, 'valid.json'), 'utf8')) as {
  input: string;
  normalized: string;
}[];
const invalid = JSON.parse(readFileSync(join(DIR, 'invalid.json'), 'utf8')) as string[];

describe('parseWirePath', () => {
  for (const { input, normalized } of valid) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      expect(parseWirePath(input)).toEqual({ ok: true, path: normalized });
      expect(wirePathSchema.parse(input)).toBe(normalized);
    });
  }

  for (const input of invalid) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parseWirePath(input).ok).toBe(false);
      expect(wirePathSchema.safeParse(input).success).toBe(false);
    });
  }

  it('normalises NFD input to NFC', () => {
    const result = parseWirePath('cafe\u0301.txt');
    expect(result).toEqual({ ok: true, path: 'caf\u00e9.txt' });
  });

  it('reports the specific violation', () => {
    expect(parseWirePath('')).toEqual({ ok: false, error: 'empty' });
    expect(parseWirePath('/a')).toEqual({ ok: false, error: 'leading_separator' });
    expect(parseWirePath('a//b')).toEqual({ ok: false, error: 'empty_segment' });
    expect(parseWirePath('a/../b')).toEqual({ ok: false, error: 'dot_segment' });
    expect(parseWirePath('a\u0000b')).toEqual({ ok: false, error: 'nul_byte' });
  });
});
