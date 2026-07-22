import { Platform } from 'react-native';

// ── Tempo design language ─────────────────────────────────────────────────────
// One identity, two modes. Tempo is a training *instrument*: near-black ink
// surfaces, ONE electric-blue primary (the brand color), ember for attention/
// heat, gold for records — with tight Inter ExtraBold display type and JetBrains
// Mono numerals. The old classic/craft fork is gone: this is the design, not a
// palette option. Identity lives in the components and motion (pulse mark,
// floating dock, rings, celebrations), not in a paint swap.
//
// Signature moves the components build on:
//   • the pulse — Tempo's metronome motif (wordmark dot, loaders, celebrations)
//   • electric blue — the single, ownable accent; never diluted across the UI
//   • mono numerals — every metric reads like a dial, not body text

// Dark — "Ink". The default: electric blue on near-black.
const inkDark = {
  fontDisplay: 'Inter_800ExtraBold',
  fontDisplayBold: 'Inter_700Bold',
  fontNumeric: 'JetBrainsMono_700Bold',
  // Backgrounds — cool ink elevation ramp
  surface: '#0F1014',
  background: '#181A20',
  surfaceContainerLow: '#14161B',
  surfaceContainer: '#1F232B',
  surfaceContainerHigh: '#262A33',
  // Text
  text: '#F3F4F7',
  textSecondary: '#AFB5C1',
  outline: '#6E7480',
  outlineVariant: '#272B34',
  // Primary — the electric blue (schedule / structure / the brand)
  primary: '#4E8BFF',
  primaryContainer: '#1E4FD0',
  onPrimary: '#FFFFFF',
  primaryBright: '#6BA0FF',
  primaryLine: 'rgba(78,139,255,0.32)',
  // Ember (SECONDARY accent — energy / streaks / overdue / "now"; never body text)
  ember: '#FF6A45',
  emberSoft: 'rgba(255,106,69,0.16)',
  emberLine: 'rgba(255,106,69,0.32)',
  secondary: '#9BA3AF',
  secondaryContainer: '#232830',
  onSecondary: '#0B0B0D',
  error: '#FF6B6B',
  errorContainer: '#3A1414',
  primarySoft: 'rgba(78,139,255,0.14)',
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.16)',
  dangerSoft: 'rgba(255,107,107,0.16)',
  // Gold — records, achievements, milestone moments
  gold: '#D9A13B',
  goldSoft: 'rgba(217,161,59,0.18)',
  // Calendar-event accents
  eventWork: '#EA4335',
  eventPersonal: '#A855F7',
  eventSchool: '#F59E0B',
  // ── Redesign foundation (additive — nothing above changed) ──────────────────
  // Glass / depth. Sparing use on hero cards + sheets; never wall-to-wall.
  glass: 'rgba(255,255,255,0.045)',
  glassBorder: 'rgba(255,255,255,0.09)',
  glassHighlight: 'rgba(255,255,255,0.14)',
  scrim: 'rgba(0,0,0,0.55)',
  // Heavy, SURFACE-tinted scrim for locked/Pro-teaser content. Unlike `scrim`
  // (a neutral dim for modal backdrops) this is opaque enough to make the content
  // underneath genuinely unreadable — a dimmed Pro preview still leaks the answer —
  // while staying light enough in each mode that `text`/`textSecondary` laid on top
  // keep their contrast. Also the Android fallback wherever BlurView can't be trusted.
  scrimHeavy: 'rgba(15,16,20,0.82)',
  // Chart system — axes/grid/labels for the Progress dashboards.
  chartGrid: 'rgba(255,255,255,0.06)',
  chartAxis: '#333A45',
  chartLabel: '#AFB5C1',
  // Semantic states for forecast / readiness / insights: good · caution · risk.
  warning: '#F2B84B',
  warningSoft: 'rgba(242,184,75,0.16)',
  readyHigh: '#22C55E',
  readyMed: '#F2B84B',
  readyLow: '#FF6A45',
  // Soft accent glows — the low-opacity blob behind a single hero ring/metric per
  // screen (premium depth without a native blur). Pair with the `HeroGlow` component.
  primaryGlow: 'rgba(78,139,255,0.22)',
  emberGlow: 'rgba(255,106,69,0.20)',
  goldGlow: 'rgba(217,161,59,0.20)',
  // Legacy aliases used in existing components
  backgroundElement: '#1F232B',
  backgroundSelected: '#232830',
} as const;

// A palette is exactly the shape of the dark one — light must provide every key
// so no component can read an undefined color.
export type Palette = { [K in keyof typeof inkDark]: string };

// Light — "Paper". Warm near-white + the deep electric blue: the editorial read.
const paperLight: Palette = {
  fontDisplay: 'Inter_800ExtraBold',
  fontDisplayBold: 'Inter_700Bold',
  fontNumeric: 'JetBrainsMono_700Bold',
  surface: '#FCF8F9',
  background: '#FFFFFF',
  surfaceContainerLow: '#F6F3F4',
  surfaceContainer: '#F0EDEE',
  surfaceContainerHigh: '#EAE7E8',
  text: '#1B1B1C',
  textSecondary: '#414755',
  outline: '#8A8089',
  outlineVariant: '#E4DFE0',
  primary: '#0058BC',
  primaryContainer: '#D6E4FF',
  onPrimary: '#FFFFFF',
  primaryBright: '#0070EB',
  primaryLine: '#CFE0FA',
  ember: '#FB5733',
  emberSoft: '#FFEBE4',
  emberLine: '#FAD2C6',
  secondary: '#5A6473',
  secondaryContainer: '#E9ECF1',
  onSecondary: '#1B1B1C',
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  primarySoft: '#EFF4FF',
  success: '#16A34A',
  successSoft: '#E7F6EC',
  dangerSoft: '#FFE3E3',
  gold: '#A87A1C',
  goldSoft: '#F2E5C4',
  eventWork: '#EA4335',
  eventPersonal: '#A855F7',
  eventSchool: '#F59E0B',
  // Redesign foundation (additive) — light "Paper" equivalents.
  glass: 'rgba(255,255,255,0.62)',
  glassBorder: 'rgba(20,28,48,0.08)',
  glassHighlight: 'rgba(255,255,255,0.92)',
  scrim: 'rgba(18,22,30,0.34)',
  scrimHeavy: 'rgba(252,248,249,0.88)',
  chartGrid: 'rgba(20,28,48,0.08)',
  chartAxis: '#C7CBD4',
  chartLabel: '#525A68',
  warning: '#B7791F',
  warningSoft: 'rgba(183,121,31,0.14)',
  readyHigh: '#178A44',
  readyMed: '#B7791F',
  readyLow: '#E0451F',
  primaryGlow: 'rgba(0,88,188,0.14)',
  emberGlow: 'rgba(251,87,51,0.12)',
  goldGlow: 'rgba(168,122,28,0.12)',
  backgroundElement: '#F6F3F4',
  backgroundSelected: '#EFF4FF',
};

export type ThemeMode = 'dark' | 'light';
export const Palettes: Record<ThemeMode, Palette> = { dark: inkDark, light: paperLight };

// Legacy export kept so any not-yet-migrated reference stays valid (both point at
// dark; live theming goes through `useTheme()` in `@/theme`).
export const Colors = {
  light: inkDark,
  dark: inkDark,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Typography scale
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
  // The single biggest number on a screen (Tempo Score / Readiness hero).
  metricHero: { fontSize: 64, fontWeight: '800' as const, lineHeight: 62, letterSpacing: -2.6 },
} as const;

// Three type roles (loaded in the root layout):
//   • display — Inter ExtraBold set tight (negative tracking), for big titles /
//               hero headlines / wordmark. Deliberately the same family as body
//               copy: hierarchy comes from weight + size + tracking, not a second
//               typeface. One font file family = faster cold start, no mismatch.
//   • sans    — Inter, for all body / UI / labels / buttons
//   • numeric — JetBrains Mono (tabular), reserved for the LIVE session instrument:
//               the runner's countdown timer + set / weight / reps columns, where
//               tabular alignment matters. Stat cards, tiles, rings and durations
//               (profile, progress, home, quick-workout, reports, celebration) use
//               the DISPLAY face instead — one consistent, premium numeric voice.
export const Fonts = Platform.select({
  ios: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold', display: 'Inter_700Bold', displayBold: 'Inter_800ExtraBold', numeric: 'JetBrainsMono_500Medium', numericBold: 'JetBrainsMono_700Bold', mono: 'Menlo' },
  android: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold', display: 'Inter_700Bold', displayBold: 'Inter_800ExtraBold', numeric: 'JetBrainsMono_500Medium', numericBold: 'JetBrainsMono_700Bold', mono: 'monospace' },
  default: { sans: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold', display: 'Inter_700Bold', displayBold: 'Inter_800ExtraBold', numeric: 'JetBrainsMono_500Medium', numericBold: 'JetBrainsMono_700Bold', mono: 'monospace' },
});

// Motion — shared durations so the whole app moves to one clock.
export const Motion = {
  fast: 160,        // microinteractions: presses, toggles, pips
  base: 240,        // card entrances, expansion
  slow: 360,        // celebrations, rings, hero reveals
  spring: { friction: 6, tension: 120 },   // pop-in spring
  // Additive semantic durations for the redesign motion system.
  micro: 120,       // taps, toggles, chips
  celebrate: 600,   // completion / streak / PR moments
  stagger: 45,      // per-item cascade delay for card/list entrances
} as const;

// 4px base grid
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
  // Semantic roundness system (additive — existing keys unchanged). New
  // components use these so corner radii stay consistent app-wide.
  chip: 10,
  card: 20,
  sheet: 28,
  pill: 9999,
} as const;

// Card shadow (Level 2 elevation)
export const CardShadow = {
  shadowColor: '#1A1A1B',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.05,
  shadowRadius: 20,
  elevation: 2,
};

// Elevation ramp (additive; CardShadow above is kept for existing callers).
// Depth hierarchy for the redesign: e0 flat · e1 resting card · e2 hero/sheet ·
// e3 popover/celebration. Pair e2/e3 with the `glass*` tokens for premium depth.
export const Elevation = {
  e0: {},
  e1: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 2 },
  e2: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 6 },
  e3: { shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.28, shadowRadius: 34, elevation: 12 },
} as const;

// Room screens must leave for the floating tab dock (height + float gap).
export const BottomTabInset = Platform.select({ ios: 96, android: 96 }) ?? 96;
export const MaxContentWidth = 800;
