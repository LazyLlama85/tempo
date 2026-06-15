import { Platform } from 'react-native';

export const Colors = {
  light: {
    // Backgrounds
    background: '#FFFFFF',
    surface: '#FCF8F9',
    surfaceContainer: '#F0EDEE',
    surfaceContainerLow: '#F6F3F4',
    surfaceContainerHigh: '#EAE7E8',
    // Text
    text: '#1B1B1C',
    textSecondary: '#414755',
    outline: '#717786',
    outlineVariant: '#C1C6D7',
    // Primary (Tempo Blue)
    primary: '#0058BC',
    primaryContainer: '#0070EB',
    onPrimary: '#FFFFFF',
    // Secondary
    secondary: '#5D5E63',
    secondaryContainer: '#DFDFE4',
    onSecondary: '#FFFFFF',
    // Error
    error: '#BA1A1A',
    errorContainer: '#FFDAD6',
    // Legacy aliases used in existing components
    backgroundElement: '#F0EDEE',
    backgroundSelected: '#DFDFE4',
  },
  dark: {
    background: '#1B1B1C',
    surface: '#242425',
    surfaceContainer: '#2E2E2F',
    surfaceContainerLow: '#282829',
    surfaceContainerHigh: '#383839',
    text: '#E5E2E3',
    textSecondary: '#9497A0',
    outline: '#8B9099',
    outlineVariant: '#414755',
    primary: '#ADC6FF',
    primaryContainer: '#0058BC',
    onPrimary: '#001A41',
    secondary: '#C6C6CB',
    secondaryContainer: '#414347',
    onSecondary: '#2E3035',
    error: '#FFB4AB',
    errorContainer: '#93000A',
    backgroundElement: '#2E2E2F',
    backgroundSelected: '#414347',
  },
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
  ios: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold' },
  android: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold' },
  default: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold' },
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
