import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getDiscoveredDesktops, startDiscovery, stopDiscovery } from '../src/native/discovery.ts';
import type { DiscoveredDesktop } from '../src/native/discovery.ts';
import {
  listPairedDevices,
  removePairedDevice,
  startPairingFromQr,
} from '../src/native/pairing.ts';
import type { PairedDevice, PairingResult } from '../src/native/pairing.ts';
import { isNativeLinked } from '../src/native/module.ts';
import { SpikeButton } from '../src/components/SpikeButton.tsx';

// Spike 3 + 4 diagnostic harness (spec 35, 23, 24): DNS-SD discovery and pinned-TLS pairing.
// In-app camera QR scanning is deferred to the Phase-1 pairing UI — for the spike, paste the
// desktop's `foldersync://pair?...` string (scan the desktop QR with any QR reader to copy
// it). Developer diagnostics screen (agent_design §4), not a product surface.

const DISCOVERY_POLL_MS = 2000;

const REASON_TEXT: Record<Exclude<PairingResult, { ok: true }>['reason'], string> = {
  wrong_scheme: 'Not a FolderSync pairing code.',
  invalid_fields: 'The pairing code is malformed or expired.',
  pin_mismatch: 'The desktop key did not match the code — possible wrong network or tampering.',
  network: 'Could not reach the desktop. Same Wi-Fi?',
  rejected: 'The desktop rejected pairing (code expired or already used).',
  protocol_mismatch: 'The desktop speaks a different protocol version.',
};

export default function PairingSpikeScreen(): ReactElement {
  const linked = isNativeLinked();
  const [discovering, setDiscovering] = useState(false);
  const [desktops, setDesktops] = useState<DiscoveredDesktop[]>([]);
  const [qr, setQr] = useState('');
  const [paired, setPaired] = useState<PairedDevice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshPaired = useCallback(async () => {
    if (!linked) return;
    try {
      setPaired(await listPairedDevices());
    } catch {
      // Non-fatal for the harness.
    }
  }, [linked]);

  useEffect(() => {
    void refreshPaired();
  }, [refreshPaired]);

  // Poll discovered desktops only while discovery is active.
  useEffect(() => {
    if (!discovering) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const found = await getDiscoveredDesktops();
        if (!cancelled) setDesktops(found);
      } catch {
        // ignore transient errors
      }
    };
    void tick();
    const id = setInterval(() => void tick(), DISCOVERY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [discovering]);

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

  const onStartDiscovery = useCallback(() => {
    void run('Start discovery', async () => {
      await startDiscovery();
      setDiscovering(true);
    });
  }, [run]);

  const onStopDiscovery = useCallback(() => {
    void run('Stop discovery', async () => {
      await stopDiscovery();
      setDiscovering(false);
    });
  }, [run]);

  const onPair = useCallback(() => {
    void run('Pair', async () => {
      const result = await startPairingFromQr(qr.trim());
      if (result.ok) {
        setMessage(`Paired with ${result.displayName}.`);
        setQr('');
        await refreshPaired();
      } else {
        setMessage(REASON_TEXT[result.reason]);
      }
    });
  }, [run, qr, refreshPaired]);

  const onRemovePaired = useCallback(
    (deviceId: string) => {
      void run('Remove', async () => {
        await removePairedDevice(deviceId);
        await refreshPaired();
      });
    },
    [run, refreshPaired],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Discovery + pairing spike (3 + 4)</Text>
      {!linked && (
        <Text style={styles.warning}>
          Native module not linked — rebuild the dev client to include it.
        </Text>
      )}
      {message !== null && <Text style={styles.message}>{message}</Text>}
      {busy !== null && <Text style={styles.muted}>{busy}…</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Discovery (spike 3)</Text>
        <View style={styles.row}>
          <SpikeButton
            label="Start discovery"
            onPress={onStartDiscovery}
            disabled={!linked || busy !== null || discovering}
          />
          <SpikeButton
            label="Stop"
            onPress={onStopDiscovery}
            disabled={!linked || busy !== null || !discovering}
          />
        </View>
        {discovering && desktops.length === 0 && (
          <Text style={styles.muted}>Searching the LAN… keep the screen on.</Text>
        )}
        {desktops.map((desktop) => (
          <View key={desktop.serviceName} style={styles.itemRow}>
            <Text style={styles.strong}>{desktop.displayName ?? desktop.serviceName}</Text>
            <Text style={styles.muted}>
              {desktop.host ?? '—'}:{desktop.port} · v{desktop.protocolVersion ?? '?'} ·{' '}
              {desktop.tls ? 'tls' : 'no-tls'}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pair (spike 4)</Text>
        <Text style={styles.muted}>
          Paste the desktop&apos;s foldersync://pair?… code (scan its QR with any reader to copy).
        </Text>
        <TextInput
          style={styles.input}
          value={qr}
          onChangeText={setQr}
          placeholder="foldersync://pair?v=1&device=…"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <SpikeButton
          label="Pair"
          onPress={onPair}
          disabled={!linked || busy !== null || qr.trim().length === 0}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Paired desktops ({paired.length})</Text>
        {paired.length === 0 ? (
          <Text style={styles.muted}>None yet.</Text>
        ) : (
          paired.map((device) => (
            <View key={device.deviceId} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.strong}>{device.displayName}</Text>
                <Text style={styles.muted}>
                  {device.host}:{device.port}
                </Text>
              </View>
              <SpikeButton
                label="Remove"
                onPress={() => onRemovePaired(device.deviceId)}
                disabled={busy !== null}
              />
            </View>
          ))
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
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
    borderRadius: 6,
    borderWidth: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    minHeight: 64,
    padding: 8,
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
