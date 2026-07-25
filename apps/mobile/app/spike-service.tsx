import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  getServiceStatus,
  pauseSyncService,
  startSyncService,
  stopSyncService,
} from '../src/native/service.ts';
import type { ServiceStatus } from '../src/native/service.ts';
import { isNativeLinked } from '../src/native/module.ts';
import { SpikeButton } from '../src/components/SpikeButton.tsx';

// Spike 2 diagnostic harness (spec 35, 14): drives the foreground service and observes its
// durable state. Status is polled (pull), not pushed — it stays correct after the JS
// runtime is torn down and the service is restarted by the system (spec 13.3, 14.5). This
// is a developer diagnostics screen, not a product surface.

const POLL_MS = 1000;

const CHECKLIST = [
  'Start while this screen is visible — the notification appears and steps advance.',
  'Send the app to the background (Home). Come back: steps kept advancing.',
  'Swipe the app away from Recents — the notification stays and steps keep advancing.',
  'Use Pause / Resume / Stop from the notification actions.',
  'Reopen the app — status below matches the service (coherent after JS was gone).',
  'Record the Android version and the Samsung battery setting for FolderSync.',
];

function agoLabel(updatedAtMs: number): string {
  if (updatedAtMs <= 0) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000));
  return `${seconds}s ago`;
}

export default function ServiceSpikeScreen(): ReactElement {
  const linked = isNativeLinked();
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!linked) return;
    try {
      setStatus(await getServiceStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [linked]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const act = useCallback(
    (label: string, fn: () => Promise<void>) => {
      void (async () => {
        try {
          await fn();
          await refresh();
        } catch (e) {
          setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [refresh],
  );

  const running = status?.state === 'running';
  const paused = status?.state === 'paused';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Foreground service spike (spike 2)</Text>
      {!linked && (
        <Text style={styles.warning}>
          Native module not linked — rebuild the dev client to include it.
        </Text>
      )}
      {error !== null && <Text style={styles.warning}>{error}</Text>}

      <View style={styles.row}>
        <SpikeButton
          label="Start"
          onPress={() => act('Start', startSyncService)}
          disabled={!linked}
        />
        <SpikeButton
          label="Pause"
          onPress={() => act('Pause', pauseSyncService)}
          disabled={!linked || !running}
        />
      </View>
      <View style={styles.row}>
        <SpikeButton
          label="Resume"
          onPress={() => act('Resume', startSyncService)}
          disabled={!linked || !paused}
        />
        <SpikeButton label="Stop" onPress={() => act('Stop', stopSyncService)} disabled={!linked} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Service status (polled every second)</Text>
        <Text>
          State: <Text style={styles.strong}>{status?.state ?? '—'}</Text>
        </Text>
        <Text>Steps done: {status?.ticks ?? 0}</Text>
        <Text>Last update: {status ? agoLabel(status.updatedAtMs) : '—'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Manual checks (spec 35 spike 2)</Text>
        {CHECKLIST.map((item, index) => (
          <Text key={index} style={styles.checkItem}>
            {index + 1}. {item}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Samsung battery note (spec 14.8)</Text>
        <Text style={styles.muted}>
          If steps stop while the app is backgrounded or swiped away, an OEM battery manager likely
          killed the service. On the Samsung: Settings → Apps → FolderSync → Battery → Unrestricted.
          Record the exact behaviour — it drives the battery-guidance screen.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    gap: 4,
    padding: 12,
  },
  cardTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  checkItem: {
    fontSize: 13,
  },
  container: {
    gap: 12,
    padding: 16,
  },
  muted: {
    color: '#6b7280',
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  strong: {
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  warning: {
    color: '#92400e',
  },
});
