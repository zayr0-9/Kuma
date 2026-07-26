import { StatusBar } from 'expo-status-bar';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
      <View style={styles.centered}>
        <Text style={styles.title}>Transfers</Text>
        <Text>Rebuild the dev client to include the native module.</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  const queued = jobs.filter((job) => job.state !== 'failed');
  const failed = jobs.filter((job) => job.state === 'failed');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Transfers</Text>

      <Text style={styles.section}>Active</Text>
      {active === null ? (
        <Text style={styles.muted}>Nothing uploading right now.</Text>
      ) : (
        <View style={styles.card}>
          <Text style={styles.fileName}>{active.fileName}</Text>
          <ProgressBar value={active.bytesUploaded} total={active.expectedSize} />
          <Text style={styles.muted}>
            {formatBytes(active.bytesUploaded)} / {formatBytes(active.expectedSize)}
          </Text>
        </View>
      )}

      <Text style={styles.section}>Queued ({queued.length})</Text>
      {queued.length === 0 ? (
        <Text style={styles.muted}>No files waiting.</Text>
      ) : (
        queued.map((job) => (
          <View key={job.id} style={styles.jobRow}>
            <Text style={styles.jobName} numberOfLines={1}>
              {job.fileEntryId.slice(0, 8)}
            </Text>
            <Text style={styles.muted}>{formatBytes(job.expectedSize)}</Text>
          </View>
        ))
      )}

      {failed.length > 0 ? (
        <>
          <Text style={styles.section}>Failed ({failed.length})</Text>
          {failed.map((job) => (
            <View key={job.id} style={styles.jobRow}>
              <Text style={styles.jobName} numberOfLines={1}>
                {job.fileEntryId.slice(0, 8)}
              </Text>
              <Text style={styles.error}>{job.lastErrorCode ?? 'failed'}</Text>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.section}>History</Text>
      {events.length === 0 ? (
        <Text style={styles.muted}>No events yet.</Text>
      ) : (
        events.map((event) => (
          <View key={event.id} style={styles.eventRow}>
            <Text style={event.severity === 'error' ? styles.error : styles.eventText}>
              {event.message}
            </Text>
            <Text style={styles.eventTime}>{formatRelative(event.createdAt)}</Text>
          </View>
        ))
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

function ProgressBar({ value, total }: { value: number; total: number }): ReactElement {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
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
  card: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  centered: { alignItems: 'center', flex: 1, gap: 8, justifyContent: 'center', padding: 24 },
  container: { gap: 8, padding: 20 },
  error: { color: '#b91c1c' },
  eventRow: { borderBottomColor: '#f1f5f9', borderBottomWidth: 1, paddingVertical: 6 },
  eventText: { color: '#0f172a' },
  eventTime: { color: '#94a3b8', fontSize: 12 },
  fileName: { fontWeight: '600' },
  jobName: { color: '#0f172a', flex: 1, paddingRight: 12 },
  jobRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  muted: { color: '#64748b' },
  progressFill: { backgroundColor: '#1d4ed8', height: '100%' },
  progressTrack: {
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  section: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    textTransform: 'uppercase',
  },
  title: { fontSize: 24, fontWeight: '600' },
});
