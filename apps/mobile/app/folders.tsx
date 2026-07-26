import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SpikeButton } from '../src/components/SpikeButton.tsx';
import {
  addRoot,
  type AvailableDestination,
  type DesktopDeletionPolicy,
  isNativeLinked,
  listAvailableDestinations,
  listRoots,
  type PhoneRetentionPolicy,
  removeRoot,
  retryCleanup,
  setRootEnabled,
  type SyncRoot,
  syncNow,
} from '../src/native/engine.ts';
import { pickDirectory } from '../src/native/saf.ts';

// Folders screen (spec 5.2, 5.5 Add/edit folder). Lists the phone's persisted sync roots with
// per-root status, and drives the add-folder flow: pick a directory → choose a desktop
// destination + the two policies → bind + persist → kick an initial sync. State is durable in
// Room natively; this screen polls listRoots (pull model, like the other surfaces).

interface PendingPick {
  treeUri: string;
  displayName: string;
  providerAuthority: string | null;
}

const POLL_MS = 2500;

export default function FoldersScreen(): ReactElement {
  const linked = isNativeLinked();
  const [roots, setRoots] = useState<SyncRoot[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPick | null>(null);
  const [destinations, setDestinations] = useState<AvailableDestination[]>([]);
  const [retention, setRetention] = useState<PhoneRetentionPolicy>('keep_on_phone');
  const [deletion, setDeletion] = useState<DesktopDeletionPolicy>('preserve_desktop_copy');
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!linked) return;
    try {
      const next = await listRoots();
      if (mounted.current) setRoots(next);
    } catch {
      // A transient bridge error is harmless — the next poll retries.
    }
  }, [linked]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const onAddFolder = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await pickDirectory();
      if (picked.cancelled) return;
      const result = await listAvailableDestinations();
      if (!result.ok) {
        Alert.alert('Cannot load destinations', friendlyReason(result.reason));
        return;
      }
      if (result.destinations.length === 0) {
        Alert.alert(
          'No destinations available',
          'Add a destination folder on the desktop (and leave it unbound), then try again.',
        );
        return;
      }
      setRetention('keep_on_phone');
      setDeletion('preserve_desktop_copy');
      setDestinations(result.destinations);
      setPending({
        treeUri: picked.treeUri,
        displayName: picked.displayName,
        providerAuthority: picked.providerAuthority,
      });
    } catch (error) {
      Alert.alert('Could not open the folder picker', String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const onBind = useCallback(
    async (destination: AvailableDestination) => {
      if (pending === null) return;
      setBusy(true);
      try {
        const res = await addRoot(
          pending.treeUri,
          pending.displayName,
          pending.providerAuthority,
          destination.mappingId,
          destination.displayName,
          retention,
          deletion,
        );
        if (!res.ok) {
          Alert.alert('Could not add folder', friendlyReason(res.reason));
          return;
        }
        setPending(null);
        setDestinations([]);
        await syncNow();
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [pending, retention, deletion, refresh],
  );

  const onSyncNow = useCallback(async () => {
    await syncNow();
    await refresh();
  }, [refresh]);

  const onToggle = useCallback(
    async (root: SyncRoot) => {
      await setRootEnabled(root.id, !root.enabled);
      await refresh();
    },
    [refresh],
  );

  const onRetryCleanup = useCallback(
    async (root: SyncRoot) => {
      await retryCleanup(root.id);
      await refresh();
    },
    [refresh],
  );

  const onRemove = useCallback(
    (root: SyncRoot) => {
      Alert.alert(
        `Remove ${root.displayName}?`,
        'This forgets the folder on the phone and unbinds it on the desktop. Files already backed up are kept on the desktop.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await removeRoot(root.id);
                await refresh();
              })();
            },
          },
        ],
      );
    },
    [refresh],
  );

  if (!linked) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Folders</Text>
        <Text>Rebuild the dev client to include the native module.</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Text style={styles.title}>Folders</Text>

      {pending === null ? (
        <View style={styles.actionRow}>
          <SpikeButton label="Add folder" onPress={() => void onAddFolder()} disabled={busy} />
          <SpikeButton label="Sync now" onPress={() => void onSyncNow()} disabled={busy} />
        </View>
      ) : (
        <View style={styles.chooser}>
          <Text style={styles.chooserTitle}>Back up “{pending.displayName}” to…</Text>
          {destinations.map((dest) => (
            <Pressable
              key={dest.mappingId}
              style={styles.destination}
              onPress={() => void onBind(dest)}
              disabled={busy || !dest.destinationAvailable}
            >
              <Text style={styles.destinationName}>{dest.displayName}</Text>
              <Text style={styles.muted}>
                {dest.destinationAvailable
                  ? dest.freeBytes === null
                    ? 'Available'
                    : `${formatBytes(dest.freeBytes)} free`
                  : 'Unavailable'}
              </Text>
            </Pressable>
          ))}

          <PolicyToggle
            label="Keep files on the phone after backup"
            value={retention === 'keep_on_phone'}
            onChange={(keep) =>
              setRetention(keep ? 'keep_on_phone' : 'delete_after_verified_backup')
            }
          />
          <PolicyToggle
            label="Keep desktop copies when I delete on the phone"
            value={deletion === 'preserve_desktop_copy'}
            onChange={(preserve) =>
              setDeletion(preserve ? 'preserve_desktop_copy' : 'mirror_user_deletions')
            }
          />

          <Pressable
            style={styles.cancel}
            onPress={() => {
              setPending(null);
              setDestinations([]);
            }}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {roots.length === 0 && pending === null ? (
        <Text style={styles.muted}>No folders yet. Tap “Add folder” to back one up.</Text>
      ) : null}

      {roots.map((root) => (
        <View key={root.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.folderName}>{root.displayName}</Text>
            <StatusBadge root={root} />
          </View>
          <Text style={styles.muted}>Desktop: {root.destinationName}</Text>
          <Text style={styles.policy}>
            {root.phoneRetentionPolicy === 'keep_on_phone'
              ? 'Keep on phone'
              : 'Delete after backup'}
            {' · '}
            {root.desktopDeletionPolicy === 'preserve_desktop_copy'
              ? 'Preserve desktop copies'
              : 'Mirror deletions'}
          </Text>
          {root.phoneRetentionPolicy === 'delete_after_verified_backup' ? (
            <Text style={styles.stats}>
              {root.cleanedCount} freed from phone
              {root.backedUpCount > 0 ? ` · ${root.backedUpCount} awaiting cleanup` : ''}
              {root.pendingCount > 0
                ? ` · ${root.pendingCount} pending · ${formatBytes(root.pendingBytes)}`
                : ''}
            </Text>
          ) : (
            <Text style={styles.stats}>
              {root.backedUpCount} backed up
              {root.pendingCount > 0
                ? ` · ${root.pendingCount} pending · ${formatBytes(root.pendingBytes)}`
                : ' · nothing pending'}
            </Text>
          )}
          <Text style={styles.muted}>Last scan {formatRelative(root.lastCompleteScanAt)}</Text>
          {root.cleanupFailedCount > 0 ? (
            <View style={styles.cleanupFailedRow}>
              <Text style={styles.cleanupFailedText}>
                {root.cleanupFailedCount} backed up but couldn’t be removed from the phone
              </Text>
              <Pressable onPress={() => void onRetryCleanup(root)} hitSlop={8}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {root.lastErrorMessage !== null && root.status === 'error' ? (
            <Text style={styles.error}>{root.lastErrorMessage}</Text>
          ) : null}

          <View style={styles.cardActions}>
            <View style={styles.enableRow}>
              <Switch value={root.enabled} onValueChange={() => void onToggle(root)} />
              <Text style={styles.muted}>{root.enabled ? 'Active' : 'Paused'}</Text>
            </View>
            <Pressable onPress={() => onRemove(root)} hitSlop={8}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Link href="/transfers" style={styles.link}>
        View transfers
      </Link>
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

function PolicyToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <View style={styles.policyRow}>
      <Text style={styles.policyLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function StatusBadge({ root }: { root: SyncRoot }): ReactElement {
  const text =
    root.status === 'scanning'
      ? 'Scanning'
      : root.status === 'syncing'
        ? 'Syncing'
        : root.status === 'error'
          ? 'Error'
          : root.enabled
            ? 'Idle'
            : 'Paused';
  return (
    <View style={[styles.badge, root.status === 'error' && styles.badgeError]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

function friendlyReason(reason: string): string {
  switch (reason) {
    case 'not_paired':
      return 'Pair a desktop first.';
    case 'network':
      return 'Could not reach the desktop. Check it is on the same Wi-Fi.';
    case 'pin_mismatch':
      return 'The desktop identity changed. Pair again.';
    default:
      return reason;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatRelative(epochMs: number | null): string {
  if (epochMs === null) return 'never';
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: 8 },
  badge: { backgroundColor: '#334155', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeError: { backgroundColor: '#b91c1c' },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: '#64748b', fontWeight: '600' },
  card: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  cardActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  centered: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 24 },
  cleanupFailedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  cleanupFailedText: { color: '#b91c1c', flex: 1 },
  chooser: {
    backgroundColor: '#eef2ff',
    borderRadius: 10,
    gap: 8,
    padding: 14,
  },
  chooserTitle: { fontSize: 16, fontWeight: '600' },
  container: { gap: 12, padding: 20 },
  destination: {
    backgroundColor: '#ffffff',
    borderColor: '#c7d2fe',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  destinationName: { fontWeight: '600' },
  enableRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  error: { color: '#b91c1c' },
  folderName: { fontSize: 18, fontWeight: '600' },
  link: { color: '#1d4ed8', fontWeight: '600', paddingVertical: 8 },
  muted: { color: '#64748b' },
  policy: { color: '#475569', fontSize: 13 },
  policyLabel: { flex: 1, paddingRight: 12 },
  policyRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  remove: { color: '#b91c1c', fontWeight: '600' },
  retry: { color: '#1d4ed8', fontWeight: '600' },
  spinner: { marginTop: 8 },
  stats: { color: '#0f172a', fontWeight: '500' },
  title: { fontSize: 24, fontWeight: '600' },
});
