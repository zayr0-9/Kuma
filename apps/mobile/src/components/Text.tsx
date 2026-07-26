import type { ReactElement, ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme/index.ts';

// Themed text. Screens use this instead of RN's Text so every string picks up the one type scale
// and a semantic colour role — no per-screen font sizes or hard-coded hex (agent_design.md §2/§4).

type Variant = 'display' | 'title' | 'body' | 'bodyStrong' | 'caption' | 'label';
type Tone =
  'default' | 'muted' | 'subtle' | 'accent' | 'onAccent' | 'success' | 'warning' | 'danger';

interface TextProps {
  children: ReactNode;
  variant?: Variant;
  tone?: Tone;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}

export function Text({
  children,
  variant = 'body',
  tone = 'default',
  numberOfLines,
  style,
}: TextProps): ReactElement {
  const t = useTheme();
  const color =
    tone === 'default'
      ? t.colors.text
      : tone === 'muted'
        ? t.colors.textMuted
        : tone === 'subtle'
          ? t.colors.textSubtle
          : tone === 'accent'
            ? t.colors.accent
            : tone === 'onAccent'
              ? t.colors.onAccent
              : tone === 'success'
                ? t.colors.success
                : tone === 'warning'
                  ? t.colors.warning
                  : t.colors.danger;
  return (
    <RNText numberOfLines={numberOfLines} style={[t.type[variant], { color }, style]}>
      {children}
    </RNText>
  );
}
