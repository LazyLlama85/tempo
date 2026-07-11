// Tempo — brand primitives.
//
//   • TempoWordmark — the lowercase wordmark with the pulsing metronome dot
//   • TempoPulse    — the 4-bar rhythm mark (loading / celebration accent)
//   • ScreenHeader  — shared masthead: wordmark or title, an optional leading
//                     dismiss affordance, right-side actions, and the signature
//                     amber tick + hairline rule
//   • DismissButton — the leading chevron/X/back affordance for modal & pushed
//                     screens (kills the 18× hand-rolled copies)
//   • HeaderActions — a row wrapper so `right` can hold several actions
//
// The pulse is Tempo's signature motif: training is rhythm, the app keeps time.

import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Spacing } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { useReducedMotion, useScreenFocused } from '@/components/motion'

// ── Wordmark ──────────────────────────────────────────────────────────────────

interface WordmarkProps {
  size?: number
  /** Pulse the dot once when the screen gains focus (default true). */
  pulse?: boolean
  /** Show the runner/clock glyph mark before the wordmark (default true). */
  mark?: boolean
}

export function TempoWordmark({ size = 24, pulse = true, mark = true }: WordmarkProps) {
  const C = useTheme()
  const reduce = useReducedMotion()
  const focused = useScreenFocused()
  const scale = useRef(new Animated.Value(1)).current

  // A double heartbeat on focus — the metronome ticking twice, then resting.
  useEffect(() => {
    if (!pulse || reduce || !focused) return
    const beat = (to: number, dur: number) =>
      Animated.timing(scale, { toValue: to, duration: dur, easing: Easing.out(Easing.quad), useNativeDriver: true })
    const anim = Animated.sequence([
      beat(1.45, 130), beat(1, 150),
      Animated.delay(90),
      beat(1.3, 110), beat(1, 150),
    ])
    anim.start()
    return () => { anim.stop(); scale.setValue(1) }
  }, [focused, pulse, reduce, scale])

  const dot = size * 0.34
  const markSize = size * 1.18
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      {mark && (
        <Image
          source={require('@/assets/images/tempo-glyph.png')}
          style={{ width: markSize, height: markSize, marginRight: size * 0.26, marginBottom: -size * 0.05, tintColor: C.primary }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      )}
      <Text
        style={{ fontFamily: C.fontDisplay, fontSize: size, color: C.text, letterSpacing: -0.8, lineHeight: size * 1.15 }}
        maxFontSizeMultiplier={1.2}
      >
        tempo
      </Text>
      <Animated.View
        style={{
          width: dot, height: dot, borderRadius: dot / 2, backgroundColor: C.primary,
          marginLeft: 3, marginBottom: size * 0.12, transform: [{ scale }],
        }}
      />
    </View>
  )
}

// ── Pulse bars (the rhythm mark) ─────────────────────────────────────────────

interface PulseProps {
  size?: number
  color?: string
  style?: StyleProp<ViewStyle>
  /** Loop while true (loading); false renders the resting mark. */
  playing?: boolean
}

// Four bars beating like a meter. Used as a branded loading state and as a
// celebration accent. Resting pose is a static, recognisable mark.
export function TempoPulse({ size = 28, color, style, playing = true }: PulseProps) {
  const C = useTheme()
  const reduce = useReducedMotion()
  const barColor = color ?? C.primary
  // Resting heights, as fractions of size — an uneven, hand-set rhythm.
  const REST = [0.45, 0.95, 0.62, 0.8]
  const values = useRef(REST.map(() => new Animated.Value(1))).current

  useEffect(() => {
    if (reduce || !playing) {
      values.forEach(v => v.setValue(1))
      return
    }
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 110),
          Animated.timing(v, { toValue: 1.55, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.7, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay((values.length - i) * 60),
        ]),
      ),
    )
    loops.forEach(l => l.start())
    return () => loops.forEach(l => l.stop())
  }, [reduce, playing, values])

  const barW = Math.max(3, Math.round(size * 0.14))
  const gap = Math.max(2, Math.round(size * 0.1))
  return (
    <View style={[{ height: size, flexDirection: 'row', alignItems: 'center', gap }, style]}>
      {REST.map((h, i) => (
        <Animated.View
          key={i}
          style={{
            width: barW,
            height: size * h,
            borderRadius: barW / 2,
            backgroundColor: barColor,
            transform: [{ scaleY: values[i] }],
          }}
        />
      ))}
    </View>
  )
}

// A branded full-width loading block: pulse mark + optional caption.
export function PulseLoader({ caption }: { caption?: string }) {
  const styles = useThemedStyles(makeLoaderStyles)
  return (
    <View style={styles.wrap}>
      <TempoPulse size={30} />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  )
}

const makeLoaderStyles = (C: Palette) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  caption: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
})

// ── Screen header ─────────────────────────────────────────────────────────────

interface HeaderProps {
  /** Big screen title; when omitted the wordmark leads. */
  title?: string
  subtitle?: string
  right?: ReactNode
  /**
   * A leading affordance on the left (dismiss chevron / X / back). When present
   * the header switches to a balanced, centered layout — the title (or wordmark)
   * sits between `leading` and `right`. Typically a <DismissButton />.
   */
  leading?: ReactNode
  /** The amber tick + hairline rule under the masthead (default true). */
  rule?: boolean
  /** 'md' = 24px masthead (root tabs); 'sm' = 18px + no pulse (runner, modals). */
  size?: 'md' | 'sm'
}

// Minimum width reserved on each side in centered mode, so a modal title with an
// empty right slot still lands optically centered (the DismissButton's width).
const HEADER_SIDE = 32

export function ScreenHeader({ title, subtitle, right, leading, rule = true, size = 'md' }: HeaderProps) {
  const styles = useThemedStyles(makeHeaderStyles)
  const centered = leading != null
  const titleStyle = size === 'sm' ? styles.titleSm : styles.title

  const masthead = title ? (
    <>
      <Text style={[titleStyle, centered && styles.centerText]} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, centered && styles.centerText]} numberOfLines={1}>{subtitle}</Text> : null}
    </>
  ) : (
    <>
      <TempoWordmark size={size === 'sm' ? 18 : 24} pulse={size !== 'sm'} />
      {subtitle ? <Text style={[styles.subtitle, centered && styles.centerText]} numberOfLines={1}>{subtitle}</Text> : null}
    </>
  )

  return (
    <View>
      <View style={styles.row}>
        {centered ? (
          <>
            <View style={styles.side}>{leading}</View>
            <View style={styles.center}>{masthead}</View>
            <View style={[styles.side, styles.sideRight]}>{right}</View>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}>{masthead}</View>
            {right}
          </>
        )}
      </View>
      {rule && (
        <View style={styles.ruleRow}>
          <View style={styles.ruleTick} />
          <View style={styles.ruleLine} />
        </View>
      )}
    </View>
  )
}

/** Leading dismiss affordance for modal (chevron/X) and pushed (back) screens. */
export function DismissButton({
  kind = 'chevron', onPress, label = 'Close',
}: { kind?: 'chevron' | 'x' | 'back'; onPress: () => void; label?: string }) {
  const C = useTheme()
  const icon = kind === 'x' ? 'close' : kind === 'back' ? 'chevron-back' : 'chevron-down'
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={26} color={C.text} />
    </TouchableOpacity>
  )
}

/** Row wrapper so a header's `right` slot can hold several actions with a gap. */
export function HeaderActions({ children }: { children: ReactNode }) {
  return <View style={styles_headerActions}>{children}</View>
}
const styles_headerActions: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }

const makeHeaderStyles = (C: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.xs, paddingBottom: Spacing.sm,
  },
  // Centered layout: equal-width sides frame a centered masthead. When the two
  // sides differ in width (e.g. a wide Pause vs a narrow avatar) the masthead is
  // optically — not pixel — centered, matching the runner's old space-between look.
  side: { minWidth: HEADER_SIDE, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  center: { flex: 1, alignItems: 'center' },
  centerText: { textAlign: 'center' },
  title: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.5 },
  titleSm: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  subtitle: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, marginTop: 1 },
  ruleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.containerPadding, marginBottom: Spacing.xs,
  },
  ruleTick: { width: 26, height: 3, borderRadius: 2, backgroundColor: C.primary },
  ruleLine: { flex: 1, height: 1, backgroundColor: C.outlineVariant },
})
