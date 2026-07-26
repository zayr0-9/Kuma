import type { ReactElement } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/index.ts';
import { Icon } from './Icon.tsx';

// A circular, icon-only control (agent_design.md §7: rounded/circular). Same float-and-sink press
// behaviour as Button. Used for compact per-item actions (retry, remove) where a label would crowd.

type Variant = 'primary' | 'secondary' | 'ghost';

interface IconButtonProps {
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: Variant;
  danger?: boolean;
  disabled?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'secondary',
  danger = false,
  disabled = false,
  size = 44,
  style,
}: IconButtonProps): ReactElement {
  const t = useTheme();
  const iconTone = variant === 'primary' ? 'onAccent' : danger ? 'danger' : 'default';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: t.radius.pill },
        variant === 'primary' && {
          backgroundColor: pressed ? t.colors.accentPressed : t.colors.accent,
        },
        variant === 'secondary' && {
          backgroundColor: pressed ? t.colors.surfaceSunken : t.colors.surface,
        },
        variant === 'ghost' && {
          backgroundColor: pressed ? t.colors.surfaceSunken : 'transparent',
        },
        variant === 'secondary' && (pressed ? t.elevation[0] : t.elevation[1]),
        variant === 'primary' && (pressed ? t.elevation[1] : t.elevation[2]),
        pressed && variant !== 'ghost' && styles.pressedNudge,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon icon={icon} size={20} tone={iconTone} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressedNudge: { transform: [{ translateY: 1 }] },
});
