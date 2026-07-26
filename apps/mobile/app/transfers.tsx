import { StatusBar } from 'expo-status-bar';
import { Clock, FileUp, UploadCloud } from 'lucide-react-native';
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Divider, Icon, ProgressBar, Screen, Text } from '../src/components/index.ts';
import { useTheme } from '../src/theme/index.ts';
import {
  type ActiveTransfer,
  getSyncEvents,
  getTransfers,
  isNativeLinked,
  type SyncEvent,
  type TransferJob,
} from '../src/native/engine.ts';

// Transfers screen (spec 5.5): the active upload with a live progress bar, the queued/failed
// jobs behind it, and the recent operational history. Pull-model polling of getTransfers +
// getSyncEvents — the durable truth is Room; this is a view.

const POLL_MS = 1000;

export default function TransfersScreen(): ReactElement {
  const t = useTheme();
  const linked = isNativeLinked();
  const [active, setActive] = useState<ActiveTransfer | null>(null);
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!linked) return;
    try {
      const [transfers, history] = await Promise.all([getTransfers(), getSyncEvents(30)]);
      if (!mounted.current) return;
      setActive(transfers.active);
      setJobs(transfers.jobs);
      setEvents(history);
    } catch {
      // Transient bridge error — the next poll retries.
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

  if (!linked) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <Text variant="title">Transfers</Text>
          <Text variant="body" tone="muted">
            Rebuild the dev client to include the native module.
          </Text>
        </View>
        <StatusBar style="auto" />
      </Screen>
    );
  }

  const queued = jobs.filter((job) => job.state !== 'failed');
  const failed = jobs.filter((job) => job.state === 'failed');

  return (
    <Screen>
      <Section label="Active">
        {active === null ? (
          <Text variant="body" tone="muted">
            Nothing uploading right now.
          </Text>
        ) : (
          <Card style={styles.gap}>
            <View style={styles.activeHead}>
              <View
                style={[
                  styles.chip,
                  { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill },
                ]}
              >
                <Icon icon={UploadCloud} tone="accent" />
              </View>
              <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                {active.fileName}
              </Text>
            </View>
            <ProgressBar value={active.bytesUploaded} total={active.expectedSize} />
            <Text variant="caption" tone="muted">
              {formatBytes(active.bytesUploaded)} / {formatBytes(active.expectedSize)}
            </Text>
          </Card>
        )}
      </Section>

      <Section label={`Queued (${queued.length})`}>
        {queued.length === 0 ? (
          <Text variant="body" tone="muted">
            No files waiting.
          </Text>
        ) : (
          <Card padding="none">
            {queued.map((job, i) => (
              <View key={job.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.jobRow}>
                  <Icon icon={FileUp} size={16} />
                  <Text variant="body" numberOfLines={1} style={styles.flex}>
                    {job.fileEntryId.slice(0, 8)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {formatBytes(job.expectedSize)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </Section>

      {failed.length > 0 ? (
        <Section label={`Failed (${failed.length})`}>
          <Card padding="none">
            {failed.map((job, i) => (
              <View key={job.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.jobRow}>
                  <Icon icon={FileUp} size={16} tone="danger" />
                  <Text variant="body" numberOfLines={1} style={styles.flex}>
                    {job.fileEntryId.slice(0, 8)}
                  </Text>
                  <Text variant="caption" tone="danger">
                    {job.lastErrorCode ?? 'failed'}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section label="History">
        {events.length === 0 ? (
          <Text variant="body" tone="muted">
            No events yet.
          </Text>
        ) : (
          <Card padding="none">
            {events.map((event, i) => (
              <View key={event.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.eventRow}>
                  <Icon
                    icon={Clock}
                    size={14}
                    tone={event.severity === 'error' ? 'danger' : 'default'}
                  />
                  <Text
                    variant="body"
                    tone={event.severity === 'error' ? 'danger' : 'default'}
                    style={styles.flex}
                  >
                    {event.message}
                  </Text>
                  <Text variant="caption" tone="subtle">
                    {formatRelative(event.createdAt)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </Section>

      <StatusBar style="auto" />
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <View style={styles.section}>
      <Text variant="label" tone="subtle">
        {label}
      </Text>
      {children}
    </View>
  );
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

function formatRelative(epochMs: number): string {
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const styles = StyleSheet.create({
  activeHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  centered: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center' },
  chip: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  eventRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  flex: { flex: 1 },
  gap: { gap: 8 },
  jobRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  section: { gap: 8 },
});
