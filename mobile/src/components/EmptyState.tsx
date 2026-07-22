// Tempo — illustrated empty states.
//
// Empty screens are moments, not dead ends: a hand-built geometric illustration
// (pure Views — no image assets), a gentle float, one clear next step. Variants
// cover the app's real empty moments; all fade in and drift subtly unless
// Reduce Motion is on.

import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { FadeInView, PressableScale, useReducedMotion } from '@/components/motion'

export type IllustrationKind = 'calendar' | 'barbell' | 'chart' | 'moon' | 'flash' | 'photo'

// ── Floating wrapper ─────────────────────────────────────────────────────────

function Floaty({ children, range = 4, duration = 2600 }: { children: ReactNode; range?: number; duration?: number }) {
  const reduce = useReducedMotion()
  const y = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduce) { y.setValue(0); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -range, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduce, y, range, duration])
  return <Animated.View style={{ transform: [{ translateY: y }] }}>{children}</Animated.View>
}

// ── Illustrations (geometric, brand-warm) ────────────────────────────────────

function Illustration({ kind }: { kind: IllustrationKind }) {
  const C = useTheme()
  const s = useThemedStyles(makeArtStyles)

  const art = (() => {
    switch (kind) {
      case 'barbell':
        return (
          <View style={{ transform: [{ rotate: '-10deg' }] }}>
            <View style={s.barbellRow}>
              <View style={s.plateOuter} />
              <View style={s.plateInner} />
              <View style={s.bar} />
              <View style={s.plateInner} />
              <View style={s.plateOuter} />
            </View>
          </View>
        )
      case 'calendar':
        return (
          <View style={s.calCard}>
            <View style={s.calHeader}>
              <View style={s.calHeaderDot} />
              <View style={[s.calHeaderDot, { width: 22 }]} />
            </View>
            <View style={s.calGrid}>
              {Array.from({ length: 12 }).map((_, i) => (
                i === 9
                  ? <View key={i} style={s.calDayActive} />
                  : <View key={i} style={s.calDay} />
              ))}
            </View>
          </View>
        )
      case 'chart':
        return (
          <View style={s.chartRow}>
            {[16, 26, 20, 34, 46].map((h, i) => (
              <View
                key={i}
                style={[s.chartBar, { height: h }, i === 4 && { backgroundColor: C.primary }]}
              />
            ))}
          </View>
        )
      case 'moon':
        return (
          <View style={{ width: 64, height: 64 }}>
            <View style={s.moonBody} />
            <View style={s.moonBite} />
            <View style={[s.star, { top: 4, right: 2 }]} />
            <View style={[s.star, { bottom: 10, right: -8, width: 5, height: 5 }]} />
          </View>
        )
      case 'flash':
        return (
          <View style={s.flashRing}>
            <Ionicons name="flash" size={30} color={C.primary} />
          </View>
        )
      // Progress Photos used `chart` for want of anything closer, so an empty
      // photo gallery was illustrated with a bar chart — the same art the Weekly
      // Report empty state uses, which reads as the wrong screen. Reuses the
      // ring treatment rather than hand-drawing a frame: same visual weight as
      // `flash`, and the glyph carries the meaning.
      case 'photo':
        return (
          <View style={s.flashRing}>
            <Ionicons name="image" size={30} color={C.primary} />
          </View>
        )
    }
  })()

  return (
    <View style={s.stage}>
      <View style={s.halo} />
      <Floaty>{art}</Floaty>
      {/* Brand sparks — the little rhythm accents floating off the motif */}
      <Floaty range={6} duration={2100}>
        <View style={s.sparkDot} />
      </Floaty>
      <Floaty range={5} duration={3200}>
        <View style={s.sparkSquare} />
      </Floaty>
    </View>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

interface Props {
  kind: IllustrationKind
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
  /** Smaller inline variant for feed slots (vs full-screen center). */
  compact?: boolean
}

export function EmptyState({ kind, title, body, actionLabel, onAction, compact }: Props) {
  const styles = useThemedStyles(makeStyles)
  return (
    <FadeInView style={[styles.wrap, compact && styles.wrapCompact]}>
      <Illustration kind={kind} />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <PressableScale style={styles.cta} onPress={onAction} accessibilityLabel={actionLabel}>
          <Text style={styles.ctaText}>{actionLabel}</Text>
        </PressableScale>
      ) : null}
    </FadeInView>
  )
}

const makeArtStyles = (C: Palette) => StyleSheet.create({
  stage: { width: 130, height: 110, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute', width: 104, height: 104, borderRadius: 52,
    backgroundColor: C.primarySoft,
  },
  sparkDot: {
    position: 'absolute', top: -46, right: -46,
    width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary,
  },
  sparkSquare: {
    position: 'absolute', bottom: -38, left: -50,
    width: 7, height: 7, borderRadius: 2, backgroundColor: C.gold,
    transform: [{ rotate: '35deg' }],
  },

  // Barbell
  barbellRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bar: { width: 54, height: 6, borderRadius: 3, backgroundColor: C.outline },
  plateInner: { width: 8, height: 26, borderRadius: 3, backgroundColor: C.primary },
  plateOuter: { width: 6, height: 18, borderRadius: 3, backgroundColor: C.primaryContainer },

  // Calendar
  calCard: {
    width: 78, height: 66, borderRadius: 10, backgroundColor: C.background,
    borderWidth: 1.5, borderColor: C.outlineVariant, padding: 8, gap: 7,
  },
  calHeader: { flexDirection: 'row', gap: 4 },
  calHeaderDot: { width: 14, height: 4, borderRadius: 2, backgroundColor: C.outlineVariant },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  calDay: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.surfaceContainerHigh },
  calDayActive: { width: 8, height: 8, borderRadius: 3, backgroundColor: C.primary, margin: -1 },

  // Chart
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 50 },
  chartBar: { width: 10, borderRadius: 4, backgroundColor: C.surfaceContainerHigh },

  // Moon
  moonBody: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.surfaceContainerHigh },
  moonBite: {
    position: 'absolute', top: -2, left: 16,
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface,
  },
  star: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold },

  // Flash
  flashRing: {
    width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.primaryLine, backgroundColor: C.background,
  },
})

const makeStyles = (C: Palette) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg, gap: Spacing.xs },
  wrapCompact: { paddingVertical: Spacing.lg },
  title: {
    fontFamily: C.fontDisplay, fontSize: 18, color: C.text,
    letterSpacing: -0.3, textAlign: 'center', marginTop: Spacing.sm,
  },
  body: {
    fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary,
    textAlign: 'center', lineHeight: 20, maxWidth: 300,
  },
  cta: {
    marginTop: Spacing.sm, backgroundColor: C.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary },
})
