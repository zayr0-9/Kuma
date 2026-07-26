import { Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/index.ts';

// Root navigator. The header is themed from the design tokens and follows the OS light/dark setting;
// `headerShadowVisible: false` keeps it flat (depth in this UI is elevation on cards, not a line
// under the bar — agent_design.md §7). GestureHandlerRootView wraps everything so the gallery's
// pan/zoom gestures (react-native-gesture-handler) work anywhere in the tree.
export default function RootLayout(): ReactElement {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.colors.canvas },
            headerTitleStyle: { color: t.colors.text, fontSize: 18, fontWeight: '600' },
            headerTintColor: t.colors.accent,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: t.colors.canvas },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'FolderSync' }} />
          <Stack.Screen name="folders" options={{ title: 'Folders' }} />
          <Stack.Screen name="gallery" options={{ title: 'Photos' }} />
          <Stack.Screen name="transfers" options={{ title: 'Transfers' }} />
          <Stack.Screen name="spike-saf" options={{ title: 'SAF access' }} />
          <Stack.Screen name="spike-service" options={{ title: 'Foreground service' }} />
          <Stack.Screen name="spike-pairing" options={{ title: 'Pair a desktop' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
