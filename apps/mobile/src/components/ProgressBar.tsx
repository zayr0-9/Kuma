import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/index.ts';

// A sunken track with an accent fill — the one place the accent shows as progress (agent_design.md
// §2: Backing up → accent). Rounded ends, throttled by the caller (never a per-frame animation).
export function ProgressBar({ value, total }: { value: number; total: number }): ReactElement {
  const t = useTheme();
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((value / total) * 100))) : 0;
  return (
    <View
      style={[
        styles.track,
        { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill },
      ]}
    >
      <View
        style={[
          styles.fill,
          { backgroundColor: t.colors.accent, borderRadius: t.radius.pill, width: `${pct}%` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { height: '100%' },
  track: { height: 8, overflow: 'hidden', width: '100%' },
});
