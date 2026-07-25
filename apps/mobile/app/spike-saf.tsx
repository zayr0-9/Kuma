import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  checkAccess,
  deleteDocument,
  isNativeLinked,
  listPersistedPermissions,
  pickDirectory,
  traverseTree,
} from '../src/native/saf.ts';
import type { PersistedPermission, TraversalResult, TraversedFile } from '../src/native/saf.ts';
import { SpikeButton } from '../src/components/SpikeButton.tsx';

// Spike 1 diagnostic harness (spec 35): exercises the SAF surface on the physical device.
// This is a developer diagnostics screen, not a product surface — raw counts and absolute
// values are intentional here (agent_design §4). The real folder/scan UI arrives later.

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export default function SafSpikeScreen(): ReactElement {
  const linked = isNativeLinked();
  const [treeUri, setTreeUri] = useState<string | null>(null);
  const [treeName, setTreeName] = useState<string>('');
  const [grants, setGrants] = useState<PersistedPermission[] | null>(null);
  const [result, setResult] = useState<TraversalResult | null>(null);
  const [sample, setSample] = useState<TraversedFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const append = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 30));
  }, []);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      try {
        await action();
      } catch (error) {
        append(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(null);
      }
    },
    [append],
  );

  const onPick = useCallback(
    () =>
      void run('Pick folder', async () => {
        const picked = await pickDirectory();
        if (picked.cancelled) {
          append('Pick folder: cancelled');
          return;
        }
        setTreeUri(picked.treeUri);
        setTreeName(picked.displayName);
        setResult(null);
        setSample([]);
        append(`Picked "${picked.displayName}" (read=${picked.canRead}, write=${picked.canWrite})`);
      }),
    [run, append],
  );

  const onListGrants = useCallback(
    () =>
      void run('List grants', async () => {
        const list = await listPersistedPermissions();
        setGrants(list);
        append(`Persisted grants: ${list.length}`);
      }),
    [run, append],
  );

  const onCheckAccess = useCallback(() => {
    if (!treeUri) return;
    void run('Check access', async () => {
      const access = await checkAccess(treeUri);
      append(`Access: ${access.accessible ? 'accessible' : 'NOT accessible'}`);
    });
  }, [run, append, treeUri]);

  const onTraverse = useCallback(() => {
    if (!treeUri) return;
    void run('Traverse', async () => {
      const traversal = await traverseTree(treeUri);
      setResult(traversal);
      setSample(traversal.sample);
      append(
        `Traversed ${traversal.fileCount} files in ${traversal.dirCount} dirs ` +
          `(${Math.round(traversal.elapsedMs)} ms)`,
      );
    });
  }, [run, append, treeUri]);

  const onDelete = useCallback(
    (file: TraversedFile) => {
      Alert.alert(
        'Delete this file?',
        `${file.relativePath}\n\nThis permanently removes it from the phone. Use a disposable test file.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              void run('Delete', async () => {
                const outcome = await deleteDocument(file.documentUri);
                if (outcome.deleted) {
                  setSample((prev) => prev.filter((f) => f.documentId !== file.documentId));
                  append(
                    `Deleted ${file.relativePath} — re-run Traverse to confirm the count drops`,
                  );
                } else {
                  append(`Delete refused for ${file.relativePath}`);
                }
              }),
          },
        ],
      );
    },
    [run, append],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>SAF spike (spike 1)</Text>
      {!linked && (
        <Text style={styles.warning}>
          Native module not linked — rebuild the dev client to include it.
        </Text>
      )}

      <View style={styles.row}>
        <SpikeButton label="Pick folder" onPress={onPick} disabled={!linked || busy !== null} />
        <SpikeButton
          label="List grants"
          onPress={onListGrants}
          disabled={!linked || busy !== null}
        />
      </View>
      <View style={styles.row}>
        <SpikeButton
          label="Check access"
          onPress={onCheckAccess}
          disabled={!linked || busy !== null || treeUri === null}
        />
        <SpikeButton
          label="Traverse"
          onPress={onTraverse}
          disabled={!linked || busy !== null || treeUri === null}
        />
      </View>

      {busy !== null && <Text style={styles.muted}>{busy}…</Text>}

      {treeUri !== null && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Selected folder</Text>
          <Text style={styles.strong}>{treeName}</Text>
          <Text style={styles.mono}>{treeUri}</Text>
        </View>
      )}

      {result !== null && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Traversal</Text>
          <Text>Files: {result.fileCount}</Text>
          <Text>Directories: {result.dirCount}</Text>
          <Text>Total size: {formatBytes(result.totalBytes)}</Text>
          <Text>Elapsed: {Math.round(result.elapsedMs)} ms</Text>
          <Text>Unreadable dirs: {result.unreadableDirs}</Text>
          <Text>Skipped entries: {result.skippedEntries}</Text>
          {result.sampleTruncated && (
            <Text style={styles.muted}>Showing first {sample.length} files.</Text>
          )}
        </View>
      )}

      {sample.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Sample files (tap Delete to test controlled deletion)
          </Text>
          {sample.map((file) => (
            <View key={file.documentId} style={styles.fileRow}>
              <View style={styles.fileInfo}>
                <Text style={styles.strong} numberOfLines={1}>
                  {file.relativePath}
                </Text>
                <Text style={styles.muted}>{formatBytes(file.sizeBytes)}</Text>
              </View>
              <SpikeButton label="Delete" onPress={() => onDelete(file)} disabled={busy !== null} />
            </View>
          ))}
        </View>
      )}

      {grants !== null && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Persisted grants ({grants.length})</Text>
          {grants.length === 0 ? (
            <Text style={styles.muted}>None yet.</Text>
          ) : (
            grants.map((grant) => (
              <View key={grant.uri} style={styles.grantRow}>
                <Text style={styles.mono} numberOfLines={2}>
                  {grant.uri}
                </Text>
                <Text style={styles.muted}>
                  read={String(grant.readable)} write={String(grant.writable)}
                </Text>
              </View>
            ))
          )}
        </View>
      )}

      {log.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log</Text>
          {log.map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>
      )}
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
  container: {
    gap: 12,
    padding: 16,
  },
  fileInfo: {
    flexShrink: 1,
    gap: 2,
  },
  fileRow: {
    alignItems: 'center',
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  grantRow: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    gap: 2,
    paddingVertical: 6,
  },
  logLine: {
    fontSize: 12,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  muted: {
    color: '#6b7280',
    fontSize: 12,
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
