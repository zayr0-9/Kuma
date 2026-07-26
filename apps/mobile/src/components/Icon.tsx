import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/index.ts';

// Standardises every Lucide glyph: consistent size, a rounded 2px stroke, and a colour drawn from a
// semantic role (defaults to muted). Lucide (shared with the desktop app's lucide-react) gives both
// apps pixel-identical icon shapes — the "same product in two places" goal (agent_design.md §1/§4).

type IconTone = 'default' | 'text' | 'accent' | 'onAccent' | 'success' | 'warning' | 'danger';

interface IconProps {
  icon: LucideIcon;
  size?: number;
  tone?: IconTone;
  /** Explicit colour override, when a role doesn't fit (rare — prefer `tone`). */
  color?: string;
  strokeWidth?: number;
}

export function Icon({
  icon: Glyph,
  size = 20,
  tone = 'default',
  color,
  strokeWidth = 2,
}: IconProps): ReactElement {
  const t = useTheme();
  const resolved =
    color ??
    (tone === 'text'
      ? t.colors.text
      : tone === 'accent'
        ? t.colors.accent
        : tone === 'onAccent'
          ? t.colors.onAccent
          : tone === 'success'
            ? t.colors.success
            : tone === 'warning'
              ? t.colors.warning
              : tone === 'danger'
                ? t.colors.danger
                : t.colors.textMuted);
  return <Glyph size={size} color={resolved} strokeWidth={strokeWidth} />;
}
