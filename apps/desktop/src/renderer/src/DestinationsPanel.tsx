import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Clock,
  CloudOff,
  FolderPlus,
  HardDrive,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import type { DesktopDeletionPolicy, PhoneRetentionPolicy } from '@foldersync/contracts';
import type { DestinationSummary, DeviceSummary } from '../../shared/destinations.ts';
import type { DestinationStatus } from '../../shared/status.ts';
import { formatBytes, formatRelativeTime } from '../../shared/format.ts';

// The desktop destinations surface (spec 25.2, agent_design §5): each paired phone and
// the folders on this desktop it backs up into. A destination is created here (native
// folder picker → main) and starts unbound until the phone links one of its folders.
// Each card also shows live status (free space, policies once bound, pending commits)
// merged in from status:get.

// Canonical policy wording (agent_design §1) — never soften "delete".
const PHONE_RETENTION_LABELS: Record<PhoneRetentionPolicy, string> = {
  keep_on_phone: 'Keep on phone',
  delete_after_verified_backup: 'Delete from phone after verified backup',
};
const DESKTOP_DELETION_LABELS: Record<DesktopDeletionPolicy, string> = {
  preserve_desktop_copy: 'Preserve desktop copies',
  mirror_user_deletions: 'Move desktop copy to trash when deleted on phone',
};

export function DestinationsPanel(): ReactElement {
  const bridge = window.folderSync;
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [destinations, setDestinations] = useState<DestinationSummary[]>([]);
  const [statusByMapping, setStatusByMapping] = useState<Map<string, DestinationStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The mapping awaiting a second click to confirm its unbind (a stray click shouldn't detach).
  const [pendingUnbind, setPendingUnbind] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const [devs, dests, status] = await Promise.all([
      bridge.devices.list(),
      bridge.destinations.list(),
      bridge.status.get(),
    ]);
    setDevices(devs);
    setDestinations(dests);
    setStatusByMapping(new Map(status.destinations.map((s) => [s.mappingId, s])));
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A newly paired phone appears without the manual Refresh: main pushes on pairing.
  useEffect(() => {
    if (!bridge) return;
    return bridge.pairing.onPaired(() => {
      void refresh();
    });
  }, [bridge, refresh]);

  const addFor = useCallback(
    async (deviceId: string) => {
      if (!bridge) return;
      setError(null);
      const picked = await bridge.destinations.pickFolder();
      if ('cancelled' in picked) return;
      setBusy(true);
      const result = await bridge.destinations.add({
        phoneDeviceId: deviceId,
        destinationRoot: picked.path,
      });
      setBusy(false);
      if (result.outcome === 'created') {
        await refresh();
      } else if (result.outcome === 'overlap') {
        setError('That folder overlaps a destination you already added.');
      } else if (result.outcome === 'invalid_destination') {
        setError('This folder cannot be used as a destination.');
      } else {
        setError('That phone is no longer paired.');
      }
    },
    [bridge, refresh],
  );

  // Detach the phone folder so the destination is bindable again (spec 5.6 revocation). The
  // desktop copies already made are kept; the phone must add the folder again to resume.
  const unbind = useCallback(
    async (mappingId: string) => {
      if (!bridge) return;
      setError(null);
      setBusy(true);
      const result = await bridge.destinations.unbind(mappingId);
      setBusy(false);
      setPendingUnbind(null);
      if (result.outcome === 'unbound') {
        await refresh();
      } else {
        setError('That destination no longer exists.');
      }
    },
    [bridge, refresh],
  );

  if (!bridge) {
    return (
      <section className="card alert alert--danger">
        <span className="body">
          Destinations are unavailable — the preload bridge failed to load.
        </span>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="stack">
        <div className="row-between">
          <div className="section-title">
            <span className="chip">
              <Monitor size={20} />
            </span>
            <h2 className="title">Destinations</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {error !== null && (
          <div className="alert alert--warning">
            <TriangleAlert size={16} />
            <span className="caption">{error}</span>
          </div>
        )}

        {devices === null ? (
          <p className="body muted">Loading…</p>
        ) : devices.length === 0 ? (
          <div className="card card--sunken row">
            <span className="chip">
              <Smartphone size={20} />
            </span>
            <span className="body muted">
              Pair a phone first, then add folders on this desktop to back it up into.
            </span>
          </div>
        ) : (
          devices.map((device) => {
            const owned = destinations.filter((d) => d.phoneDeviceId === device.deviceId);
            return (
              <div key={device.deviceId} className="stack-sm">
                <div className="row">
                  <span className="chip">
                    <Smartphone size={20} />
                  </span>
                  <h3 className="body-strong">{device.displayName}</h3>
                </div>

                {owned.length === 0 ? (
                  <p className="caption muted">No destinations yet.</p>
                ) : (
                  <div className="stack-sm">
                    {owned.map((d) => (
                      <DestinationCard
                        key={d.mappingId}
                        destination={d}
                        status={statusByMapping.get(d.mappingId)}
                        busy={busy}
                        pendingUnbind={pendingUnbind === d.mappingId}
                        onRequestUnbind={() => setPendingUnbind(d.mappingId)}
                        onCancelUnbind={() => setPendingUnbind(null)}
                        onConfirmUnbind={() => void unbind(d.mappingId)}
                      />
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => void addFor(device.deviceId)}
                >
                  <FolderPlus size={16} />
                  Add folder
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function DestinationCard({
  destination: d,
  status,
  busy,
  pendingUnbind,
  onRequestUnbind,
  onCancelUnbind,
  onConfirmUnbind,
}: {
  destination: DestinationSummary;
  status: DestinationStatus | undefined;
  busy: boolean;
  pendingUnbind: boolean;
  onRequestUnbind: () => void;
  onCancelUnbind: () => void;
  onConfirmUnbind: () => void;
}): ReactElement {
  const unavailable = d.bound && status !== undefined && !status.destinationAvailable;

  return (
    <div className="card card--sunken card--pad-md stack-sm">
      <div className="row-between">
        <div className="grow">
          <div className="body-strong">{d.displayName}</div>
          <div className="caption subtle">{d.destinationRoot}</div>
        </div>
        {!d.bound ? (
          <span className="pill pill--muted">
            <CloudOff size={13} />
            Waiting for phone
          </span>
        ) : unavailable ? (
          <span className="pill pill--warning">
            <TriangleAlert size={13} />
            Unavailable
          </span>
        ) : (
          <span className="pill pill--success">
            <ShieldCheck size={13} />
            Linked
          </span>
        )}
      </div>

      {status !== undefined &&
        (status.destinationAvailable ? (
          <div className="row caption muted">
            <HardDrive size={14} />
            <span>
              {formatBytes(status.freeBytes)} free
              {status.pendingCommits > 0 ? ` · ${status.pendingCommits} waiting to commit` : ''}
            </span>
          </div>
        ) : (
          <div className="caption muted">Destination unavailable</div>
        ))}

      {d.bound && status?.phoneRetentionPolicy != null && (
        <div className="caption muted">{PHONE_RETENTION_LABELS[status.phoneRetentionPolicy]}</div>
      )}
      {d.bound && status?.desktopDeletionPolicy != null && (
        <div className="caption muted">{DESKTOP_DELETION_LABELS[status.desktopDeletionPolicy]}</div>
      )}

      {d.bound && status !== undefined && (
        <div className="row caption subtle">
          <Clock size={14} />
          <span>
            {status.lastSyncedAt === null
              ? 'No backups yet'
              : `Last backed up ${formatRelativeTime(status.lastSyncedAt, Date.now())}`}
          </span>
        </div>
      )}

      {d.bound &&
        (pendingUnbind ? (
          <div className="row-between">
            <span className="caption muted">
              Unbind this folder? The phone will need to add it again.
            </span>
            <div className="row">
              <button
                type="button"
                className="btn btn--ghost btn--danger"
                disabled={busy}
                onClick={onConfirmUnbind}
              >
                Confirm unbind
              </button>
              <button type="button" className="btn btn--ghost" onClick={onCancelUnbind}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--danger"
            disabled={busy}
            onClick={onRequestUnbind}
          >
            <Trash2 size={16} />
            Unbind
          </button>
        ))}
    </div>
  );
}
