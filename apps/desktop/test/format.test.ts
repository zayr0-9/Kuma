import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelativeTime } from '../src/shared/format.ts';

// Free-space figures on the status card (agent_design §5). Binary steps, one decimal
// below 100 of a unit, whole numbers above, and a dash — never "0" — for no reading.

describe('formatBytes', () => {
  it('renders a dash for an unavailable volume, not zero', () => {
    expect(formatBytes(null)).toBe('—');
  });

  it('keeps sub-kilobyte values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('steps up in binary units', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('rounds to whole numbers at or above 100 of a unit', () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    // 931.3 GiB rounds to a whole-number GB rather than a noisy decimal.
    expect(formatBytes(Math.round(931.3 * 1024 * 1024 * 1024))).toBe('931 GB');
  });

  it('caps at the largest known unit', () => {
    expect(formatBytes(3 * 1024 ** 5)).toBe('3 PB');
  });
});

describe('formatRelativeTime', () => {
  const NOW = Date.parse('2026-07-25T12:00:00.000Z');
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();
  const MINUTE = 60_000;

  it('reads the last three-quarters of a minute as "just now"', () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(44_000), NOW)).toBe('just now');
  });

  it('counts minutes and hours with singular/plural', () => {
    expect(formatRelativeTime(ago(45_000), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(2 * MINUTE), NOW)).toBe('2 minutes ago');
    expect(formatRelativeTime(ago(60 * MINUTE), NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(ago(3 * 60 * MINUTE), NOW)).toBe('3 hours ago');
  });

  it('counts days', () => {
    expect(formatRelativeTime(ago(24 * 60 * MINUTE), NOW)).toBe('1 day ago');
    expect(formatRelativeTime(ago(5 * 24 * 60 * MINUTE), NOW)).toBe('5 days ago');
  });

  it('never shows a negative time for a future or unparseable stamp', () => {
    expect(formatRelativeTime(new Date(NOW + 5_000).toISOString(), NOW)).toBe('just now');
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});
