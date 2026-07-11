// Tempo — "How Tempo Works" explainer (interactive, swipeable tutorial).
//
// The Home spotlight tour (lib/tutorial.ts HOME_TOUR_STEPS) shows WHERE things are
// but never defines the core vocabulary a brand-new lifter needs: what a workout
// is, what a split is, and — the thing users most often confused — the difference
// between Tempo GENERATING a workout's exercises/sets/reps and Tempo SCHEDULING
// it onto a day/time. This is that missing definitions layer. It used to be a static
// scroll of stacked cards; it's now a one-concept-at-a-time interactive tutorial
// (swipe or Next), so each idea lands on its own before the next. Shown once for new
// users (see the `shouldShowTip('how_tempo_works')` check on Home), and replayable
// any time from Profile → Settings → Replay App Tour.

import { useRef, useState } from 'react'
import {
  StyleSheet, View, Text, ScrollView, useWindowDimensions,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { useRouter } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { PressableScale, FadeInView } from '@/components/motion'
import { markTipSeen } from '@/lib/tutorial'

interface Section {
  icon: string
  title: string
  body: string
  // Optional illustrative visual key rendered above the copy.
  visual?: 'split' | 'generateSchedule'
}

const SECTIONS: Section[] = [
  {
    icon: 'barbell-outline',
    title: 'A workout',
    body: 'One training session: a list of exercises with sets, reps, and weight. You do one workout per training day.',
  },
  {
    icon: 'repeat-outline',
    title: 'A split',
    body: 'Your recurring weekly pattern — which workout you do on which day (e.g. Push / Pull / Legs / Rest). Tempo can build one for you, or you can create your own in My Splits.',
    visual: 'split',
  },
  {
    icon: 'sparkles',
    title: '“Tempo generates” = the exercises',
    body: 'When Tempo GENERATES a workout, it\'s choosing what to actually do — which exercises, how many sets and reps, and how hard — based on your goal, experience, and recent performance.',
    visual: 'generateSchedule',
  },
  {
    icon: 'calendar',
    title: '“Tempo schedules” = the day & time',
    body: 'When Tempo SCHEDULES a workout, it\'s placing it on your calendar around your real life — your sleep, work, and events. Generating and scheduling are separate: you can build your own workout (homemade) and still let Tempo schedule it, or vice versa.',
  },
  {
    icon: 'create-outline',
    title: 'Adding & editing workouts',
    body: 'Tap "Add a workout" on Home, or "New workout" in Plan, to build one from the Exercise Library — search, filter by muscle or equipment, and add exercises directly. Tap any scheduled workout to move it, edit it, or mark it done.',
  },
  {
    icon: 'today-outline',
    title: 'Your calendar',
    body: 'The calendar on Home shows what\'s scheduled each day. A workout that\'s passed without being done is marked MISSED — no shame, just reschedule it. Connect your real calendar (Settings → Calendar) so Tempo can plan around your actual free time.',
  },
  {
    icon: 'options-outline',
    title: 'Equipment & goals',
    body: 'Change your goal, experience level, equipment, or days per week anytime from Profile — Tempo re-tunes every future workout automatically, no need to start over.',
  },
]

const SPLIT_WEEK = ['Push', 'Pull', 'Legs', 'Rest', 'Push', 'Pull', 'Rest']

export default function HowTempoWorksScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { width } = useWindowDimensions()

  const scrollRef = useRef<ScrollView>(null)
  const [index, setIndex] = useState(0)
  const last = SECTIONS.length - 1

  const close = () => {
    markTipSeen('how_tempo_works')
    router.back()
  }

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(last, i))
    scrollRef.current?.scrollTo({ x: next * width, animated: true })
    setIndex(next)
  }

  const onNext = () => {
    if (index >= last) { close(); return }
    goTo(index + 1)
  }

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width)
    if (i !== index) setIndex(i)
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="How Tempo Works"
        size="sm"
        leading={<View style={{ width: 26 }} />}
        right={<DismissButton kind="x" onPress={close} label="Close" />}
      />

      {/* Progress dots */}
      <View style={styles.dots}>
        {SECTIONS.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === index && styles.dotOn, i < index && styles.dotDone]} />
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        scrollEventThrottle={16}
      >
        {SECTIONS.map((s, i) => (
          <View key={s.title} style={[styles.page, { width }]}>
            <FadeInView key={`${s.title}-${index === i}`} style={styles.pageInner}>
              <View style={styles.iconChip}>
                <Ionicons name={s.icon as any} size={34} color={C.primary} />
              </View>
              <Text style={styles.stepCount}>{i + 1} of {SECTIONS.length}</Text>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>

              {s.visual === 'split' && (
                <View style={styles.splitWeek}>
                  {SPLIT_WEEK.map((d, di) => (
                    <View key={di} style={[styles.splitChip, d === 'Rest' && styles.splitChipRest]}>
                      <Text style={[styles.splitChipText, d === 'Rest' && styles.splitChipTextRest]}>{d}</Text>
                    </View>
                  ))}
                </View>
              )}

              {s.visual === 'generateSchedule' && (
                <View style={styles.genSched}>
                  <View style={styles.genCard}>
                    <Ionicons name="sparkles" size={16} color={C.primary} />
                    <Text style={styles.genCardTitle}>Generate</Text>
                    <Text style={styles.genCardSub}>the exercises</Text>
                  </View>
                  <Ionicons name="add" size={16} color={C.outline} />
                  <View style={styles.genCard}>
                    <Ionicons name="calendar" size={16} color={C.primary} />
                    <Text style={styles.genCardTitle}>Schedule</Text>
                    <Text style={styles.genCardSub}>the day & time</Text>
                  </View>
                </View>
              )}
            </FadeInView>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {index > 0 ? (
          <PressableScale style={styles.backBtn} onPress={() => goTo(index - 1)} activeOpacity={0.85} scaleTo={0.97}>
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </PressableScale>
        ) : (
          <View style={styles.backBtnSpacer} />
        )}
        <PressableScale style={styles.nextBtn} onPress={onNext} activeOpacity={0.85}>
          <Text style={styles.nextBtnText}>{index >= last ? 'Got it' : 'Next'}</Text>
          {index < last && <Ionicons name="arrow-forward" size={18} color={C.onPrimary} />}
        </PressableScale>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: Spacing.md },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: C.surfaceContainerHigh },
  dotOn: { backgroundColor: C.primary, width: 20 },
  dotDone: { backgroundColor: C.primary },
  page: { flex: 1 },
  pageInner: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: Spacing.containerPadding + Spacing.sm, gap: Spacing.sm,
  },
  iconChip: {
    width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  stepCount: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 26, color: C.text, letterSpacing: -0.3, textAlign: 'center', lineHeight: 32 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22, textAlign: 'center' },
  splitWeek: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: Spacing.md },
  splitChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.md,
    backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primarySoft,
  },
  splitChipRest: { backgroundColor: C.surfaceContainerLow, borderColor: C.outlineVariant },
  splitChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  splitChipTextRest: { color: C.textSecondary },
  genSched: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  genCard: {
    alignItems: 'center', gap: 2, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, ...CardShadow,
  },
  genCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, marginTop: 2 },
  genCardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm,
  },
  backBtn: {
    width: 54, height: 54, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnSpacer: { width: 0 },
  nextBtn: {
    flex: 1, height: 54, backgroundColor: C.primary, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  nextBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
