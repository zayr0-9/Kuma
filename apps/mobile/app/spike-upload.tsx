import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { pickDirectory, traverseTree } from '../src/native/saf.ts';
import type { TraversedFile } from '../src/native/saf.ts';
import {
  cancelUpload,
  getUploadStatus,
  listAvailableDestinations,
  registerRoot,
  startUpload,
} from '../src/native/upload.ts';
import type { AvailableDestination, UploadStatus } from '../src/native/upload.ts';
import { isNativeLinked } from '../src/native/module.ts';
import { SpikeButton } from '../src/components/SpikeButton.tsx';

// Spike 5 + roots binding (spec 35, 18, 25.2): pick a folder → bind it to a desktop
// destination → upload one file over resumable tus, straight from its content:// URI. The
// bearer token and pin never leave native. Developer diagnostics screen (agent_design §4),
// not a product surface. Pair first on the discovery + pairing spike.

const POLL_MS = 1000;
const TERMINAL: ReadonlyArray<UploadStatus['state']> = ['committed', 'skipped', 'failed'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export default function UploadSpikeScreen(): ReactElement {
  const linked = isNativeLinked();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [files, setFiles] = useState<TraversedFile[]>([]);
  const [destinations, setDestinations] = useState<AvailableDestination[]>([]);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<TraversedFile | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  // Poll the single upload's status while it is in flight (pull model). Stops on a terminal
  // state so a committed/failed upload does not keep the bridge busy.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snapshot = await getUploadStatus();
        if (cancelled) return;
        setStatus(snapshot);
        if (TERMINAL.includes(snapshot.state)) setPolling(false);
      } catch {
        // transient — keep polling
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [polling]);

  const onPickFolder = useCallback(() => {
    void run('Pick folder', async () => {
      const picked = await pickDirectory();
      if (picked.cancelled) return;
      setFolderName(picked.displayName);
      setRootId(null);
      const result = await traverseTree(picked.treeUri);
      setFiles(result.sample);
      setSelectedFile(result.sample[0] ?? null);
      setMessage(
        `Traversed ${result.fileCount} files (${formatBytes(result.totalBytes)}); showing ${result.sample.length}.`,
      );
    });
  }, [run]);

  const onLoadDestinations = useCallback(() => {
    void run('Load destinations', async () => {
      const result = await listAvailableDestinations();
      if (!result.ok) {
        setMessage(
          result.reason === 'not_paired'
            ? 'Pair a desktop first (discovery + pairing spike).'
            : `Could not list destinations: ${result.reason}`,
        );
        return;
      }
      setDestinations(result.destinations);
      if (result.destinations.length === 0) {
        setMessage('No unbound destinations. Add one on the desktop ("Add folder").');
      }
    });
  }, [run]);

  const onRegister = useCallback(() => {
    if (mappingId === null || folderName === null) return;
    void run('Register root', async () => {
      // Spike defaults keep the test file safe: keep on phone, never mirror deletions.
      const result = await registerRoot(
        mappingId,
        folderName,
        'keep_on_phone',
        'preserve_desktop_copy',
      );
      if (!result.ok) {
        setMessage(`Register failed: ${result.reason}`);
        return;
      }
      setRootId(result.rootId);
      setMessage(`Bound "${folderName}" to the destination. Ready to upload.`);
    });
  }, [run, mappingId, folderName]);

  const onUpload = useCallback(() => {
    if (rootId === null || selectedFile === null) return;
    void run('Start upload', async () => {
      const file = selectedFile;
      const result = await startUpload(
        rootId,
        file.documentUri,
        file.relativePath,
        file.sizeBytes,
        file.mimeType,
        file.lastModifiedMs,
      );
      if (!result.started) {
        setMessage(`Upload did not start: ${result.reason}`);
        return;
      }
      setStatus(null);
      setPolling(true);
    });
  }, [run, rootId, selectedFile]);

  const onCancel = useCallback(() => {
    void run('Cancel upload', async () => {
      await cancelUpload();
    });
  }, [run]);

  const progress =
    status !== null && status.expectedSize > 0
      ? Math.min(100, Math.round((status.bytesUploaded / status.expectedSize) * 100))
      : 0;
  const active = status !== null && !TERMINAL.includes(status.state);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Upload spike (5) + roots binding</Text>
      {!linked && (
        <Text style={styles.warning}>
          Native module not linked — rebuild the dev client to include it.
        </Text>
      )}
      {message !== null && <Text style={styles.message}>{message}</Text>}
      {busy !== null && <Text style={styles.muted}>{busy}…</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>1 · Folder</Text>
        <SpikeButton
          label="Pick folder"
          onPress={onPickFolder}
          disabled={!linked || busy !== null}
        />
        {folderName !== null && (
          <Text style={styles.muted}>
            {folderName} · {files.length} files listed
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>2 · Desktop destination</Text>
        <SpikeButton
          label="Load destinations"
          onPress={onLoadDestinations}
          disabled={!linked || busy !== null}
        />
        {destinations.map((destination) => (
          <View key={destination.mappingId} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text style={mappingId === destination.mappingId ? styles.strong : undefined}>
                {destination.displayName}
              </Text>
              <Text style={styles.muted}>
                {destination.destinationAvailable
                  ? destination.freeBytes !== null
                    ? `${formatBytes(destination.freeBytes)} free`
                    : 'available'
                  : 'unavailable'}
              </Text>
            </View>
            <SpikeButton
              label={mappingId === destination.mappingId ? 'Selected' : 'Select'}
              onPress={() => setMappingId(destination.mappingId)}
              disabled={busy !== null}
            />
          </View>
        ))}
        <SpikeButton
          label="Bind folder → destination"
          onPress={onRegister}
          disabled={!linked || busy !== null || mappingId === null || folderName === null}
        />
        {rootId !== null && <Text style={styles.muted}>Bound (rootId {rootId.slice(0, 8)}…)</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>3 · File to upload</Text>
        {files.length === 0 ? (
          <Text style={styles.muted}>Pick a folder with at least one file.</Text>
        ) : (
          files.slice(0, 15).map((file) => (
            <View key={file.documentUri} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text
                  numberOfLines={1}
                  style={selectedFile?.documentUri === file.documentUri ? styles.strong : undefined}
                >
                  {file.relativePath}
                </Text>
                <Text style={styles.muted}>{formatBytes(file.sizeBytes)}</Text>
              </View>
              <SpikeButton
                label={selectedFile?.documentUri === file.documentUri ? 'Selected' : 'Select'}
                onPress={() => setSelectedFile(file)}
                disabled={busy !== null}
              />
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>4 · Transfer</Text>
        <View style={styles.row}>
          <SpikeButton
            label="Upload"
            onPress={onUpload}
            disabled={
              !linked || busy !== null || rootId === null || selectedFile === null || active
            }
          />
          <SpikeButton label="Cancel" onPress={onCancel} disabled={!active} />
        </View>
        {status !== null && (
          <>
            <Text style={styles.strong}>
              {status.state}
              {status.reason !== null ? ` · ${status.reason}` : ''}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.muted}>
              {formatBytes(status.bytesUploaded)} / {formatBytes(status.expectedSize)} ({progress}%)
              {status.fileName !== null ? ` · ${status.fileName}` : ''}
            </Text>
            {status.remoteVersionId !== null && (
              <Text style={styles.muted}>
                remoteVersionId {status.remoteVersionId.slice(0, 8)}…
              </Text>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    gap: 8,
    padding: 12,
  },
  cardTitle: {
    fontWeight: '600',
  },
  container: {
    gap: 12,
    padding: 16,
  },
  itemInfo: {
    flexShrink: 1,
    gap: 2,
  },
  itemRow: {
    alignItems: 'center',
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  message: {
    color: '#1f2933',
  },
  muted: {
    color: '#6b7280',
    fontSize: 13,
  },
  progressFill: {
    backgroundColor: '#1d4ed8',
    height: '100%',
  },
  progressTrack: {
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
    width: '100%',
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
