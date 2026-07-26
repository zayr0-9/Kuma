import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowRight,
  Cloud,
  Folder,
  Inbox,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react-native';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import {
  Button,
  Card,
  Divider,
  Icon,
  IconButton,
  Screen,
  StatusPill,
  type StatusKind,
  Text,
} from '../src/components/index.ts';
import { useTheme } from '../src/theme/index.ts';
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
import {
  ensureBackgroundSync,
  getServiceStatus,
  setBackgroundSyncEnabled,
  type ServiceStatus,
} from '../src/native/service.ts';

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
  const t = useTheme();
  const router = useRouter();
  const linked = isNativeLinked();
  const [roots, setRoots] = useState<SyncRoot[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPick | null>(null);
  const [destinations, setDestinations] = useState<AvailableDestination[]>([]);
  const [retention, setRetention] = useState<PhoneRetentionPolicy>('keep_on_phone');
  const [deletion, setDeletion] = useState<DesktopDeletionPolicy>('preserve_desktop_copy');
  const [service, setService] = useState<ServiceStatus | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!linked) return;
    try {
      const [nextRoots, nextService] = await Promise.all([listRoots(), getServiceStatus()]);
      if (mounted.current) {
        setRoots(nextRoots);
        setService(nextService);
      }
    } catch {
      // A transient bridge error is harmless — the next poll retries.
    }
  }, [linked]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Resume automatic background sync on open (spec 14.3): a no-op unless the user wants it and
    // has an enabled folder, so it never starts an idle service.
    void ensureBackgroundSync().catch(() => undefined);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const onToggleBackgroundSync = useCallback(
    async (enabled: boolean) => {
      setService((prev) => (prev === null ? prev : { ...prev, autoSyncEnabled: enabled }));
      await setBackgroundSyncEnabled(enabled);
      await refresh();
    },
    [refresh],
  );

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
        // From the first folder on, let the background service keep it synced without "Sync now".
        await ensureBackgroundSync().catch(() => undefined);
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
      <Screen scroll={false}>
        <View style={styles.centered}>
          <Text variant="title">Folders</Text>
          <Text variant="body" tone="muted">
            Rebuild the dev client to include the native module.
          </Text>
        </View>
        <StatusBar style="auto" />
      </Screen>
    );
  }

  return (
    <Screen
      onRefresh={() => {
        setRefreshing(true);
        void refresh().finally(() => setRefreshing(false));
      }}
      refreshing={refreshing}
    >
      {pending === null ? (
        <View style={styles.actionRow}>
          <Button
            label="Add folder"
            icon={Plus}
            onPress={() => void onAddFolder()}
            disabled={busy}
          />
          <Button
            label="Sync now"
            icon={RefreshCw}
            variant="secondary"
            onPress={() => void onSyncNow()}
            disabled={busy}
          />
        </View>
      ) : (
        <Card style={styles.gap}>
          <Text variant="title">Back up “{pending.displayName}”</Text>
          <Text variant="caption" tone="muted">
            Choose a destination on your desktop
          </Text>
          {destinations.map((dest) => (
            <Pressable
              key={dest.mappingId}
              onPress={() => void onBind(dest)}
              disabled={busy || !dest.destinationAvailable}
              style={({ pressed }) => [
                styles.destRow,
                {
                  backgroundColor: pressed ? t.colors.surface : t.colors.surfaceSunken,
                  borderRadius: t.radius.md,
                  padding: t.space.md,
                  gap: t.space.md,
                },
                !dest.destinationAvailable && styles.disabled,
              ]}
            >
              <Icon icon={Monitor} tone="text" />
              <View style={styles.destText}>
                <Text variant="bodyStrong">{dest.displayName}</Text>
                <Text variant="caption" tone="muted">
                  {dest.destinationAvailable
                    ? dest.freeBytes === null
                      ? 'Available'
                      : `${formatBytes(dest.freeBytes)} free`
                    : 'Unavailable'}
                </Text>
              </View>
              <Icon icon={ArrowRight} size={18} />
            </Pressable>
          ))}

          <Divider />
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

          <Button
            label="Cancel"
            variant="ghost"
            block
            onPress={() => {
              setPending(null);
              setDestinations([]);
            }}
          />
        </Card>
      )}

      {pending === null && roots.length > 0 ? (
        <Card>
          <View style={styles.syncRow}>
            <View
              style={[
                styles.chip,
                { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill },
              ]}
            >
              <Icon icon={Cloud} tone={(service?.autoSyncEnabled ?? true) ? 'accent' : 'default'} />
            </View>
            <View style={styles.syncText}>
              <Text variant="bodyStrong">Automatic background sync</Text>
              <Text variant="caption" tone="muted">
                {backgroundSyncSummary(service)}
              </Text>
            </View>
            <Switch
              value={service?.autoSyncEnabled ?? true}
              onValueChange={(next) => void onToggleBackgroundSync(next)}
              trackColor={{ false: t.colors.surfaceSunken, true: t.colors.accent }}
              thumbColor={t.colors.surface}
            />
          </View>
        </Card>
      ) : null}

      {roots.length === 0 && pending === null ? (
        <Card tone="sunken" style={styles.empty}>
          <View
            style={[
              styles.chip,
              styles.emptyChip,
              { backgroundColor: t.colors.surface, borderRadius: t.radius.pill },
            ]}
          >
            <Icon icon={Inbox} tone="text" size={24} />
          </View>
          <Text variant="bodyStrong">No folders yet</Text>
          <Text variant="caption" tone="muted" style={styles.emptyHint}>
            Tap “Add folder” to pick a folder on your phone and back it up.
          </Text>
        </Card>
      ) : null}

      {roots.map((root) => (
        <Card key={root.id} style={styles.gap}>
          <View style={styles.cardHeader}>
            <View style={styles.folderTitle}>
              <Icon icon={Folder} tone="text" />
              <Text variant="title" numberOfLines={1} style={styles.flex}>
                {root.displayName}
              </Text>
            </View>
            <StatusPill kind={rootStatusKind(root)} />
          </View>

          <View style={styles.metaRow}>
            <Icon icon={Monitor} size={14} />
            <Text variant="caption" tone="muted">
              {root.destinationName}
            </Text>
          </View>

          <Text variant="caption" tone="subtle">
            {root.phoneRetentionPolicy === 'keep_on_phone'
              ? 'Keep on phone'
              : 'Delete after backup'}
            {' · '}
            {root.desktopDeletionPolicy === 'preserve_desktop_copy'
              ? 'Preserve desktop copies'
              : 'Mirror deletions'}
          </Text>

          <Text variant="bodyStrong">
            {root.phoneRetentionPolicy === 'delete_after_verified_backup'
              ? `${root.cleanedCount} freed from phone` +
                (root.backedUpCount > 0 ? ` · ${root.backedUpCount} awaiting cleanup` : '') +
                (root.pendingCount > 0
                  ? ` · ${root.pendingCount} pending · ${formatBytes(root.pendingBytes)}`
                  : '')
              : `${root.backedUpCount} backed up` +
                (root.pendingCount > 0
                  ? ` · ${root.pendingCount} pending · ${formatBytes(root.pendingBytes)}`
                  : ' · nothing pending')}
          </Text>

          <Text variant="caption" tone="subtle">
            Last scan {formatRelative(root.lastCompleteScanAt)}
          </Text>

          {root.cleanupFailedCount > 0 ? (
            <View
              style={[
                styles.attentionRow,
                {
                  backgroundColor: t.colors.surfaceSunken,
                  borderRadius: t.radius.md,
                  padding: t.space.md,
                  gap: t.space.sm,
                },
              ]}
            >
              <Icon icon={TriangleAlert} size={16} tone="warning" />
              <Text variant="caption" tone="warning" style={styles.flex}>
                {root.cleanupFailedCount} backed up but couldn’t be removed from the phone
              </Text>
              <IconButton
                icon={RotateCcw}
                accessibilityLabel="Retry cleanup"
                variant="ghost"
                size={36}
                onPress={() => void onRetryCleanup(root)}
              />
            </View>
          ) : null}

          {root.lastErrorMessage !== null && root.status === 'error' ? (
            <Text variant="caption" tone="danger">
              {root.lastErrorMessage}
            </Text>
          ) : null}

          <Divider />
          <View style={styles.cardActions}>
            <View style={styles.enableRow}>
              <Switch
                value={root.enabled}
                onValueChange={() => void onToggle(root)}
                trackColor={{ false: t.colors.surfaceSunken, true: t.colors.accent }}
                thumbColor={t.colors.surface}
              />
              <Text variant="caption" tone="muted">
                {root.enabled ? 'Active' : 'Paused'}
              </Text>
            </View>
            <Button
              label="Remove"
              icon={Trash2}
              variant="ghost"
              danger
              onPress={() => onRemove(root)}
            />
          </View>
        </Card>
      ))}

      {roots.length > 0 ? (
        <Button
          label="View transfers"
          icon={ArrowRight}
          variant="ghost"
          onPress={() => router.push('/transfers')}
        />
      ) : null}

      {busy ? <ActivityIndicator color={t.colors.accent} style={styles.spinner} /> : null}
      <StatusBar style="auto" />
    </Screen>
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
  const t = useTheme();
  return (
    <View style={styles.policyRow}>
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: t.colors.surfaceSunken, true: t.colors.accent }}
        thumbColor={t.colors.surface}
      />
    </View>
  );
}

// Map a root's engine state to the one shared status vocabulary (agent_design.md §2).
function rootStatusKind(root: SyncRoot): StatusKind {
  if (root.status === 'error') return 'error';
  if (root.cleanupFailedCount > 0) return 'attention';
  if (root.status === 'scanning' || root.status === 'syncing') return 'backingUp';
  if (!root.enabled) return 'paused';
  if (root.pendingCount > 0) return 'waiting';
  return 'upToDate';
}

function backgroundSyncSummary(service: ServiceStatus | null): string {
  if (service === null) return 'Checking…';
  if (!service.autoSyncEnabled)
    return 'Off — turn on to back up new files without opening the app.';
  switch (service.state) {
    case 'paused':
      return 'Paused from the notification. Resume there, or turn off here.';
    case 'running':
      return 'On — runs in the background and checks for changes about every 15 min.';
    default:
      return 'On — starts automatically while the app is open.';
  }
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
  attentionRow: { alignItems: 'center', flexDirection: 'row' },
  cardActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  centered: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center' },
  chip: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  destRow: { alignItems: 'center', flexDirection: 'row' },
  destText: { flex: 1, gap: 2 },
  disabled: { opacity: 0.4 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 28 },
  emptyChip: { height: 56, width: 56 },
  emptyHint: { textAlign: 'center' },
  enableRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  folderTitle: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8 },
  gap: { gap: 6 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  spinner: { marginTop: 8 },
  syncRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  syncText: { flex: 1, gap: 2 },
});
