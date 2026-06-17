import { Platform } from 'react-native';

// Tempo ships a single, dark, sports-performance theme (Whoop/Strava energy):
// near-black backgrounds, near-white text, one electric-blue accent. The key is
// kept as `light` because every screen resolves `Colors.light` directly — and
// `dark` mirrors it so any color-scheme-driven path stays consistently dark.
const tempoDark = {
  // Backgrounds — elevation ramp from the screen base up to fills/tracks
  surface: '#0C0D10',              // screen background (darkest)
  background: '#15181E',           // cards / elevated surfaces
  surfaceContainerLow: '#191C22',  // chips, inputs, secondary cards
  surfaceContainer: '#1F232B',
  surfaceContainerHigh: '#2A2F39', // progress tracks, skeletons (lightest fill)
  // Text
  text: '#F2F3F6',
  textSecondary: '#A6ACBA',
  outline: '#767E8C',
  outlineVariant: '#2B313B',       // hairline borders / dividers
  // Primary (electric blue accent)
  primary: '#3D82F7',
  primaryContainer: '#1E4FD0',
  onPrimary: '#FFFFFF',
  // Secondary
  secondary: '#9BA3AF',
  secondaryContainer: '#232830',
  onSecondary: '#0B0B0D',
  // Error
  error: '#FF6B6B',
  errorContainer: '#3A1414',
  // Semantic tints (used on dark cards)
  primarySoft: 'rgba(61,130,247,0.16)',
  success: '#34D399',
  successSoft: 'rgba(52,211,153,0.16)',
  dangerSoft: 'rgba(255,107,107,0.16)',
  // Legacy aliases used in existing components
  backgroundElement: '#1F232B',
  backgroundSelected: '#232830',
} as const;

export const Colors = {
  light: tempoDark,
  dark: tempoDark,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Typography scale from Stitch DESIGN.md
export const Typography = {
  display: { fontSize: 40, fontWeight: '800' as const, lineHeight: 48, letterSpacing: -0.8 },
  headlineLg: { fontSize: 32, fontWeight: '700' as const, lineHeight: 40, letterSpacing: -0.32 },
  headlineLgMobile: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34, letterSpacing: -0.28 },
  headlineMd: { fontSize: 24, fontWeight: '700' as const, lineHeight: 30, letterSpacing: -0.24 },
  bodyLg: { fontSize: 18, fontWeight: '400' as const, lineHeight: 28 },
  bodyMd: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodySm: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
  labelCaps: { fontSize: 12, fontWeight: '700' as const, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  metricXl: { fontSize: 48, fontWeight: '800' as const, lineHeight: 48, letterSpacing: -1.92 },
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold', mono: 'Menlo' },
  android: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold', mono: 'monospace' },
  default: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold', mono: 'monospace' },
});

// 4px base grid from Stitch DESIGN.md
export const Spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  containerPadding: 20,
  cardGutter: 16,
  // Legacy aliases
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 4,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

// Card shadow (Level 2 elevation from Stitch)
export const CardShadow = {
  shadowColor: '#1A1A1B',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.04,
  shadowRadius: 20,
  elevation: 2,
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
