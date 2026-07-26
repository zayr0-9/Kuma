import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/index.ts';

// The ONLY border in the system (agent_design.md §7): a hairline separator. Never used to outline a
// card, button, or any interactive element — only to divide stacked content within a surface.
export function Divider(): ReactElement {
  const t = useTheme();
  return <View style={[styles.line, { backgroundColor: t.colors.separator }]} />;
}

const styles = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth },
});
