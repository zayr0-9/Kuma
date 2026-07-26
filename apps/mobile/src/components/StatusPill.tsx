import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  CircleAlert,
  CircleCheck,
  CloudOff,
  type LucideIcon,
  Pause,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react-native';
import { useTheme } from '../theme/index.ts';
import { Icon } from './Icon.tsx';
import { Text } from './Text.tsx';

// The one status system, shared with the desktop app (agent_design.md §2). A pill sits on a neutral
// sunken chip; the small icon + label carry the colour role, so colour stays rare and meaningful.

export type StatusKind = 'upToDate' | 'backingUp' | 'waiting' | 'paused' | 'attention' | 'error';

type Tone = 'success' | 'accent' | 'muted' | 'warning' | 'danger';

const MAP: Record<StatusKind, { label: string; icon: LucideIcon; tone: Tone }> = {
  upToDate: { label: 'Up to date', icon: CircleCheck, tone: 'success' },
  backingUp: { label: 'Backing up', icon: RefreshCw, tone: 'accent' },
  waiting: { label: 'Waiting for desktop', icon: CloudOff, tone: 'muted' },
  paused: { label: 'Paused', icon: Pause, tone: 'muted' },
  attention: { label: 'Needs attention', icon: TriangleAlert, tone: 'warning' },
  error: { label: 'Error', icon: CircleAlert, tone: 'danger' },
};

const ICON_TONE: Record<Tone, 'success' | 'accent' | 'default' | 'warning' | 'danger'> = {
  success: 'success',
  accent: 'accent',
  muted: 'default',
  warning: 'warning',
  danger: 'danger',
};

export function StatusPill({ kind }: { kind: StatusKind }): ReactElement {
  const t = useTheme();
  const { label, icon, tone } = MAP[kind];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: t.colors.surfaceSunken,
          borderRadius: t.radius.pill,
          gap: t.space.xs,
          paddingHorizontal: t.space.sm,
        },
      ]}
    >
      <Icon icon={icon} size={13} tone={ICON_TONE[tone]} />
      <Text variant="caption" tone={tone} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600' },
  pill: { alignItems: 'center', flexDirection: 'row', paddingVertical: 3 },
});
