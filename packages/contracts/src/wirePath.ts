import { z } from 'zod';

// Wire-format path rules (spec 12.6). This is the canonical TS implementation —
// the desktop adds platform-specific validation on top (spec 22.1); it never
// replaces these checks.
export const WIRE_PATH_SEPARATOR = '/';

export type WirePathError =
  'empty' | 'nul_byte' | 'leading_separator' | 'empty_segment' | 'dot_segment';

export type WirePathResult = { ok: true; path: string } | { ok: false; error: WirePathError };

// Validates the wire rules and returns the canonical (NFC-normalised) form.
export function parseWirePath(input: string): WirePathResult {
  if (input.length === 0) return { ok: false, error: 'empty' };
  if (input.includes('\u0000')) return { ok: false, error: 'nul_byte' };
  if (input.startsWith(WIRE_PATH_SEPARATOR)) return { ok: false, error: 'leading_separator' };
  for (const segment of input.split(WIRE_PATH_SEPARATOR)) {
    if (segment.length === 0) return { ok: false, error: 'empty_segment' };
    if (segment === '.' || segment === '..') return { ok: false, error: 'dot_segment' };
  }
  return { ok: true, path: input.normalize('NFC') };
}

export const wirePathSchema = z
  .string()
  .superRefine((value, ctx) => {
    const result = parseWirePath(value);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: `invalid wire path: ${result.error}` });
    }
  })
  .transform((value) => value.normalize('NFC'));
