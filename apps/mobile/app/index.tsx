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
      <Text>Skeleton build — folders, pairing and transfers arrive with the next phases.</Text>
      <Text>
        Native module:{' '}
        {nativeStatus.ok ? nativeStatus.reply : `not linked (${nativeStatus.reason})`}
      </Text>
      <Link href="/spike-saf" style={styles.link}>
        Open SAF spike
      </Link>
      <Link href="/spike-service" style={styles.link}>
        Open foreground-service spike
      </Link>
      <Link href="/spike-pairing" style={styles.link}>
        Open discovery + pairing spike
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
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
