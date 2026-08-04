import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { supabase } from '@/lib/supabase'
import { recordWorkoutFeedback, refreshAdaptation, type WorkoutFeel } from '@/lib/adaptation'
import { maybePromoteExperience, LEVEL_UP_COPY, type ExperiencePromotion } from '@/lib/experienceProgression'
import {
  badgeStatsFromSessions, computeEarnedBadges, BADGE_BY_KEY,
  getSeenBadges, markBadgesSeen, hasSeenRecord, type BadgeDef,
} from '@/lib/badges'
import { track } from '@/lib/analytics'
import { exportWorkoutToAppleHealth } from '@/lib/appleHealth'
import { buildWrappedCards, type WrappedCard } from '@/lib/wrapped'
import { computeWeeklyReport, type WeeklyReport } from '@/lib/weeklyReport'
import { detectSessionPRs, type SessionPR } from '@/lib/prs'
import { useWeightUnit } from '@/lib/units'
import { PRCard } from '@/components/PRCard'
import { ShareCardSheet } from '@/components/ShareCardSheet'
import { SaveProgressSheet } from '@/components/SaveProgressSheet'
import { countCompletedWorkouts, guestSavePromptSeen, markGuestSavePromptSeen, GUEST_SAVE_PROMPT_AFTER } from '@/lib/accountLinking'
import { maybeTrackActivation, ACTIVATION_SESSIONS } from '@/lib/activation'
import { useProAccess } from '@/stores/entitlements'
import { shouldAutoShowPaywall, markPaywallAutoShown } from '@/lib/paywallFrequency'
import { PopIn, FadeInView, PressableScale } from '@/components/motion'
import { useTutorialStore } from '@/stores/tutorial'
import * as haptics from '@/lib/haptics'
import { ConfettiBurst, CountUp } from '@/components/celebration'
import { AnimatedRing } from '@/components/AnimatedRing'
import { TempoLottie } from '@/components/TempoLottie'


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

  const { stats, workouts, isLoading: statsLoading, refetch } = useProgressStats(userId)
  const unit = useWeightUnit()
  const [feel, setFeel] = useState<WorkoutFeel | null>(null)
  const [cards, setCards] = useState<WrappedCard[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [prs, setPrs] = useState<SessionPR[]>([])
  const [promotion, setPromotion] = useState<ExperiencePromotion | null>(null)
  const [newBadge, setNewBadge] = useState<BadgeDef | null>(null)
  const [saveSheetVisible, setSaveSheetVisible] = useState(false)

  // Stats were just mutated by completing the session — pull the fresh numbers so
  // the streak / consistency / weekly figures reflect this workout.
  useEffect(() => { refetch() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Progressive disclosure (B3.2): don't tease Muscle Intelligence pre-activation —
  // see the matching note on Profile's Social section.
  const activated = stats.totalWorkouts >= ACTIVATION_SESSIONS

  // Is this the account's FIRST completed session? NEVER trust the local
  // "firstWorkoutCompleted" flag alone for something this visible — it's
  // device-local storage, so a reinstall, a new device, or an account that
  // already had real workout history before this flag existed all read it as
  // unset, which wrongly shows "First workout complete" (with its own paywall
  // trigger) to an established user (reported: added an ad-hoc workout outside
  // a regular split and got the day-one celebration). Defaults to false and
  // only flips true once the real completed-workout count — already being
  // fetched for this screen anyway — confirms it; briefly delaying the
  // celebration for a genuinely-new user costs far less than wrongly claiming
  // "day one" for a veteran.
  const [isFirstSession, setIsFirstSession] = useState(false)
  const firstSessionChecked = useRef(false)

  // The session is logged by the time this screen mounts — record it once.
  useEffect(() => {
    track('session_end', { type: isQuick ? 'quick' : 'planned', duration_min: mins || undefined })
    // This session is already banked (see above), so the "activated" check counts it.
    // Fires the one-time activation event once the core loop is proven (2nd completed
    // session); guarded + best-effort inside, so it never blocks this screen.
    void maybeTrackActivation(userId)
    // Apple Health export (§26 L28) — no-ops instantly unless the user opted in
    // in Settings; best-effort, never surfaces an error on this screen.
    if (logId) void exportWorkoutToAppleHealth(supabase, { logId, durationMin: mins })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the first-session celebration against real history once stats load
  // (they're already being fetched above) — this is the correction described
  // in the comment on isFirstSession.
  useEffect(() => {
    if (firstSessionChecked.current || statsLoading) return
    firstSessionChecked.current = true
    const reallyFirst = stats.totalWorkouts <= 1 && !useTutorialStore.getState().data.firstWorkoutCompleted
    setIsFirstSession(reallyFirst)
    if (reallyFirst) {
      useTutorialStore.getState().setFirstWorkoutCompleted()
      track('first_workout_completed', { experience: profile?.experience, duration_min: mins || undefined })
    }
  }, [statsLoading, stats.totalWorkouts]) // eslint-disable-line react-hooks/exhaustive-deps

  // A PR deserves a second, firmer buzz on top of the completion haptic.
  useEffect(() => {
    if (prs.length > 0) haptics.success()
  }, [prs.length])

  // Achievement-unlock celebration (§26, L24): lib/badges.ts already computes
  // earned badges and tracks which the user has "seen" (for the trophy case's
  // NEW indicator) — this reuses that exact system rather than inventing a
  // second one, and treats "just celebrated here" as equivalent to "opened the
  // trophy case" so the same badge never shows as new again afterward.
  // 'first_workout' is excluded — isFirstSession above already owns that exact
  // moment with its own full celebration.
  //
  // Bootstrap safety: the very first time this runs for a user (no seen-record
  // exists yet), it seeds the baseline silently instead of celebrating — an
  // existing user with 50 workouts didn't just earn "30 Sessions" today, and
  // must never be told they did.
  const badgeChecked = useRef(false)
  useEffect(() => {
    if (badgeChecked.current || statsLoading || !userId) return
    badgeChecked.current = true
    const badgeStats = badgeStatsFromSessions(workouts, profile?.days_per_week ?? 3, new Date().toISOString().slice(0, 10), {
      totalWorkouts: stats.totalWorkouts, totalVolume: stats.totalVolumeNum,
    })
    const earnedNow = computeEarnedBadges(badgeStats, new Set())
    earnedNow.delete('first_workout')

    if (!hasSeenRecord(userId)) {
      markBadgesSeen(userId, earnedNow)
      return
    }
    const seen = getSeenBadges(userId)
    const fresh = [...earnedNow].filter((k) => !seen.has(k))
    markBadgesSeen(userId, earnedNow)
    if (!fresh.length) return
    // Gold > silver > bronze when more than one unlocks in the same session.
    const tierRank = { gold: 2, silver: 1, bronze: 0 } as const
    const best = fresh
      .map((k) => BADGE_BY_KEY[k])
      .filter((b): b is BadgeDef => !!b)
      .sort((a, b) => tierRank[b.tier] - tierRank[a.tier])[0]
    if (best) {
      setNewBadge(best)
      track('achievement_unlocked', { key: best.key, tier: best.tier })
    }
  }, [statsLoading, stats.totalWorkouts, stats.totalVolumeNum, workouts, userId, profile?.days_per_week])

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

  // Guests build up real, losable history here — this is the moment there's
  // finally something worth protecting. After the 3rd completed workout, offer a
  // one-time (durable, force-close-proof) prompt to attach an account (§1.1).
  // Marked seen on present so it never re-nags, even if dismissed. Delayed so the
  // celebration lands first; never fires for real accounts.
  useEffect(() => {
    if (!userId || !session?.user.is_anonymous || guestSavePromptSeen(userId)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    countCompletedWorkouts(userId)
      .then((n) => {
        if (n < GUEST_SAVE_PROMPT_AFTER) return
        timer = setTimeout(() => {
          markGuestSavePromptSeen(userId)
          track('guest_save_prompt_shown', { context: 'post_workout' })
          setSaveSheetVisible(true)
        }, 1600)
      })
      .catch(() => {})
    return () => { if (timer) clearTimeout(timer) }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tempo Pro (§10): the first completed workout is the highest-converting moment
  // to introduce Pro — anchor the paywall here, right after the celebration, and
  // never before it. Dormant-safe: no-ops entirely while the remote flag is off or
  // the user is already Pro, so today this changes nothing.
  const { locked } = useProAccess()
  useEffect(() => {
    // §25 L7: capped alongside onboarding's own automatic redirect — a
    // motivated new user can complete onboarding AND their first workout in
    // one sitting, and must not see the paywall twice for it.
    if (!isFirstSession || !locked || !shouldAutoShowPaywall()) return
    const timer = setTimeout(() => {
      markPaywallAutoShown()
      track('paywall_shown', { context: 'first_workout' })
      router.push({ pathname: '/paywall', params: { context: 'first_workout' } })
    }, 2600) // let the confetti + first-session card land first
    return () => clearTimeout(timer)
  }, [isFirstSession, locked])

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

  // Priority ranking for this screen's "moment" cards. Eligibility (WHEN a card can
  // appear) is unchanged from before — this only decides which single eligible card
  // gets the full celebratory treatment when more than one fires at once. Everything
  // else eligible folds into one compact summary row instead of stacking full cards.
  type Tier = 'levelup' | 'pr' | 'achievement' | 'routine'
  const TIER_ORDER: Tier[] = ['levelup', 'pr', 'achievement', 'routine']
  const tierEligible: Record<Tier, boolean> = {
    levelup: !!promotion,
    pr: prs.length > 0,
    achievement: isFirstSession || !!newBadge,
    routine: true, // streak + the 2 stat tiles always show
  }
  const hero: Tier = TIER_ORDER.find((t) => tierEligible[t]) ?? 'routine'
  const tierSummaryItems = (t: Tier): { key: string; icon: string; label: string; value: string }[] => {
    switch (t) {
      case 'levelup':
        return promotion ? [{ key: 'levelup', icon: 'trending-up', label: 'Level up', value: LEVEL_UP_COPY[promotion.to as 'intermediate' | 'advanced'].title }] : []
      case 'pr':
        return prs.length > 0 ? [{ key: 'pr', icon: 'trophy', label: prs.length === 1 ? 'New PR' : 'New PRs', value: `${prs.length}` }] : []
      case 'achievement':
        return isFirstSession
          ? [{ key: 'achievement', icon: 'footsteps', label: 'Milestone', value: 'First session' }]
          : newBadge
          ? [{ key: 'achievement', icon: newBadge.icon, label: 'Achievement', value: newBadge.label }]
          : []
      case 'routine':
        return [
          { key: 'streak', icon: 'flame', label: 'Streak', value: `${stats.streak} ${stats.streak === 1 ? 'session' : 'sessions'}` },
          { key: 'consistency', icon: 'stats-chart', label: 'Consistency', value: `${stats.consistency_pct}%` },
          { key: 'duration', icon: 'time-outline', label: 'Duration', value: `${mins} min` },
        ]
    }
  }
  const summaryItems = TIER_ORDER.filter((t) => t !== hero && tierEligible[t]).flatMap(tierSummaryItems)

  if (!session) return <Redirect href="/sign-in" />

  // Momentum lead — make people *feel* progress, not just "Workout Complete".
  // Prefer the most motivating true statement we can make from this week's data.
  const lead = (() => {
    if (report && report.missed > 0 && report.workouts > 0) {
      return `You trained ${report.workouts} day${report.workouts === 1 ? '' : 's'} this week despite missing ${report.missed} — ${BRAND_NAME} adjusted your plan to keep you on track.`
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
      {/* The moment of celebration — confetti falls once, sized/colored to whichever
          single card is winning the priority ranking (level-up > PR > achievement > routine). */}
      <ConfettiBurst
        count={hero === 'levelup' ? 72 : hero === 'achievement' ? 64 : hero === 'pr' ? 40 : 26}
        colors={hero === 'levelup' ? [C.gold, C.primary, C.primaryBright, C.success] : undefined}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Tempo Coach celebrating — jumping jack for the biggest moment on
            this screen (a level-up), a high-five otherwise. Additive
            alongside the confetti/badge below, not a replacement; plays once
            (non-looping "pop" style), never blocks anything if it fails to load. */}
        <TempoLottie
          source={hero === 'levelup' ? require('@/assets/lottie/coach/jumpjack.json') : require('@/assets/lottie/coach/highfive.json')}
          width={hero === 'levelup' ? 64 : 67}
          height={72}
          loop={false}
          style={styles.coachCelebrate}
        />
        <PopIn style={styles.badge}>
          <Ionicons name={isFirstSession ? 'sparkles' : 'checkmark'} size={44} color={C.onPrimary} />
        </PopIn>
        <FadeInView delay={120}><Text style={styles.title}>{isFirstSession ? 'First workout complete.' : 'Nice work.'}</Text></FadeInView>
        <FadeInView delay={200}><Text style={styles.lead}>{isFirstSession ? `You just started your ${BRAND_NAME} journey — this is day one.` : lead}</Text></FadeInView>

        {/* First Tempo Session — an unlock moment on day one. Full treatment only
            when it's the highest-ranked eligible card this visit. */}
        {hero === 'achievement' && isFirstSession && (
          <PopIn delay={240} style={styles.firstCard}>
            <View style={styles.firstBadge}>
              <Ionicons name="footsteps" size={24} color={C.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.firstTag}>ACHIEVEMENT UNLOCKED</Text>
              <Text style={styles.firstTitle}>{`First ${BRAND_NAME} Session`}</Text>
              <Text style={styles.firstBody}>{`The hardest one is behind you. ${BRAND_NAME} learns from this session to shape your next.`}</Text>
            </View>
          </PopIn>
        )}

        {/* A real badge unlock (lib/badges.ts) — 30 Sessions, Ton Club, a streak,
            etc. Same treatment as the first-session card above, just driven by
            whichever badge actually just unlocked. */}
        {hero === 'achievement' && !isFirstSession && newBadge && (
          <PopIn delay={240} style={styles.firstCard}>
            <View style={styles.firstBadge}>
              <Ionicons name={newBadge.icon as any} size={24} color={C.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.firstTag}>ACHIEVEMENT UNLOCKED</Text>
              <Text style={styles.firstTitle}>{newBadge.label}</Text>
              <Text style={styles.firstBody}>{newBadge.description}</Text>
            </View>
          </PopIn>
        )}

        {/* Level up — the plan grew with you. The biggest moment on the screen when eligible. */}
        {hero === 'levelup' && promotion && (
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

        {/* PRs — celebrate them aggressively, but only as the top-ranked card */}
        {hero === 'pr' && prs.length > 0 && (
          <PRCard prs={prs} unit={unit} variant="hero" delay={260} />
        )}

        {/* Streak + stat tiles — the default "moment" when nothing higher-ranked fired */}
        {hero === 'routine' && (
          <>
            <FadeInView delay={280} style={[styles.card, styles.streakCard]}>
              <View style={styles.streakRow}>
                <Ionicons name="flame" size={22} color={C.onPrimary} />
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
          </>
        )}

        {/* Everything else eligible this visit, folded into one compact row —
            no confetti, no count-up, just icon + label + value per item. */}
        {summaryItems.length > 0 && (
          <FadeInView delay={320} style={styles.summaryRow}>
            {summaryItems.map((item) => (
              <View key={item.key} style={styles.summaryItem}>
                <Ionicons name={item.icon as any} size={15} color={C.primary} />
                <Text style={styles.summaryLabel}>{item.label}</Text>
                <Text style={styles.summaryValue}>{item.value}</Text>
              </View>
            ))}
          </FadeInView>
        )}

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
              that's the whole point of {BRAND_NAME}.
            </Text>
          </View>
        )}

        {/* Muscle Intelligence teaser — a Pro upsell at a high-intent moment. */}
        {locked && activated && (
          <PressableScale style={styles.muscleTeaser} scaleTo={0.98} onPress={() => { track('paywall_shown', { context: 'post_workout_muscle' }); router.push('/muscle-map') }}>
            <View style={styles.muscleTeaserIcon}><Ionicons name="body" size={22} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.muscleTeaserTitle}>Unlock Muscle Intelligence</Text>
              <Text style={styles.muscleTeaserSub}>See your complete body analysis — training balance, recovery & weak points.</Text>
            </View>
            <Ionicons name="lock-closed" size={16} color={C.primary} />
          </PressableScale>
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

      <SaveProgressSheet
        visible={saveSheetVisible}
        context="post_workout"
        onClose={() => setSaveSheetVisible(false)}
        onLinked={() => { refreshProfile().catch(() => {}) }}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.xl, paddingBottom: 120, gap: Spacing.md, alignItems: 'stretch' },
  badge: {
    width: 88, height: 88, borderRadius: Radius.full, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 24, elevation: 8,
  },
  coachCelebrate: { alignSelf: 'center', marginBottom: Spacing.xs },
  title: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -0.5, textAlign: 'center', marginTop: Spacing.sm },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xs },

  firstCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: C.primary,
  },
  firstBadge: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  firstTag: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 },
  firstTitle: { fontFamily: C.fontDisplay, fontSize: 19, color: C.text, letterSpacing: -0.2, marginTop: 1 },
  firstBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, gap: Spacing.xs },
  streakCard: { backgroundColor: C.primary, borderColor: C.primary },

  levelCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primary, borderRadius: Radius.xl, padding: Spacing.lg, marginTop: Spacing.xs,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.34, shadowRadius: 22, elevation: 9,
  },
  levelBadge: {
    width: 52, height: 52, borderRadius: Radius.full, backgroundColor: C.gold,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.gold, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 4,
  },
  levelTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.gold, letterSpacing: 1.2 },
  levelTitle: { fontFamily: C.fontDisplay, fontSize: 19, color: C.onPrimary, letterSpacing: -0.3, marginTop: 2, marginBottom: 4 },
  levelBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.86)', lineHeight: 19 },

  streakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakTag: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 },
  streakNum: { fontFamily: C.fontDisplay, fontSize: 44, color: C.onPrimary, letterSpacing: -1.5, lineHeight: 48 },
  streakUnit: { fontFamily: 'Inter_400Regular', fontSize: 22, color: 'rgba(255,255,255,0.8)' },
  streakCaption: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20 },

  tileRow: { flexDirection: 'row', gap: Spacing.md },
  tile: { flex: 1, backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, gap: 2 },
  muscleTeaser: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: C.primarySoft, borderRadius: Radius.card, padding: Spacing.md, borderWidth: 1, borderColor: C.primaryLine },
  muscleTeaserIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center' },
  muscleTeaserTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  muscleTeaserSub: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, marginTop: 1, lineHeight: 17 },
  tileLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  tileValue: { fontFamily: C.fontDisplay, fontSize: 30, color: C.text, letterSpacing: -1 },
  tileValueUnit: { fontFamily: 'Inter_400Regular', fontSize: 18, color: C.textSecondary },
  tileSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.primary },

  summaryRow: {
    flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.lg, rowGap: Spacing.sm,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.3 },
  summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },

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
