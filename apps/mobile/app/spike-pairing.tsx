import { Fragment, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Monitor, MonitorSmartphone, QrCode, ScanLine, TriangleAlert } from 'lucide-react-native';
import { getDiscoveredDesktops, startDiscovery, stopDiscovery } from '../src/native/discovery.ts';
import type { DiscoveredDesktop } from '../src/native/discovery.ts';
import {
  listPairedDevices,
  removePairedDevice,
  startPairingFromQr,
} from '../src/native/pairing.ts';
import type { PairedDevice, PairingResult } from '../src/native/pairing.ts';
import { isNativeLinked } from '../src/native/module.ts';
import { Button, Card, Divider, Icon, Note, Screen, Text } from '../src/components/index.ts';
import { useTheme } from '../src/theme/index.ts';

// Pair a desktop (spec 35 spike 3 + 4, 23, 24): DNS-SD discovery and pinned-TLS pairing. The pairing
// QR is scanned in-app via expo-camera (CameraView reads the bytes directly, so the foldersync://
// scheme never reaches Android's deep-link router — no collision with the dev-client launcher);
// pasting the code is the fallback. This is the phone half of the §5 pairing flow — it shows the
// same desktop names the desktop shows — and speaks the design system (themed tokens, dark-mode).

const DISCOVERY_POLL_MS = 2000;

// expo-camera is a native module — present only in a dev client built with it. Detect it safely
// (null on an older build), and lazy-load the scanner so expo-camera's import only runs when the
// scanner is actually shown (never on a build that lacks the native module, which would crash the
// screen). Degrades to paste-only otherwise.
const cameraNativeAvailable = requireOptionalNativeModule('ExpoCamera') !== null;
const QrScanner = lazy(() => import('../src/components/QrScanner.tsx'));

const REASON_TEXT: Record<Exclude<PairingResult, { ok: true }>['reason'], string> = {
  wrong_scheme: 'Not a FolderSync pairing code.',
  invalid_fields: 'The pairing code is malformed or expired.',
  pin_mismatch: 'The desktop key did not match the code — possible wrong network or tampering.',
  network: 'Could not reach the desktop. Same Wi-Fi?',
  rejected: 'The desktop rejected pairing (code expired or already used).',
  protocol_mismatch: 'The desktop speaks a different protocol version.',
};

export default function PairingSpikeScreen(): ReactElement {
  const t = useTheme();
  const linked = isNativeLinked();
  const [discovering, setDiscovering] = useState(false);
  const [desktops, setDesktops] = useState<DiscoveredDesktop[]>([]);
  const [qr, setQr] = useState('');
  const [paired, setPaired] = useState<PairedDevice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const refreshPaired = useCallback(async () => {
    if (!linked) return;
    try {
      setPaired(await listPairedDevices());
    } catch {
      // Non-fatal for the diagnostics screen.
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

  const doPair = useCallback(
    (payload: string) => {
      void run('Pair', async () => {
        const result = await startPairingFromQr(payload);
        if (result.ok) {
          setMessage(`Paired with ${result.displayName}.`);
          setQr('');
          await refreshPaired();
        } else {
          setMessage(REASON_TEXT[result.reason]);
        }
      });
    },
    [run, refreshPaired],
  );

  const onPair = useCallback(() => doPair(qr.trim()), [doPair, qr]);

  const onScanned = useCallback(
    (data: string) => {
      setScanning(false);
      setQr(data);
      doPair(data);
    },
    [doPair],
  );

  const onRemovePaired = useCallback(
    (deviceId: string) => {
      void run('Remove', async () => {
        await removePairedDevice(deviceId);
        await refreshPaired();
      });
    },
    [run, refreshPaired],
  );

  const pending = busy !== null;

  return (
    <Screen>
      {!linked && (
        <Note tone="warning" icon={TriangleAlert}>
          Native module not linked — rebuild the dev client to include it.
        </Note>
      )}
      {message !== null && <Note tone="muted">{message}</Note>}
      {busy !== null && (
        <Text variant="caption" tone="muted">
          {busy}…
        </Text>
      )}

      <Card style={styles.cardGap}>
        <View style={styles.header}>
          <Icon icon={MonitorSmartphone} size={16} />
          <Text variant="bodyStrong">Discovery</Text>
        </View>
        <View style={styles.row}>
          <Button
            label="Start discovery"
            variant="secondary"
            onPress={onStartDiscovery}
            block
            disabled={!linked || pending || discovering}
          />
          <Button
            label="Stop"
            variant="ghost"
            onPress={onStopDiscovery}
            block
            disabled={!linked || pending || !discovering}
          />
        </View>
        {discovering && desktops.length === 0 && (
          <Text variant="caption" tone="muted">
            Searching the LAN… keep the screen on.
          </Text>
        )}
        {desktops.map((desktop, index) => (
          <Fragment key={desktop.serviceName}>
            {index > 0 && <Divider />}
            <View style={styles.deviceRow}>
              <Icon icon={Monitor} tone="text" />
              <View style={styles.deviceInfo}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {desktop.displayName ?? desktop.serviceName}
                </Text>
                <Text variant="caption" tone="subtle">
                  {desktop.host ?? '—'}:{desktop.port} · v{desktop.protocolVersion ?? '?'} ·{' '}
                  {desktop.tls ? 'tls' : 'no-tls'}
                </Text>
              </View>
            </View>
          </Fragment>
        ))}
      </Card>

      <Card style={styles.cardGap}>
        <View style={styles.header}>
          <Icon icon={QrCode} size={16} />
          <Text variant="bodyStrong">Pair a desktop</Text>
        </View>
        {scanning ? (
          <Suspense
            fallback={
              <Text variant="caption" tone="muted">
                Loading camera…
              </Text>
            }
          >
            <QrScanner onScanned={onScanned} onCancel={() => setScanning(false)} />
          </Suspense>
        ) : (
          <>
            <Text variant="caption" tone="muted">
              {cameraNativeAvailable
                ? 'Scan the pairing QR on your desktop, or paste the foldersync://pair?… code.'
                : 'Paste the foldersync://pair?… code. (Rebuild the dev client to scan in-app.)'}
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: t.colors.surfaceSunken,
                  borderRadius: t.radius.md,
                  color: t.colors.text,
                  padding: t.space.md,
                },
              ]}
              value={qr}
              onChangeText={setQr}
              placeholder="foldersync://pair?v=1&device=…"
              placeholderTextColor={t.colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <View style={styles.row}>
              {cameraNativeAvailable && (
                <Button
                  label="Scan QR"
                  icon={ScanLine}
                  variant="secondary"
                  onPress={() => setScanning(true)}
                  block
                  disabled={!linked || pending}
                />
              )}
              <Button
                label="Pair"
                onPress={onPair}
                block
                disabled={!linked || pending || qr.trim().length === 0}
              />
            </View>
          </>
        )}
      </Card>

      <Card style={styles.cardGap}>
        <Text variant="bodyStrong">Paired desktops ({paired.length})</Text>
        {paired.length === 0 ? (
          <Text variant="caption" tone="muted">
            None yet.
          </Text>
        ) : (
          paired.map((device, index) => (
            <Fragment key={device.deviceId}>
              {index > 0 && <Divider />}
              <View style={styles.deviceRow}>
                <Icon icon={Monitor} tone="text" />
                <View style={styles.deviceInfo}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {device.displayName}
                  </Text>
                  <Text variant="caption" tone="subtle">
                    {device.host}:{device.port}
                  </Text>
                </View>
                <Button
                  label="Remove"
                  variant="ghost"
                  danger
                  onPress={() => onRemovePaired(device.deviceId)}
                  disabled={pending}
                />
              </View>
            </Fragment>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardGap: { gap: 8 },
  deviceInfo: { flex: 1, gap: 2 },
  deviceRow: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 6 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  input: { fontFamily: 'monospace', fontSize: 12, minHeight: 64 },
  row: { flexDirection: 'row', gap: 8 },
});
