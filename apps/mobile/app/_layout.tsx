import { Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme/index.ts';

// Root navigator. The header is themed from the design tokens and follows the OS light/dark setting;
// `headerShadowVisible: false` keeps it flat (depth in this UI is elevation on cards, not a line
// under the bar — agent_design.md §7).
export default function RootLayout(): ReactElement {
  const t = useTheme();
  return (
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
        <Stack.Screen name="transfers" options={{ title: 'Transfers' }} />
        <Stack.Screen name="spike-saf" options={{ title: 'SAF spike' }} />
        <Stack.Screen name="spike-service" options={{ title: 'Service spike' }} />
        <Stack.Screen name="spike-pairing" options={{ title: 'Discovery + pairing spike' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
