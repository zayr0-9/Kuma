import type { TextStyle, ViewStyle } from 'react-native';

// Design tokens — the single source of truth for the mobile visual language (agent_design.md
// §7). "Graphite + one spark": a near-monochrome zinc UI where the one accent (a restrained
// blue) appears only on the primary action, so colour reads as meaning, not decoration.
//
// Rules this encodes (agent_design.md §2/§4):
//   - Semantic colour roles, defined once here for light + dark. Components NEVER hard-code hex.
//   - Depth comes from ELEVATION (surfaces float on the z-axis), never gradients, never borders.
//   - `separator` is the only border colour, and only for hairline separators — never on cards,
//     buttons, or any interactive element.

// Raw zinc ramp + signal hues. Private to this file: components consume the semantic roles below,
// not these. Keeping the ramp here lets both modes derive from one palette.
const zinc = {
  50: '#FAFAFA',
  100: '#F4F4F5',
  200: '#E4E4E7',
  300: '#D4D4D8',
  400: '#A1A1AA',
  500: '#71717A',
  600: '#52525B',
  700: '#3F3F46',
  800: '#27272A',
  900: '#18181B',
  950: '#09090B',
  white: '#FFFFFF',
} as const;

// The single spark and the safety signals. Slightly brighter variants in dark for legibility on
// the near-black canvas.
const signal = {
  accentLight: '#2563EB',
  accentLightPressed: '#1D4ED8',
  accentDark: '#3B82F6',
  accentDarkPressed: '#2563EB',
  successLight: '#16A34A',
  successDark: '#22C55E',
  warningLight: '#D97706',
  warningDark: '#F59E0B',
  dangerLight: '#DC2626',
  dangerDark: '#EF4444',
} as const;

// Semantic colour roles. This is the contract components code against.
export interface ColorRoles {
  /** Page background, behind floating surfaces. */
  canvas: string;
  /** A card or any element that floats above the canvas. */
  surface: string;
  /** A well sunk into a surface: inputs, progress tracks, chips. */
  surfaceSunken: string;
  /** A surface raised further up the z-axis (menus, pressed-up controls). In light this equals
   *  `surface` and depth is all shadow; in dark it also lightens, since black shadows barely read. */
  surfaceRaised: string;
  /** Primary text. */
  text: string;
  /** Secondary text and default icon colour. */
  textMuted: string;
  /** Tertiary text: timestamps, captions, fine print. */
  textSubtle: string;
  /** The ONLY border colour, and only for hairline separators. Never on interactive elements. */
  separator: string;
  /** The one accent — primary action only. */
  accent: string;
  /** Accent under press. */
  accentPressed: string;
  /** Text/icons sitting on an accent fill. */
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
}

export const lightColors: ColorRoles = {
  canvas: zinc[50],
  surface: zinc.white,
  surfaceSunken: zinc[100],
  surfaceRaised: zinc.white,
  text: zinc[900],
  textMuted: zinc[500],
  textSubtle: zinc[400],
  separator: zinc[200],
  accent: signal.accentLight,
  accentPressed: signal.accentLightPressed,
  onAccent: zinc.white,
  success: signal.successLight,
  warning: signal.warningLight,
  danger: signal.dangerLight,
};

export const darkColors: ColorRoles = {
  canvas: zinc[950],
  surface: zinc[900],
  surfaceSunken: zinc[800],
  surfaceRaised: zinc[800],
  text: zinc[50],
  textMuted: zinc[400],
  textSubtle: zinc[500],
  separator: zinc[800],
  accent: signal.accentDark,
  accentPressed: signal.accentDarkPressed,
  onAccent: zinc.white,
  success: signal.successDark,
  warning: signal.warningDark,
  danger: signal.dangerDark,
};

// Spacing — 4/8 grid (agent_design.md §4). Named steps so components read intent, not magic numbers.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Corner radii — rounded throughout; `pill` makes circular icon buttons and status pills.
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

// One type scale (agent_design.md §4): display / title / body / caption, plus a strong-body and an
// uppercase section label. System font only — no bundled font (avoids native/CSP concerns).
export const type = {
  display: { fontSize: 28, fontWeight: '700', lineHeight: 34, letterSpacing: -0.4 },
  title: { fontSize: 18, fontWeight: '600', lineHeight: 24, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;

// Elevation — the z-axis system that gives the UI its 3D "float" without gradients or borders.
// Level 0 sits flush; 1 is a resting card; 2 is a raised control (the primary button); 3 is the
// highest float (pressed-up / floating actions). Android reads `elevation`; iOS reads the shadow*
// fields. Dark uses stronger, wider shadows since near-black canvases swallow soft ones — depth
// there is carried mostly by the lighter `surface`/`surfaceRaised` colours, with shadow as accent.
export type ElevationLevel = 0 | 1 | 2 | 3;

const shadow = (
  elevation: number,
  opacity: number,
  radiusPx: number,
  offsetY: number,
): ViewStyle => ({
  elevation,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: offsetY },
  shadowOpacity: opacity,
  shadowRadius: radiusPx,
});

export const elevationLight: Record<ElevationLevel, ViewStyle> = {
  0: { elevation: 0 },
  1: shadow(2, 0.08, 3, 1),
  2: shadow(5, 0.12, 8, 3),
  3: shadow(10, 0.16, 16, 6),
};

export const elevationDark: Record<ElevationLevel, ViewStyle> = {
  0: { elevation: 0 },
  1: shadow(2, 0.4, 4, 1),
  2: shadow(6, 0.5, 10, 4),
  3: shadow(12, 0.6, 18, 8),
};
