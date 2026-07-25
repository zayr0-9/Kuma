import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { PairingPresentation } from '../../shared/pairing.ts';

// The desktop pairing surface (spec 24.3, agent_design §5): shows the QR the phone
// scans, the desktop's own name, and a countdown for the five-minute window. The raw
// secret is never here — only the rendered image arrives from the main process.

type Status =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'active'; presentation: PairingPresentation }
  | { kind: 'error' };

function remainingLabel(expiresAt: string, nowMs: number): string {
  const ms = new Date(expiresAt).getTime() - nowMs;
  if (ms <= 0) return 'This code has expired — start again.';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function PairingPanel(): ReactElement {
  const bridge = window.folderSync?.pairing;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [nowMs, setNowMs] = useState(() => Date.now());

  // A once-per-second tick drives the countdown while a code is showing.
  useEffect(() => {
    if (status.kind !== 'active') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status.kind]);

  const start = useCallback(async () => {
    if (!bridge) return;
    setStatus({ kind: 'starting' });
    try {
      const presentation = await bridge.start();
      setNowMs(Date.now());
      setStatus({ kind: 'active', presentation });
    } catch {
      setStatus({ kind: 'error' });
    }
  }, [bridge]);

  const cancel = useCallback(async () => {
    if (bridge) await bridge.cancel();
    setStatus({ kind: 'idle' });
  }, [bridge]);

  if (!bridge) {
    return <p>Pairing is unavailable — the preload bridge failed to load.</p>;
  }

  return (
    <section>
      <h2>Pair a phone</h2>
      {status.kind === 'idle' && (
        <p>
          Scan a code with the FolderSync app on your phone to start backing up its folders here.
        </p>
      )}
      {status.kind === 'error' && (
        <p>Could not start pairing. Check the desktop logs and try again.</p>
      )}
      {status.kind === 'active' ? (
        <div>
          <img
            src={status.presentation.qrImageDataUrl}
            alt="Pairing code for the FolderSync phone app"
            width={256}
            height={256}
          />
          <p>
            On {status.presentation.desktopName}.{' '}
            {remainingLabel(status.presentation.expiresAt, nowMs)}
          </p>
          <button type="button" onClick={() => void cancel()}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" disabled={status.kind === 'starting'} onClick={() => void start()}>
          {status.kind === 'starting' ? 'Starting…' : 'Show pairing code'}
        </button>
      )}
    </section>
  );
}
