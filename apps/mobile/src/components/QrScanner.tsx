import { useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera, X } from 'lucide-react-native';
import { Button } from './Button.tsx';
import { Text } from './Text.tsx';
import { useTheme } from '../theme/index.ts';

// Isolated so `expo-camera` (a native module) is imported ONLY when this component is
// actually rendered — the pairing screen lazy-loads it and gates it on the native module
// being present, so a dev client built before expo-camera degrades to paste-only instead of
// crashing. Reads the QR bytes directly, so the `foldersync://` scheme never reaches
// Android's deep-link router. Themed from the design tokens like the rest of the app.
export default function QrScanner({
  onScanned,
  onCancel,
}: {
  onScanned: (data: string) => void;
  onCancel: () => void;
}): ReactElement {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  // onBarcodeScanned fires many times per second — latch the first hit.
  const latched = useRef(false);

  const handle = useCallback(
    (data: string) => {
      if (latched.current) return;
      latched.current = true;
      onScanned(data);
    },
    [onScanned],
  );

  if (!permission) {
    return (
      <Text variant="caption" tone="muted">
        Preparing camera…
      </Text>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.wrap}>
        <Text variant="caption" tone="muted">
          Camera permission is needed to scan the pairing code.
        </Text>
        <View style={styles.row}>
          <Button
            label="Grant camera"
            icon={Camera}
            variant="secondary"
            onPress={() => void requestPermission()}
            block
          />
          <Button label="Cancel" icon={X} variant="ghost" onPress={onCancel} block />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text variant="caption" tone="muted">
        Point at the desktop&apos;s pairing QR.
      </Text>
      <CameraView
        style={[styles.camera, { borderRadius: t.radius.md }]}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(result) => handle(result.data)}
      />
      <Button label="Cancel" icon={X} variant="ghost" onPress={onCancel} block />
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { aspectRatio: 1, overflow: 'hidden', width: '100%' },
  row: { flexDirection: 'row', gap: 8 },
  wrap: { gap: 8 },
});
