// Presentational helpers shared across desktop surfaces. Pure and electron-free so
// they are unit-tested directly (agent_design §2: consistent, calm numbers in status).

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const;

// A short human free-space figure for a status card. Binary steps (÷1024) with the
// familiar KB/MB/GB labels; one decimal below 100 of a unit, whole numbers above so a
// large drive reads "931 GB", not "931.4 GB". Null (an unavailable volume) renders as
// an em dash, never "0" — zero free space and no reading are different things.
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

// A calm relative time for status surfaces (agent_design §4 — relative in status,
// absolute only in history/diagnostics). `nowMs` is injected so it is pure and
// unit-tested; the card passes Date.now(). A future timestamp (clock skew) and a
// just-happened one both read "just now", never a negative or alarming figure.
export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((nowMs - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
