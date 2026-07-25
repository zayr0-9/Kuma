import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { DesktopDeletionPolicy, PhoneRetentionPolicy } from '@foldersync/contracts';
import type { DestinationSummary, DeviceSummary } from '../../shared/destinations.ts';
import type { DestinationStatus } from '../../shared/status.ts';
import { formatBytes } from '../../shared/format.ts';

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

  if (!bridge) {
    return <p>Destinations are unavailable — the preload bridge failed to load.</p>;
  }

  return (
    <section>
      <h2>Destinations</h2>
      <button type="button" onClick={() => void refresh()}>
        Refresh
      </button>
      {error !== null && <p>{error}</p>}
      {devices === null ? (
        <p>Loading…</p>
      ) : devices.length === 0 ? (
        <p>Pair a phone first, then add folders on this desktop to back it up into.</p>
      ) : (
        devices.map((device) => {
          const owned = destinations.filter((d) => d.phoneDeviceId === device.deviceId);
          return (
            <article key={device.deviceId}>
              <h3>{device.displayName}</h3>
              {owned.length === 0 ? (
                <p>No destinations yet.</p>
              ) : (
                <ul>
                  {owned.map((d) => {
                    const status = statusByMapping.get(d.mappingId);
                    return (
                      <li key={d.mappingId}>
                        <strong>{d.displayName}</strong> — {d.destinationRoot}
                        <div>
                          {d.bound ? 'Linked to a phone folder' : 'Waiting for a phone folder'}
                        </div>
                        {status !== undefined &&
                          (status.destinationAvailable ? (
                            <div>
                              {formatBytes(status.freeBytes)} free
                              {status.pendingCommits > 0
                                ? ` · ${status.pendingCommits} waiting to commit`
                                : ''}
                            </div>
                          ) : (
                            <div>Destination unavailable</div>
                          ))}
                        {d.bound && status?.phoneRetentionPolicy != null && (
                          <div>{PHONE_RETENTION_LABELS[status.phoneRetentionPolicy]}</div>
                        )}
                        {d.bound && status?.desktopDeletionPolicy != null && (
                          <div>{DESKTOP_DELETION_LABELS[status.desktopDeletionPolicy]}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" disabled={busy} onClick={() => void addFor(device.deviceId)}>
                Add folder
              </button>
            </article>
          );
        })
      )}
    </section>
  );
}
