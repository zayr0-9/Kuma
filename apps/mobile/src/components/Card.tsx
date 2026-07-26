import type { ReactElement, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { type ElevationLevel, useTheme } from '../theme/index.ts';

// A surface that floats above the canvas. No border (agent_design.md §7) — separation from the page
// is elevation + the surface colour, nothing else. `tone="sunken"` inverts it into a well (inputs,
// nested rows) that sits below the surface instead of floating.

interface CardProps {
  children: ReactNode;
  elevation?: ElevationLevel;
  tone?: 'surface' | 'sunken';
  padding?: keyof ReturnType<typeof useTheme>['space'] | 'none';
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  elevation = 1,
  tone = 'surface',
  padding = 'lg',
  style,
}: CardProps): ReactElement {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: tone === 'sunken' ? t.colors.surfaceSunken : t.colors.surface,
          borderRadius: t.radius.lg,
          padding: padding === 'none' ? 0 : t.space[padding],
        },
        tone === 'surface' ? t.elevation[elevation] : t.elevation[0],
        style,
      ]}
    >
      {children}
    </View>
  );
}
