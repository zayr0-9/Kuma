import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/index.ts';
import { Icon } from './Icon.tsx';
import { Text } from './Text.tsx';

// An inline note — the mobile twin of the desktop `.alert` (agent_design.md §7.7): a sunken well
// with a small tone-coloured icon and caption. Used for the calm "what happened / what to do next"
// lines (§3) — a missing native module, a transient error — so colour stays rare and carries
// meaning. Not a floating card; it sits in the flow like a well.

type Tone = 'muted' | 'success' | 'warning' | 'danger';

const ICON_TONE: Record<Tone, 'default' | 'success' | 'warning' | 'danger'> = {
  muted: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function Note({
  children,
  icon,
  tone = 'muted',
}: {
  children: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}): ReactElement {
  const t = useTheme();
  return (
    <View
      style={[
        styles.note,
        {
          backgroundColor: t.colors.surfaceSunken,
          borderRadius: t.radius.md,
          padding: t.space.md,
          gap: t.space.sm,
        },
      ]}
    >
      {icon !== undefined ? <Icon icon={icon} size={16} tone={ICON_TONE[tone]} /> : null}
      <Text variant="caption" tone={tone} style={styles.text}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { alignItems: 'center', flexDirection: 'row' },
  text: { flex: 1 },
});
