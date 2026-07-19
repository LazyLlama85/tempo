// Tempo — Onboarding "Basics" (goal → experience → equipment in one screen).
//
// These three questions used to be three separate pushed screens (goal.tsx,
// experience.tsx, equipment.tsx), each with its own header + progress chrome.
// They're all single-screen "pick and advance" steps, so they now live here as a
// 3-card sequence behind one header. The route name stays /onboarding/goal so the
// (tabs) gate redirect and Profile → "Change Plan" re-entry keep working unchanged.
// Every card preserves its original selection logic, copy, and profile-seeding.

import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale, FadeInView } from '@/components/motion'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import type { Goal, Experience, Equipment } from '@/types'


// Copy is deliberately plain-language, benefit-first — no gym jargon ("hypertrophy",
// "metabolic conditioning", "CNS optimization"). The busy-generalist persona should never
// feel this app is for someone more serious than them at the very first screen. (Ids,
// labels, and icons are unchanged — this only softens the descriptions.)
const GOALS: { id: Goal; label: string; description: string; icon: string }[] = [
  { id: 'muscle_gain', label: 'Build Muscle', description: 'Build visible size and strength.', icon: 'barbell-outline' },
  { id: 'fat_loss', label: 'Lose Fat', description: 'Burn fat and get leaner.', icon: 'flame-outline' },
  { id: 'strength', label: 'Gain Strength', description: 'Get stronger on the big lifts.', icon: 'battery-charging-outline' },
  { id: 'athletic', label: 'Athletic Performance', description: 'Build speed, power, and agility.', icon: 'speedometer-outline' },
  { id: 'general_fitness', label: 'General Fitness', description: 'Feel good and stay healthy.', icon: 'pulse-outline' },
]

// Years-training is the simplest, least-ambiguous way to self-place (no jargon
// judgment call like "how advanced are you") — matches the founder's explicit ask
// for Heavy-style, plain-language level picking. A vertical list, not a preview
// card — the founder's ask: no sample-lifts/intensity-meter glimpse, just pick one.
const LEVELS: { id: Experience; label: string; years: string; sub: string; icon: string }[] = [
  { id: 'beginner', label: 'Beginner', years: '0–1 year', sub: 'Form-first coaching and steady, confident progress.', icon: 'leaf-outline' },
  { id: 'intermediate', label: 'Intermediate', years: '1–3 years', sub: 'Barbell lifts, steady weekly increases, and built-in recovery weeks.', icon: 'barbell-outline' },
  { id: 'advanced', label: 'Advanced', years: '3+ years', sub: 'Heavier work that adapts to your performance.', icon: 'flash-outline' },
]

const EQUIPMENT: { id: Equipment; label: string; description: string; icon: string }[] = [
  { id: 'full_gym', label: 'Full gym', description: 'Barbells, cables, machines — the works', icon: 'business-outline' },
  { id: 'dumbbells', label: 'Dumbbells', description: 'Adjustable or fixed dumbbells at home', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell & plates', description: 'Home setup with a rack or bench', icon: 'fitness-outline' },
  { id: 'kettlebell', label: 'Kettlebells', description: 'One or two kettlebells at home', icon: 'fitness-outline' },
  { id: 'resistance_bands', label: 'Resistance bands', description: 'Bands and bodyweight only', icon: 'pulse-outline' },
  { id: 'pull_up_bar', label: 'Pull-up & dip bar', description: 'Doorway bar, dip station, or rings', icon: 'body-outline' },
  { id: 'bodyweight', label: 'No equipment', description: 'Floor work only — no bar or dips', icon: 'walk-outline' },
]

export default function BasicsScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { signOut, profile } = useAuthStore()

  // 0 = goal, 1 = experience, 2 = equipment, 3 = build mode (new users only — see
  // below: an existing user re-planning always regenerates, so offering "build my
  // own" here would skip retiring their current plan's future sessions instead of
  // replacing them, leaving stale + new schedules double-booked).
  const isReplan = !!profile?.onboarding_complete
  const cardCount = isReplan ? 3 : 4
  const [cardIndex, setCardIndex] = useState(0)

  // Re-running onboarding (Change Plan) starts from the current answers instead of
  // making the user re-answer from scratch; brand-new users start unselected /
  // at the sensible defaults each original screen used.
  const [goalSel, setGoalSel] = useState<Goal | null>(profile?.goal ?? null)
  const [expSel, setExpSel] = useState<Experience>(profile?.experience ?? 'beginner')
  const [equipSel, setEquipSel] = useState<Equipment[]>((profile?.equipment as Equipment[]) ?? [])
  // Guided (Tempo builds & adapts the plan) vs. custom (the user builds their own
  // workouts/splits — free for everyone, not a Pro gate). No durable profile field
  // for this: the free build-your-own tools (My Workouts/My Splits) are always
  // reachable regardless — this only decides where onboarding drops the user off.
  const [buildMode, setBuildMode] = useState<'guided' | 'custom'>('guided')

  const toggleEquip = (id: Equipment) =>
    setEquipSel((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]))

  // Back: within the sequence, step a card back. On the first card it behaves exactly
  // as the old goal.tsx did — pop when there's a stack (Change Plan re-entry), else
  // sign out (which is what "back" means at the very first onboarding screen; that's
  // the only route back to the login screen for a brand-new user).
  const handleBack = () => {
    if (cardIndex > 0) { setCardIndex(cardIndex - 1); return }
    if (router.canGoBack()) router.back()
    else void signOut()
  }

  const canContinue = cardIndex === 0 ? !!goalSel : cardIndex === 2 ? equipSel.length > 0 : true

  const onContinue = () => {
    if (!canContinue) return
    if (cardIndex < cardCount - 1) { setCardIndex(cardIndex + 1); return }
    track('onboarding_step_completed', { step: 'basics', substeps: cardCount })
    const nextParams = { goal: goalSel!, experience: expSel, equipment: equipSel.join(','), buildMode: isReplan ? 'guided' : buildMode }
    // The "why Tempo" differentiator screen is for brand-new users only — a
    // re-planner already knows the app (and may already have a calendar
    // connected, which that screen doesn't check for) — straight to Schedule.
    if (isReplan) router.push({ pathname: '/onboarding/schedule', params: nextParams })
    else router.push({ pathname: '/onboarding/why-tempo', params: nextParams })
  }

  // Step 1 of 6 overall (2026-07-17: 6 lighter screens, up from 4 denser ones);
  // fill that first sixth across however many basics cards this account gets
  // (4 for a new user, 3 for a replan — no build-mode card).
  const TOTAL_STEPS = 7
  const progressPct = `${((cardIndex + 1) / cardCount) * (100 / TOTAL_STEPS)}%` as `${number}%`

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <TempoWordmark size={16} />
        <View style={{ width: 38 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: progressPct }]} />
      </View>

      {/* Sub-step dots (which basics card — 4 for a new user, 3 for a replan) */}
      <View style={styles.dots}>
        {Array.from({ length: cardCount }, (_, i) => i).map((i) => (
          <View key={i} style={[styles.dot, i === cardIndex && styles.dotOn, i < cardIndex && styles.dotDone]} />
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>STEP 1 OF {TOTAL_STEPS}</Text>

        {/* Crossfade between cards so the sequence feels alive. */}
        <FadeInView key={cardIndex} duration={220} style={{ gap: Spacing.md }}>
          {cardIndex === 0 && (
            <>
              <Text style={styles.title}>What is your primary goal?</Text>
              <Text style={styles.subtitle}>
                Select the outcome that best describes your ideal fitness transformation. You can refine this later.
              </Text>
              <View style={styles.options}>
                {GOALS.map((goal) => {
                  const isSelected = goalSel === goal.id
                  return (
                    <PressableScale
                      key={goal.id}
                      style={[styles.option, isSelected && styles.optionSelected]}
                      onPress={() => setGoalSel(goal.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                        <Ionicons name={goal.icon as any} size={22} color={isSelected ? C.onPrimary : C.primary} />
                      </View>
                      <View style={styles.optionText}>
                        <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{goal.label}</Text>
                        <Text style={styles.optionDesc}>{goal.description}</Text>
                      </View>
                    </PressableScale>
                  )
                })}
              </View>
            </>
          )}

          {cardIndex === 1 && (
            <>
              <Text style={styles.title}>How much experience do you have?</Text>
              <Text style={styles.subtitle}>This sets your exercises, starting weights, and how hard we push from day one.</Text>

              {/* Vertical option list, matching the Goal/Equipment cards — no preview,
                  no intensity meter/sample lifts; years-training is the whole answer. */}
              <View style={styles.options}>
                {LEVELS.map((level) => {
                  const isSelected = expSel === level.id
                  return (
                    <PressableScale
                      key={level.id}
                      style={[styles.option, isSelected && styles.optionSelected]}
                      onPress={() => setExpSel(level.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                        <Ionicons name={level.icon as any} size={22} color={isSelected ? C.onPrimary : C.primary} />
                      </View>
                      <View style={styles.optionText}>
                        <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                          {level.label} · {level.years}
                        </Text>
                        <Text style={styles.optionDesc}>{level.sub}</Text>
                      </View>
                    </PressableScale>
                  )
                })}
              </View>

              {/* Reassurance: this isn't a permanent label. */}
              <View style={styles.hintRow}>
                <Ionicons name="trending-up" size={16} color={C.primary} />
                <Text style={styles.hintText}>
                  Start where you are — Tempo automatically levels you up as you get stronger.
                </Text>
              </View>
            </>
          )}

          {cardIndex === 2 && (
            <>
              <Text style={styles.title}>What equipment do you have?</Text>
              <Text style={styles.subtitle}>Select all that apply. We'll only program what you can actually use.</Text>
              <View style={styles.options}>
                {EQUIPMENT.map((option) => {
                  const isSelected = equipSel.includes(option.id)
                  return (
                    <PressableScale
                      key={option.id}
                      style={[styles.option, isSelected && styles.optionSelected]}
                      onPress={() => toggleEquip(option.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                        <Ionicons name={option.icon as any} size={22} color={isSelected ? C.onPrimary : C.primary} />
                      </View>
                      <View style={styles.optionText}>
                        <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{option.label}</Text>
                        <Text style={styles.optionDesc}>{option.description}</Text>
                      </View>
                      <View style={[styles.check, isSelected && styles.checkOn]}>
                        {isSelected && <Ionicons name="checkmark" size={15} color={C.onPrimary} />}
                      </View>
                    </PressableScale>
                  )
                })}
              </View>
            </>
          )}

          {cardIndex === 3 && (
            <>
              <Text style={styles.title}>How do you want to train?</Text>
              <Text style={styles.subtitle}>Both are free — pick whichever fits how you like to work out. You can switch anytime.</Text>
              <View style={styles.options}>
                {([
                  { id: 'guided' as const, label: 'Guide me', description: 'Tempo builds your plan and keeps adapting it as you progress.', icon: 'sparkles-outline' },
                  { id: 'custom' as const, label: "I'll build my own", description: 'Create your own workouts and splits — Tempo still schedules them around your life.', icon: 'construct-outline' },
                ]).map((opt) => {
                  const isSelected = buildMode === opt.id
                  return (
                    <PressableScale
                      key={opt.id}
                      style={[styles.option, isSelected && styles.optionSelected]}
                      onPress={() => setBuildMode(opt.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                        <Ionicons name={opt.icon as any} size={22} color={isSelected ? C.onPrimary : C.primary} />
                      </View>
                      <View style={styles.optionText}>
                        <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{opt.label}</Text>
                        <Text style={styles.optionDesc}>{opt.description}</Text>
                      </View>
                    </PressableScale>
                  )
                })}
              </View>
            </>
          )}
        </FadeInView>
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        <PressableScale
          style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
          onPress={onContinue}
          disabled={!canContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Continue →</Text>
        </PressableScale>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: C.surfaceContainerHigh },
  dotOn: { backgroundColor: C.primary, width: 18 },
  dotDone: { backgroundColor: C.primary },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },

  // Goal + equipment option rows
  options: { gap: Spacing.sm, marginTop: Spacing.xs },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1.5, borderColor: 'transparent',
  },
  optionSelected: { borderColor: C.primary, backgroundColor: C.background },
  iconBox: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxSelected: { backgroundColor: C.primary },
  optionText: { flex: 1 },
  optionLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  optionLabelSelected: { color: C.primary },
  optionDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2, lineHeight: 18 },
  check: {
    width: 24, height: 24, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  hintText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 18 },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnDisabled: { backgroundColor: C.surfaceContainerHigh },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
