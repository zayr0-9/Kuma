// Coercion helpers for reading node:sqlite column values into the primitive shapes
// our STRICT schema guarantees. `StatementSync.get()` returns `unknown`, so each
// column is narrowed by `typeof` before use — this keeps
// @typescript-eslint/no-base-to-string satisfied and turns a schema/DDL mismatch
// into a loud error rather than a silent "[object Object]". No column is a BLOB,
// so only string/number/bigint are expected.

export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error(`Expected a text column, got ${typeof value}`);
}

export function asTextOrNull(value: unknown): string | null {
  return value === null ? null : asText(value);
}

export function asInt(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`Expected an integer column, got ${typeof value}`);
}

export function asIntOrNull(value: unknown): number | null {
  return value === null ? null : asInt(value);
}

// Narrows the raw row object once, so mappers can index columns as `unknown`.
export function asRow(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return null;
  return raw as Record<string, unknown>;
}
