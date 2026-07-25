import { describe, expect, it } from 'vitest';
import { createPairingWindow } from '../src/main/auth/pairingWindow.ts';

// Unit tests for the pairing window (spec 24.3/24.5): five-minute lifetime, a
// single one-time secret, constant-time comparison, deterministic under an
// injected clock.

const SECRET = 'S'.repeat(43);

function windowAt(clock: { ms: number }, windowMs = 1000) {
  return createPairingWindow({
    now: () => new Date(clock.ms),
    windowMs,
    generateSecret: () => SECRET,
  });
}

describe('createPairingWindow', () => {
  it('consumes a correct secret exactly once', () => {
    const clock = { ms: 0 };
    const w = windowAt(clock);
    const opened = w.open();
    expect(opened.secret).toBe(SECRET);
    expect(opened.expiresAt).toEqual(new Date(1000));

    expect(w.consume(SECRET)).toBe(true);
    // second use fails — the window closed on the first consume
    expect(w.consume(SECRET)).toBe(false);
    expect(w.isOpen()).toBe(false);
  });

  it('rejects a wrong secret but keeps the window open for a retry', () => {
    const clock = { ms: 0 };
    const w = windowAt(clock);
    w.open();
    expect(w.consume('X'.repeat(43))).toBe(false);
    expect(w.consume('short')).toBe(false); // length mismatch is handled
    expect(w.isOpen()).toBe(true);
    expect(w.consume(SECRET)).toBe(true);
  });

  it('rejects a secret after the window expires', () => {
    const clock = { ms: 0 };
    const w = windowAt(clock);
    w.open();
    clock.ms = 999;
    expect(w.isOpen()).toBe(true);
    clock.ms = 1000;
    expect(w.isOpen()).toBe(false);
    expect(w.consume(SECRET)).toBe(false);
  });

  it('returns null active secret when closed or expired', () => {
    const clock = { ms: 0 };
    const w = windowAt(clock);
    expect(w.activeSecret()).toBeNull();
    w.open();
    expect(w.activeSecret()).toBe(SECRET);
    w.close();
    expect(w.activeSecret()).toBeNull();
    w.open();
    clock.ms = 5000;
    expect(w.activeSecret()).toBeNull();
  });

  it('fails to consume when never opened', () => {
    const clock = { ms: 0 };
    expect(windowAt(clock).consume(SECRET)).toBe(false);
  });
});
