import { useColorScheme, type ViewStyle } from 'react-native';
import {
  type ColorRoles,
  darkColors,
  type ElevationLevel,
  elevationDark,
  elevationLight,
  lightColors,
  radius,
  space,
  type,
} from './tokens.ts';

export { type ColorRoles, type ElevationLevel, radius, space, type } from './tokens.ts';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorRoles;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  elevation: Record<ElevationLevel, ViewStyle>;
}

// The one hook every component uses to reach the design tokens. Follows the OS light/dark setting
// (agent_design.md §2: both modes are first-class) and re-renders when it changes.
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    space,
    radius,
    type,
    elevation: scheme === 'dark' ? elevationDark : elevationLight,
  };
}
