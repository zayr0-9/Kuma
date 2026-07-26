import { Fragment, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Trash2, TriangleAlert } from 'lucide-react-native';
import {
  checkAccess,
  deleteDocument,
  isNativeLinked,
  listPersistedPermissions,
  pickDirectory,
  traverseTree,
} from '../src/native/saf.ts';
import type { PersistedPermission, TraversalResult, TraversedFile } from '../src/native/saf.ts';
import { Button, Card, Divider, Note, Screen, Text } from '../src/components/index.ts';

// SAF access diagnostic (spec 35 spike 1): exercises the SAF surface on the physical device.
// A developer diagnostics screen, not a product surface — so raw counts, byte totals and the
// absolute tree URI are shown on purpose (agent_design §4), but the screen still speaks the
// design system: themed tokens, dark-mode aware, no hard-coded colour.

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

  const pending = busy !== null;

  return (
    <Screen>
      {!linked && (
        <Note tone="warning" icon={TriangleAlert}>
          Native module not linked — rebuild the dev client to include it.
        </Note>
      )}

      <View style={styles.row}>
        <Button label="Pick folder" onPress={onPick} block disabled={!linked || pending} />
        <Button
          label="List grants"
          variant="secondary"
          onPress={onListGrants}
          block
          disabled={!linked || pending}
        />
      </View>
      <View style={styles.row}>
        <Button
          label="Check access"
          variant="secondary"
          onPress={onCheckAccess}
          block
          disabled={!linked || pending || treeUri === null}
        />
        <Button
          label="Traverse"
          variant="secondary"
          onPress={onTraverse}
          block
          disabled={!linked || pending || treeUri === null}
        />
      </View>

      {busy !== null && (
        <Text variant="caption" tone="muted">
          {busy}…
        </Text>
      )}

      {treeUri !== null && (
        <Card style={styles.cardGap}>
          <Text variant="bodyStrong">Selected folder</Text>
          <Text variant="body">{treeName}</Text>
          <Text variant="caption" tone="subtle" style={styles.mono}>
            {treeUri}
          </Text>
        </Card>
      )}

      {result !== null && (
        <Card style={styles.cardGap}>
          <Text variant="bodyStrong">Traversal</Text>
          <Text variant="body">Files: {result.fileCount}</Text>
          <Text variant="body">Directories: {result.dirCount}</Text>
          <Text variant="body">Total size: {formatBytes(result.totalBytes)}</Text>
          <Text variant="body">Elapsed: {Math.round(result.elapsedMs)} ms</Text>
          <Text variant="body">Unreadable dirs: {result.unreadableDirs}</Text>
          <Text variant="body">Skipped entries: {result.skippedEntries}</Text>
          {result.sampleTruncated && (
            <Text variant="caption" tone="muted">
              Showing first {sample.length} files.
            </Text>
          )}
        </Card>
      )}

      {sample.length > 0 && (
        <Card style={styles.cardGap}>
          <Text variant="bodyStrong">Sample files (tap Delete to test controlled deletion)</Text>
          {sample.map((file, index) => (
            <Fragment key={file.documentId}>
              {index > 0 && <Divider />}
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text variant="body" numberOfLines={1}>
                    {file.relativePath}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {formatBytes(file.sizeBytes)}
                  </Text>
                </View>
                <Button
                  label="Delete"
                  icon={Trash2}
                  variant="ghost"
                  danger
                  onPress={() => onDelete(file)}
                  disabled={pending}
                />
              </View>
            </Fragment>
          ))}
        </Card>
      )}

      {grants !== null && (
        <Card style={styles.cardGap}>
          <Text variant="bodyStrong">Persisted grants ({grants.length})</Text>
          {grants.length === 0 ? (
            <Text variant="caption" tone="muted">
              None yet.
            </Text>
          ) : (
            grants.map((grant, index) => (
              <Fragment key={grant.uri}>
                {index > 0 && <Divider />}
                <View style={styles.grantRow}>
                  <Text variant="caption" tone="subtle" numberOfLines={2} style={styles.mono}>
                    {grant.uri}
                  </Text>
                  <Text variant="caption" tone="muted">
                    read={String(grant.readable)} write={String(grant.writable)}
                  </Text>
                </View>
              </Fragment>
            ))
          )}
        </Card>
      )}

      {log.length > 0 && (
        <Card tone="sunken" style={styles.cardGap}>
          <Text variant="bodyStrong">Log</Text>
          {log.map((line, index) => (
            <Text key={`${index}-${line}`} variant="caption" tone="muted" style={styles.mono}>
              {line}
            </Text>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardGap: { gap: 4 },
  grantRow: { gap: 2, paddingVertical: 6 },
  itemInfo: { flexShrink: 1, gap: 2 },
  itemRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  mono: { fontFamily: 'monospace' },
  row: { flexDirection: 'row', gap: 8 },
});
