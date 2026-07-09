import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { supabase } from '@/lib/supabase'
import { recordWorkoutFeedback, refreshAdaptation, type WorkoutFeel } from '@/lib/adaptation'
import { maybePromoteExperience, LEVEL_UP_COPY, type ExperiencePromotion } from '@/lib/experienceProgression'
import { track } from '@/lib/analytics'
import { buildWrappedCards, type WrappedCard } from '@/lib/wrapped'
import { computeWeeklyReport, type WeeklyReport } from '@/lib/weeklyReport'
import { detectSessionPRs, prLine, type SessionPR } from '@/lib/prs'
import { useWeightUnit } from '@/lib/units'
import { ShareCardSheet } from '@/components/ShareCardSheet'
import { PopIn, FadeInView, PressableScale } from '@/components/motion'
import * as haptics from '@/lib/haptics'
import { ConfettiBurst, CountUp } from '@/components/celebration'
import { AnimatedRing } from '@/components/AnimatedRing'


const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'muscle-building',
  fat_loss: 'fat-loss',
  strength: 'strength',
  general_fitness: 'fitness',
  athletic: 'athletic',
}

export default function WorkoutCompleteScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { minutes, quick, logId } = useLocalSearchParams<{ minutes?: string; quick?: string; logId?: string }>()
  const isQuick = quick === '1'
  const mins = Number(minutes) || 0

  const { stats, refetch } = useProgressStats(userId)
  const unit = useWeightUnit()
  const [feel, setFeel] = useState<WorkoutFeel | null>(null)
  const [cards, setCards] = useState<WrappedCard[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [prs, setPrs] = useState<SessionPR[]>([])
  const [promotion, setPromotion] = useState<ExperiencePromotion | null>(null)

  // Stats were just mutated by completing the session — pull the fresh numbers so
  // the streak / consistency / weekly figures reflect this workout.
  useEffect(() => { refetch() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The session is logged by the time this screen mounts — record it once.
  useEffect(() => {
    track('session_end', { type: isQuick ? 'quick' : 'planned', duration_min: mins || undefined })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A PR deserves a second, firmer buzz on top of the completion haptic.
  useEffect(() => {
    if (prs.length > 0) haptics.success()
  }, [prs.length])

  // Build the shareable cards + this week's momentum + any PRs from this session.
  useEffect(() => {
    if (!userId) return
    buildWrappedCards(supabase, userId).then(setCards).catch(() => setCards([]))
    computeWeeklyReport(supabase, userId).then(setReport).catch(() => {})
    detectSessionPRs(supabase, userId, logId || undefined).then(setPrs).catch(() => {})
  }, [userId, logId])

  // The "you earned it" moment: with this session banked, has the user graduated to
  // a harder experience level? If so, the plan was already re-stamped — celebrate it
  // and refresh the profile so the whole app reflects the new level. Best-effort.
  useEffect(() => {
    if (!userId) return
    maybePromoteExperience(supabase, userId)
      .then((p) => {
        if (!p) return
        setPromotion(p)
        track('experience_promoted', { from: p.from, to: p.to })
        refreshProfile().catch(() => {})
      })
      .catch(() => {})
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFeel = async (f: WorkoutFeel) => {
    setFeel(f)
    track('workout_feedback_submitted', { feel: f })
    if (!userId) return
    await recordWorkoutFeedback(supabase, userId, f)
    // Let this feedback feed the mesocycle: repeated "too hard" can flip the
    // coming weeks into recovery/deload. Best-effort, never blocks the UI.
    refreshAdaptation(supabase, userId).catch(() => {})
  }

  const FEEL_OPTIONS: { key: WorkoutFeel; label: string; icon: string }[] = [
    { key: 'too_easy', label: 'Too easy', icon: 'flash-outline' },
    { key: 'just_right', label: 'Just right', icon: 'checkmark-circle-outline' },
    { key: 'too_hard', label: 'Too hard', icon: 'flame-outline' },
  ]
  const feelConfirm: Record<WorkoutFeel, string> = {
    too_easy: "Got it — we'll add a set to each lift next session to push you.",
    just_right: 'Perfect — your plan stays right where it is.',
    too_hard: "Noted — we'll ease back the volume next time so you recover.",
  }

  const goalLabel = GOAL_LABELS[profile?.goal ?? 'general_fitness'] ?? 'fitness'
  const weeklyTarget = profile?.days_per_week ?? 3
  const weekPct = Math.min(100, Math.round((stats.thisWeek / weeklyTarget) * 100))

  if (!session) return <Redirect href="/sign-in" />

  // Momentum lead — make people *feel* progress, not just "Workout Complete".
  // Prefer the most motivating true statement we can make from this week's data.
  const lead = (() => {
    if (report && report.missed > 0 && report.workouts > 0) {
      return `You trained ${report.workouts} day${report.workouts === 1 ? '' : 's'} this week despite missing ${report.missed} — Tempo adjusted your plan to keep you on track.`
    }
    if (report && report.volumeDeltaPct != null && report.volumeDeltaPct > 0) {
      return `${report.volumeDeltaPct}% more volume than last week. You're building real momentum.`
    }
    if (stats.streak > 1) {
      return `${stats.streak} sessions in a row — momentum is on your side.`
    }
    return isQuick
      ? `${mins} minutes completed. You stayed on track with your ${goalLabel} goal.`
      : `Session complete. Every rep moves your ${goalLabel} goal forward.`
  })()

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* The moment of celebration — confetti falls once as the summary lands */}
      <ConfettiBurst count={prs.length > 0 ? 40 : 26} />
      {/* A bigger, gold-tinted second fall the instant a level-up lands */}
      {promotion && <ConfettiBurst count={72} colors={[C.gold, C.primary, C.primaryBright, C.success]} />}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <PopIn style={styles.badge}>
          <Ionicons name="checkmark" size={44} color={C.onPrimary} />
        </PopIn>
        <FadeInView delay={120}><Text style={styles.title}>Nice work.</Text></FadeInView>
        <FadeInView delay={200}><Text style={styles.lead}>{lead}</Text></FadeInView>

        {/* Level up — the plan grew with you. The biggest moment on the screen. */}
        {promotion && (
          <PopIn delay={240} style={styles.levelCard}>
            <View style={styles.levelBadge}>
              <Ionicons name="trending-up" size={26} color="#1a1a1a" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelTag}>LEVEL UP</Text>
              <Text style={styles.levelTitle}>{LEVEL_UP_COPY[promotion.to as 'intermediate' | 'advanced'].title}</Text>
              <Text style={styles.levelBody}>{LEVEL_UP_COPY[promotion.to as 'intermediate' | 'advanced'].body}</Text>
            </View>
          </PopIn>
        )}

        {/* PRs — celebrate them aggressively */}
        {prs.length > 0 && (
          <PopIn delay={260} style={styles.prCard}>
            <View style={styles.prHeader}>
              <Ionicons name="trophy" size={18} color="#fff" />
              <Text style={styles.prHeaderText}>{prs.length === 1 ? 'NEW PERSONAL RECORD' : `${prs.length} NEW PERSONAL RECORDS`}</Text>
            </View>
            {prs.slice(0, 3).map((pr) => (
              <View key={pr.exercise + pr.kind} style={styles.prRow}>
                <Ionicons name="arrow-up-circle" size={16} color="#fff" />
                <Text style={styles.prText}>{prLine(pr, unit)}</Text>
              </View>
            ))}
          </PopIn>
        )}

        {/* Streak impact — the number ticks up to today */}
        <FadeInView delay={280} style={[styles.card, styles.streakCard]}>
          <View style={styles.streakRow}>
            <Ionicons name="flame" size={22} color="#fff" />
            <Text style={styles.streakTag}>STREAK</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <CountUp value={stats.streak} delay={500} duration={700} style={styles.streakNum} />
            <Text style={styles.streakUnit}>{stats.streak === 1 ? 'session' : 'sessions'}</Text>
          </View>
          <Text style={styles.streakCaption}>
            {stats.streak > 1
              ? `That's ${stats.streak} sessions in a row with no misses. Rest days don't break it — missed ones do.`
              : 'Your streak starts now — complete your next scheduled session to build it.'}
          </Text>
        </FadeInView>

        {/* Stat tiles + the weekly ring */}
        <FadeInView delay={360} style={styles.tileRow}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>CONSISTENCY</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <CountUp value={stats.consistency_pct} delay={600} style={styles.tileValue} />
              <Text style={styles.tileValue}>%</Text>
            </View>
            <Text style={styles.tileSub}>{stats.deltaStr}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>DURATION</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <CountUp value={mins} delay={600} style={styles.tileValue} />
              <Text style={styles.tileValueUnit}> min</Text>
            </View>
            <Text style={styles.tileSub}>logged today</Text>
          </View>
        </FadeInView>

        {/* Weekly target — a ring that sweeps to where this session put you */}
        <FadeInView delay={430} style={[styles.card, styles.weekCard]}>
          <AnimatedRing
            value={weekPct}
            size={104}
            stroke={11}
            delay={650}
            color={weekPct >= 100 ? C.success : C.primary}
            holeColor={C.background}
          >
            <Text style={styles.ringValue}>{stats.thisWeek}<Text style={styles.ringUnit}>/{weeklyTarget}</Text></Text>
          </AnimatedRing>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.weekLabel}>WEEKLY TARGET</Text>
            <Text style={styles.weekCaption}>
              {weekPct >= 100
                ? 'Full weekly target hit — outstanding. Anything more is bonus ground.'
                : `${stats.thisWeek} of ${weeklyTarget} sessions down. The week is yours to win.`}
            </Text>
          </View>
        </FadeInView>

        {/* Difficulty check-in — coarse signal that tunes the next session's volume */}
        <View style={styles.card}>
          <Text style={styles.weekLabel}>HOW DID THAT FEEL?</Text>
          {feel ? (
            <View style={styles.feelDoneRow}>
              <Ionicons name="checkmark-circle" size={18} color={C.primary} />
              <Text style={styles.feelConfirm}>{feelConfirm[feel]}</Text>
            </View>
          ) : (
            <View style={styles.feelRow}>
              {FEEL_OPTIONS.map((o) => (
                <PressableScale key={o.key} style={styles.feelBtn} onPress={() => handleFeel(o.key)} scaleTo={0.92}>
                  <Ionicons name={o.icon as any} size={20} color={C.primary} />
                  <Text style={styles.feelBtnText}>{o.label}</Text>
                </PressableScale>
              ))}
            </View>
          )}
        </View>

        {isQuick && (
          <View style={styles.noteBox}>
            <Ionicons name="bulb-outline" size={16} color={C.primary} style={{ marginTop: 1 }} />
            <Text style={styles.noteText}>
              Short sessions add up. Showing up on a busy day protects everything you've built —
              that's the whole point of Tempo.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {cards.length > 0 && (
          <PressableScale style={styles.shareBtn} onPress={() => { track('share_card_opened'); setShareOpen(true) }} scaleTo={0.97}>
            <Ionicons name="share-outline" size={18} color={C.primary} />
            <Text style={styles.shareBtnText}>Share a card</Text>
          </PressableScale>
        )}
        <PressableScale style={styles.doneBtn} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.doneBtnText}>Done</Text>
        </PressableScale>
      </View>

      <ShareCardSheet visible={shareOpen} cards={cards} onClose={() => setShareOpen(false)} />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.xl, paddingBottom: 120, gap: Spacing.md, alignItems: 'stretch' },
  badge: {
    width: 88, height: 88, borderRadius: Radius.full, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    shadowColor: '#4E8BFF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 24, elevation: 8,
  },
  title: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -0.5, textAlign: 'center', marginTop: Spacing.sm },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xs },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.xs },
  streakCard: { backgroundColor: C.primary, borderColor: C.primary },

  levelCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primary, borderRadius: Radius.xl, padding: Spacing.lg, marginTop: Spacing.xs,
    shadowColor: '#4E8BFF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.34, shadowRadius: 22, elevation: 9,
  },
  levelBadge: {
    width: 52, height: 52, borderRadius: Radius.full, backgroundColor: C.gold,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.gold, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 4,
  },
  levelTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.gold, letterSpacing: 1.2 },
  levelTitle: { fontFamily: C.fontDisplay, fontSize: 19, color: '#fff', letterSpacing: -0.3, marginTop: 2, marginBottom: 4 },
  levelBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.86)', lineHeight: 19 },

  prCard: { backgroundColor: '#B8860B', borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs, marginTop: Spacing.xs },
  prHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  prHeaderText: { fontFamily: C.fontDisplay, fontSize: 12, color: '#fff', letterSpacing: 0.6 },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff' },
  streakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 },
  streakNum: { fontFamily: C.fontDisplay, fontSize: 44, color: '#fff', letterSpacing: -1.5, lineHeight: 48 },
  streakUnit: { fontFamily: 'Inter_400Regular', fontSize: 22, color: 'rgba(255,255,255,0.8)' },
  streakCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20 },

  tileRow: { flexDirection: 'row', gap: Spacing.md },
  tile: { flex: 1, backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: 2 },
  tileLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  tileValue: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -1 },
  tileValueUnit: { fontFamily: 'Inter_400Regular', fontSize: 18, color: C.textSecondary },
  tileSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.primary },

  weekLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  weekCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  ringValue: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.5 },
  ringUnit: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary },
  weekCaption: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 4, lineHeight: 18 },

  feelRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  feelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, borderWidth: 1, borderColor: C.outlineVariant,
  },
  feelBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.text },
  feelDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  feelConfirm: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  noteBox: { flexDirection: 'row', gap: 8, backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  shareBtn: {
    height: 52, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surfaceContainerLow,
  },
  shareBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  doneBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
