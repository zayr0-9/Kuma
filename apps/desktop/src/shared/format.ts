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
