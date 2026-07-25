import { useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SpikeButton } from './SpikeButton.tsx';

// Isolated so `expo-camera` (a native module) is imported ONLY when this component is
// actually rendered — the pairing screen lazy-loads it and gates it on the native module
// being present, so a dev client built before expo-camera degrades to paste-only instead of
// crashing. Reads the QR bytes directly, so the `foldersync://` scheme never reaches
// Android's deep-link router.
export default function QrScanner({
  onScanned,
  onCancel,
}: {
  onScanned: (data: string) => void;
  onCancel: () => void;
}): ReactElement {
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
    return <Text style={styles.muted}>Preparing camera…</Text>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.muted}>Camera permission is needed to scan the pairing code.</Text>
        <View style={styles.row}>
          <SpikeButton label="Grant camera" onPress={() => void requestPermission()} />
          <SpikeButton label="Cancel" onPress={onCancel} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.muted}>Point at the desktop&apos;s pairing QR.</Text>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(result) => handle(result.data)}
      />
      <SpikeButton label="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  camera: {
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    width: '100%',
  },
  muted: {
    color: '#6b7280',
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  wrap: {
    gap: 8,
  },
});
