import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  deviceResponseSchema,
  errorResponseSchema,
  fileDeleteRequestSchema,
  fileDeleteResponseSchema,
  filesListRequestSchema,
  filesListResponseSchema,
  healthResponseSchema,
  pairRequestSchema,
  pairResponseSchema,
  prepareStatusResponseSchema,
  prepareUploadRequestSchema,
  prepareUploadResponseSchema,
  rootRegisterRequestSchema,
  rootRegisterResponseSchema,
  syncStatusResponseSchema,
} from '../src/index.ts';

const FIXTURES_ROOT = join(import.meta.dirname, '../../test-fixtures/fixtures');

// These directories have bespoke tests (wirePath.test.ts, pairing.test.ts)
// because they carry input/expected pairs rather than plain payloads.
const SPECIAL_DIRS = ['wire-path', 'pairing-qr'];

const SCHEMAS: Record<string, ZodType> = {
  'pair-request': pairRequestSchema,
  'pair-response': pairResponseSchema,
  'error-response': errorResponseSchema,
  'prepare-upload-request': prepareUploadRequestSchema,
  'prepare-upload-response': prepareUploadResponseSchema,
  'prepare-status-response': prepareStatusResponseSchema,
  'file-delete-request': fileDeleteRequestSchema,
  'file-delete-response': fileDeleteResponseSchema,
  'files-list-request': filesListRequestSchema,
  'files-list-response': filesListResponseSchema,
  'root-register-request': rootRegisterRequestSchema,
  'root-register-response': rootRegisterResponseSchema,
  'health-response': healthResponseSchema,
  'device-response': deviceResponseSchema,
  'sync-status-response': syncStatusResponseSchema,
};

function readFixture(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, dir, file), 'utf8'));
}

describe('golden fixtures', () => {
  it('maps every fixture directory to a schema (and vice versa)', () => {
    const dirs = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual([...Object.keys(SCHEMAS), ...SPECIAL_DIRS].sort());
  });

  for (const [dir, schema] of Object.entries(SCHEMAS)) {
    describe(dir, () => {
      const files = readdirSync(join(FIXTURES_ROOT, dir)).sort();
      const valid = files.filter((file) => file.startsWith('valid-'));
      const invalid = files.filter((file) => file.startsWith('invalid-'));

      it('has at least one fixture of each polarity, and nothing unclassified', () => {
        expect(valid.length).toBeGreaterThan(0);
        expect(invalid.length).toBeGreaterThan(0);
        expect(valid.length + invalid.length).toBe(files.length);
      });

      for (const file of valid) {
        it(`accepts ${file}`, () => {
          const result = schema.safeParse(readFixture(dir, file));
          expect(
            result.success,
            result.success ? '' : JSON.stringify(result.error.issues, null, 2),
          ).toBe(true);
        });
      }

      for (const file of invalid) {
        it(`rejects ${file}`, () => {
          expect(schema.safeParse(readFixture(dir, file)).success).toBe(false);
        });
      }
    });
  }
});
