import { randomBytes, timingSafeEqual } from 'node:crypto';

// The desktop pairing window (spec 24.3): a five-minute window holding a single
// 256-bit one-time secret. The secret is consumed exactly once by POST /v1/pair
// (spec 24.5) and never logged. The raw secret stays in the main process — only a
// rendered QR image is passed to the renderer — so `activeSecret()` is for the
// main-process QR renderer alone.

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export interface OpenPairingWindow {
  secret: string;
  expiresAt: Date;
}

export interface PairingWindowOptions {
  now?: () => Date;
  windowMs?: number;
  // Injectable for deterministic tests; defaults to 32 CSPRNG bytes as base64url
  // (43 chars — matches the contracts base64Url32 secret shape).
  generateSecret?: () => string;
}

export interface PairingWindow {
  open(): OpenPairingWindow;
  // Validates and single-use-consumes the secret. Returns false for a closed or
  // expired window or a mismatched secret; a successful consume closes the window.
  consume(secret: string): boolean;
  isOpen(): boolean;
  close(): void;
  activeSecret(): string | null;
}

interface WindowState {
  secret: string;
  expiresAtMs: number;
}

function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch; guard first so a wrong-length guess
  // still takes constant time relative to equal-length guesses.
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function createPairingWindow(options: PairingWindowOptions = {}): PairingWindow {
  const now = options.now ?? (() => new Date());
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const generateSecret = options.generateSecret ?? (() => randomBytes(32).toString('base64url'));

  let state: WindowState | null = null;

  const expired = (): boolean => state !== null && now().getTime() >= state.expiresAtMs;

  return {
    open() {
      const secret = generateSecret();
      const expiresAtMs = now().getTime() + windowMs;
      state = { secret, expiresAtMs };
      return { secret, expiresAt: new Date(expiresAtMs) };
    },
    consume(secret) {
      if (state === null) return false;
      if (expired()) {
        state = null;
        return false;
      }
      if (!secretsMatch(secret, state.secret)) return false;
      state = null; // one-time use — invalidate immediately (spec 24.5)
      return true;
    },
    isOpen() {
      if (expired()) state = null;
      return state !== null;
    },
    close() {
      state = null;
    },
    activeSecret() {
      if (state === null || expired()) {
        state = null;
        return null;
      }
      return state.secret;
    },
  };
}
