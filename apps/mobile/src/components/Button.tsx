import type { ReactElement } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/index.ts';
import { Icon } from './Icon.tsx';
import { Text } from './Text.tsx';

// The product button. Three variants, no borders on any of them (agent_design.md §7): depth is
// elevation, so buttons float above the surface. Pressing sinks the button toward the surface
// (drop a shadow level + a 1px nudge down) for a tactile z-axis feel — never an opacity flash.

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Stretch to fill the row. */
  block?: boolean;
  /** Ghost buttons only: colour the label/icon as a destructive action. */
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  block = false,
  danger = false,
  style,
}: ButtonProps): ReactElement {
  const t = useTheme();

  const restElevation =
    variant === 'primary' ? t.elevation[2] : variant === 'secondary' ? t.elevation[1] : undefined;
  const pressedElevation = variant === 'primary' ? t.elevation[1] : t.elevation[0];

  const iconTone = variant === 'primary' ? 'onAccent' : danger ? 'danger' : 'default';
  const textTone = variant === 'primary' ? 'onAccent' : danger ? 'danger' : 'default';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: t.radius.md, paddingHorizontal: t.space.lg, gap: t.space.sm },
        variant === 'primary' && {
          backgroundColor: pressed ? t.colors.accentPressed : t.colors.accent,
        },
        variant === 'secondary' && {
          backgroundColor: pressed ? t.colors.surfaceSunken : t.colors.surface,
        },
        variant === 'ghost' && {
          backgroundColor: pressed ? t.colors.surfaceSunken : 'transparent',
        },
        variant !== 'ghost' && (pressed ? pressedElevation : restElevation),
        pressed && variant !== 'ghost' && styles.pressedNudge,
        block ? styles.block : styles.inline,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon !== undefined ? <Icon icon={icon} size={18} tone={iconTone} /> : null}
      <Text variant="bodyStrong" tone={textTone}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
  },
  block: { alignSelf: 'stretch', flexGrow: 1 },
  disabled: { opacity: 0.4 },
  inline: { alignSelf: 'flex-start' },
  pressedNudge: { transform: [{ translateY: 1 }] },
});
