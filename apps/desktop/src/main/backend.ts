import { createControlServer } from './api/controlServer.ts';
import { identityCertificateRef, loadOrCreateIdentity } from './auth/identityStore.ts';
import { createPairingWindow, type PairingWindow } from './auth/pairingWindow.ts';
import {
  createRepositories,
  openDatabase,
  resolveDatabasePath,
  type Repositories,
} from './db/index.ts';
import { startAdvertising, type Advertiser } from './discovery/advertise.ts';
import { createCommitCoordinator } from './sync/commitCoordinator.ts';
import { createCommitService } from './sync/commitService.ts';
import { garbageCollectStaging } from './sync/stagingGc.ts';

// The privileged backend, assembled independently of Electron so it starts and
// stops under vitest against a temp data directory. `main/index.ts` is the only
// electron-aware file; it calls startBackend with `app.getPath('userData')`.
//
// One place wires the whole vertical slice: the metadata database, the persisted
// TLS identity (and its summary row), the HTTPS control server with the commit
// coordinator, DNS-SD advertising, and startup staging reconciliation.

export interface BackendConfig {
  // Application data directory (Electron `app.getPath('userData')`). Holds the
  // database, identity files and — via each mapping — the destination roots' staging.
  userDataDir: string;
  displayName: string;
  // Bind host/port for the control server. Defaults: all interfaces (LAN), OS-assigned
  // port. Tests pin to loopback.
  host?: string;
  port?: number;
  // DNS-SD advertising is on by default; tests disable it to avoid multicast.
  enableDiscovery?: boolean;
  now?: () => Date;
}

export interface Backend {
  url: string;
  port: number;
  deviceId: string;
  spkiSha256: string;
  // Exposed so the (later) desktop UI can open a pairing window and render its QR.
  pairingWindow: PairingWindow;
  close(): Promise<void>;
}

export async function startBackend(config: BackendConfig): Promise<Backend> {
  const now = config.now ?? (() => new Date());
  const db = openDatabase(resolveDatabasePath(config.userDataDir));
  const identity = await loadOrCreateIdentity(config.userDataDir);
  const repositories = createRepositories(db);

  // Persist / refresh the singleton identity summary (spec 21.1). created_at is
  // preserved by the upsert on later launches; the pin and name are refreshed.
  repositories.identity.set({
    deviceId: identity.deviceId,
    displayName: config.displayName,
    certificateRef: identityCertificateRef(config.userDataDir),
    publicKeyPin: identity.spkiSha256,
    createdAt: now().toISOString(),
  });

  const pairingWindow = createPairingWindow({});
  const commitCoordinator = createCommitCoordinator({
    repositories,
    service: createCommitService({ repositories }),
  });

  const app = createControlServer({
    tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
    identity: { deviceId: identity.deviceId, name: config.displayName },
    repositories,
    pairingWindow,
    commitCoordinator,
  });

  const url = await app.listen({ port: config.port ?? 0, host: config.host ?? '0.0.0.0' });
  const port = Number(new URL(url).port);

  // Reclaim orphaned staged files before serving (spec 22.3).
  await reconcileStaging(repositories, now().toISOString());

  let advertiser: Advertiser | null = null;
  if (config.enableDiscovery !== false) {
    advertiser = await startAdvertising({
      deviceId: identity.deviceId,
      displayName: config.displayName,
      port,
    });
  }

  return {
    url,
    port,
    deviceId: identity.deviceId,
    spkiSha256: identity.spkiSha256,
    pairingWindow,
    close: async () => {
      if (advertiser !== null) await advertiser.stop();
      await app.close();
      db.close();
    },
  };
}

// Startup garbage collection (spec 22.3): a staged file is retained only if an active
// prepare names it; everything else in each destination's staging is orphaned and
// removed. Prepares resolve to their destination via the bound mapping.
async function reconcileStaging(repositories: Repositories, nowIso: string): Promise<void> {
  const activeByDestination = new Map<string, Set<string>>();
  for (const prepare of repositories.files.listActivePrepares(nowIso)) {
    const mapping = repositories.roots.getByPhoneRoot(prepare.phoneDeviceId, prepare.rootId);
    if (mapping === null) continue;
    const active = activeByDestination.get(mapping.destinationRoot) ?? new Set<string>();
    active.add(prepare.prepareId);
    activeByDestination.set(mapping.destinationRoot, active);
  }

  const destinations = new Set(
    repositories.roots.listDestinations().map((entry) => entry.destinationRoot),
  );
  for (const destination of destinations) {
    await garbageCollectStaging(destination, activeByDestination.get(destination) ?? new Set());
  }
}
