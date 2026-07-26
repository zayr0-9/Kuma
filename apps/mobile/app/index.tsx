import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { pingNativeModule } from '../src/native/index.ts';

export default function HomeScreen(): ReactElement {
  const nativeStatus = pingNativeModule();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FolderSync</Text>
      <Text>Pair a desktop, add a folder, and it backs up over your LAN.</Text>
      <Text>
        Native module:{' '}
        {nativeStatus.ok ? nativeStatus.reply : `not linked (${nativeStatus.reason})`}
      </Text>
      <Link href="/folders" style={styles.primaryLink}>
        Folders
      </Link>
      <Link href="/transfers" style={styles.link}>
        Transfers
      </Link>
      <Link href="/spike-pairing" style={styles.link}>
        Pair a desktop
      </Link>
      <Text style={styles.diagnostics}>Diagnostics</Text>
      <Link href="/spike-saf" style={styles.link}>
        SAF access
      </Link>
      <Link href="/spike-service" style={styles.link}>
        Foreground service
      </Link>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  link: {
    color: '#1d4ed8',
    fontWeight: '600',
    paddingVertical: 8,
  },
  primaryLink: {
    color: '#1d4ed8',
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 8,
  },
  diagnostics: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
