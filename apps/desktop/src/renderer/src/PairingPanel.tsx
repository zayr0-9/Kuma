import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { CircleAlert, CircleCheck, QrCode } from 'lucide-react';
import type { PairingPresentation } from '../../shared/pairing.ts';

// The desktop pairing surface (spec 24.3, agent_design §5): shows the QR the phone
// scans, the desktop's own name, and a countdown for the five-minute window. The raw
// secret is never here — only the rendered image arrives from the main process.

type Status =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'active'; presentation: PairingPresentation }
  | { kind: 'paired'; deviceName: string }
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

  // Main pushes when a phone finishes pairing: switch from the QR to a success line.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onPaired((event) => {
      setStatus({ kind: 'paired', deviceName: event.displayName });
    });
  }, [bridge]);

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
    return (
      <section className="card alert alert--danger">
        <span className="body">Pairing is unavailable — the preload bridge failed to load.</span>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="stack">
        <div className="section-title">
          <span className="chip chip--accent">
            <QrCode size={20} />
          </span>
          <h2 className="title">Pair a phone</h2>
        </div>

        {status.kind === 'idle' && (
          <p className="body muted">
            Scan a code with the FolderSync app on your phone to start backing up its folders here.
          </p>
        )}
        {status.kind === 'error' && (
          <div className="alert alert--danger">
            <CircleAlert size={16} />
            <span className="caption">
              Could not start pairing. Check the desktop logs and try again.
            </span>
          </div>
        )}
        {status.kind === 'paired' && (
          <div className="alert alert--success">
            <CircleCheck size={16} />
            <span className="caption">
              Paired with {status.deviceName}. Add a folder below to back it up.
            </span>
          </div>
        )}

        {status.kind === 'active' ? (
          <div className="stack">
            <img
              className="qr"
              src={status.presentation.qrImageDataUrl}
              alt="Pairing code for the FolderSync phone app"
              width={240}
              height={240}
            />
            <p className="caption muted">
              On {status.presentation.desktopName}.{' '}
              {remainingLabel(status.presentation.expiresAt, nowMs)}
            </p>
            <button type="button" className="btn btn--ghost" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={status.kind === 'starting'}
            onClick={() => void start()}
          >
            <QrCode size={18} />
            {status.kind === 'starting' ? 'Starting…' : 'Show pairing code'}
          </button>
        )}
      </div>
    </section>
  );
}
