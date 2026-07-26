import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Play, Settings2, TriangleAlert } from 'lucide-react-native';
import {
  getServiceStatus,
  pauseSyncService,
  startSyncService,
  stopSyncService,
} from '../src/native/service.ts';
import type { ServiceStatus } from '../src/native/service.ts';
import { isNativeLinked } from '../src/native/module.ts';
import { Button, Card, Icon, Note, Screen, Text } from '../src/components/index.ts';

// Foreground-service diagnostic (spec 35 spike 2, 14): drives the service and observes its durable
// state. Status is polled (pull), not pushed — it stays correct after the JS runtime is torn down
// and the service is restarted by the system (spec 13.3, 14.5). A developer diagnostics screen, not
// a product surface, but it speaks the design system: themed tokens, dark-mode aware, no raw colour.

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
    <Screen>
      {!linked && (
        <Note tone="warning" icon={TriangleAlert}>
          Native module not linked — rebuild the dev client to include it.
        </Note>
      )}
      {error !== null && (
        <Note tone="warning" icon={TriangleAlert}>
          {error}
        </Note>
      )}

      <View style={styles.row}>
        <Button
          label="Start"
          icon={Play}
          onPress={() => act('Start', startSyncService)}
          block
          disabled={!linked}
        />
        <Button
          label="Pause"
          variant="secondary"
          onPress={() => act('Pause', pauseSyncService)}
          block
          disabled={!linked || !running}
        />
      </View>
      <View style={styles.row}>
        <Button
          label="Resume"
          variant="secondary"
          onPress={() => act('Resume', startSyncService)}
          block
          disabled={!linked || !paused}
        />
        <Button
          label="Stop"
          variant="ghost"
          danger
          onPress={() => act('Stop', stopSyncService)}
          block
          disabled={!linked}
        />
      </View>

      <Card style={styles.cardGap}>
        <View style={styles.noteHeader}>
          <Icon icon={Settings2} size={16} />
          <Text variant="bodyStrong">Service status (polled every second)</Text>
        </View>
        <Text variant="body">
          State: <Text variant="bodyStrong">{status?.state ?? '—'}</Text>
        </Text>
        <Text variant="body">Steps done: {status?.ticks ?? 0}</Text>
        <Text variant="body">Last update: {status ? agoLabel(status.updatedAtMs) : '—'}</Text>
      </Card>

      <Card style={styles.cardGap}>
        <Text variant="bodyStrong">Manual checks (spec 35 spike 2)</Text>
        {CHECKLIST.map((item, index) => (
          <Text key={index} variant="caption" tone="muted">
            {index + 1}. {item}
          </Text>
        ))}
      </Card>

      <Card tone="sunken" style={styles.cardGap}>
        <Text variant="bodyStrong">Samsung battery note (spec 14.8)</Text>
        <Text variant="caption" tone="muted">
          If steps stop while the app is backgrounded or swiped away, an OEM battery manager likely
          killed the service. On the Samsung: Settings → Apps → FolderSync → Battery → Unrestricted.
          Record the exact behaviour — it drives the battery-guidance screen.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardGap: { gap: 4 },
  noteHeader: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
});
