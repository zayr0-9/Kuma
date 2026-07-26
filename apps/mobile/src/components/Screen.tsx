import type { ReactElement, ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/index.ts';

// The page frame: the canvas background every screen sits on, plus bottom-safe-area padding and an
// optional pull-to-refresh. The nav header (themed in _layout) owns the top inset.

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  contentStyle,
}: ScreenProps): ReactElement {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const content = [
    styles.content,
    { padding: t.space.lg, paddingBottom: t.space.lg + insets.bottom, gap: t.space.md },
    contentStyle,
  ];

  if (!scroll) {
    return (
      <View style={[styles.canvas, { backgroundColor: t.colors.canvas }, content]}>{children}</View>
    );
  }

  return (
    <ScrollView
      style={[styles.canvas, { backgroundColor: t.colors.canvas }]}
      contentContainerStyle={content}
      refreshControl={
        onRefresh !== undefined ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.textMuted}
            colors={[t.colors.accent]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  content: { flexGrow: 1 },
});
