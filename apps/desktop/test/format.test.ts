import { describe, expect, it } from 'vitest';
import { formatBytes } from '../src/shared/format.ts';

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
