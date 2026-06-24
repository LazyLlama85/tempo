// Tempo — Plan Explanation screen ("why this week").
//
// Most apps generate workouts but never explain them. This makes Tempo feel
// intelligent: it reads the current week's periodization directive (already stored
// on each plan workout) and explains, in plain language, what phase you're in, why
// the volume/intensity is set the way it is, and when your next deload lands.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, Redirect } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import type { WeekProgression, Phase, AdaptationMode } from '@/lib/periodization'

const C = Colors.light

// Plain-language explanation per phase.
const PHASE_COPY: Record<Phase, { title: string; what: string }> = {
  base:     { title: 'Base Week', what: 'You\'re establishing working weights with a rep in reserve. The goal is clean, controlled volume you can build on — not maxing out.' },
  build:    { title: 'Build Week', what: 'Load and reps climb wherever you cleared the range last week. This is steady progressive overload — the engine of strength and muscle.' },
  peak:     { title: 'Overload (Peak) Week', what: 'Volume is increased — an extra set per lift — to push a hard adaptation stimulus before you recover. Expect this one to feel like work.' },
  deload:   { title: 'Deload Week', what: 'Weights and volume are intentionally pulled back so your body recovers and supercompensates. Going lighter now is what makes next block heavier.' },
  maintain: { title: 'Maintenance', what: 'Effort and volume hold steady to protect what you\'ve built — no added overload this block. Sustainable by design.' },
}

const MODE_NOTE: Partial<Record<AdaptationMode, string>> = {
  recovery: 'Tempo shifted you into a recovery block after spotting missed sessions or repeated "too hard" feedback. Volume is reduced and rebuilt gradually.',
  deload:   'Tempo inserted a deload now because your recent training signalled you needed a reset. Normal progression resumes after this.',
}

interface UpcomingRow { planned_date: string; progression: WeekProgression | null; focus: string }

function fmtDate(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function PlanExplainerScreen() {
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<AdaptationMode>('normal')
  const [current, setCurrent] = useState<WeekProgression | null>(null)
  const [nextDeload, setNextDeload] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    ;(async () => {
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const [{ data: plan }, { data: upcoming }] = await Promise.all([
        supabase.from('user_plans').select('adaptation_mode').eq('user_id', userId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('scheduled_workouts').select('planned_date, progression, focus')
          .eq('user_id', userId).eq('source', 'plan').eq('status', 'scheduled')
          .gte('planned_date', todayStr).order('planned_date', { ascending: true }),
      ])
      setMode((plan?.adaptation_mode ?? 'normal') as AdaptationMode)
      const rows = (upcoming ?? []) as UpcomingRow[]
      setCurrent(rows[0]?.progression ?? null)
      const deload = rows.find(r => r.progression?.isDeload && !(rows[0]?.progression?.isDeload))
      setNextDeload(deload?.planned_date ?? null)
      setLoading(false)
    })()
  }, [userId])

  if (!session) return <Redirect href="/sign-in" />

  const phase = current?.phase ?? 'base'
  const copy = PHASE_COPY[phase]
  const weekNum = (current?.weekIndex ?? 0) + 1

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Plan</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : !current ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={30} color={C.outline} />
          <Text style={styles.emptyText}>No active plan week to explain yet. Generate a plan from onboarding and check back.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.phaseCard, current.isDeload && styles.phaseCardDeload]}>
            <View style={styles.phaseIconWrap}>
              <Ionicons name={current.isDeload ? 'leaf' : phase === 'peak' ? 'trending-up' : 'barbell'} size={26} color={current.isDeload ? C.success : C.primary} />
            </View>
            <Text style={styles.phaseEyebrow}>WEEK {weekNum} · {copy.title.toUpperCase()}</Text>
            <Text style={styles.phaseTitle}>{copy.title}</Text>
            <Text style={styles.phaseWhat}>{copy.what}</Text>
          </View>

          {/* What changed this week */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>THIS WEEK'S DIALS</Text>
            <Dial icon="layers-outline" label="Volume"
              value={current.setsDelta > 0 ? `+${current.setsDelta} set per lift` : current.setsDelta < 0 ? `${current.setsDelta} set per lift` : 'Standard'} />
            <Dial icon="speedometer-outline" label="Intensity (load)"
              value={current.isDeload ? `~${Math.round(current.intensityPct * 100)}% — lighter` : 'Driven by your last sessions'} />
            <Dial icon="bed-outline" label="Recovery"
              value={current.isDeload ? 'Deload — built-in recovery' : 'Normal'} />
          </View>

          {/* Mode note / deload timing */}
          {MODE_NOTE[mode] && (
            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={18} color={C.primary} style={{ marginTop: 1 }} />
              <Text style={styles.noteText}>{MODE_NOTE[mode]}</Text>
            </View>
          )}
          <View style={styles.noteBox}>
            <Ionicons name={current.isDeload ? 'leaf-outline' : 'calendar-outline'} size={18} color={C.primary} style={{ marginTop: 1 }} />
            <Text style={styles.noteText}>
              {current.isDeload
                ? 'This is your deload — keep it light. Normal progression resumes next week.'
                : nextDeload
                  ? `Your next deload starts ${fmtDate(nextDeload)}. Push until then.`
                  : 'Keep progressing — Tempo schedules a deload automatically when you need one.'}
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Dial({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.dialRow}>
      <View style={styles.dialIcon}><Ionicons name={icon as any} size={16} color={C.primary} /></View>
      <Text style={styles.dialLabel}>{label}</Text>
      <Text style={styles.dialValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm },
  headerTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.text, letterSpacing: -0.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 20 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },

  phaseCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1.5, borderColor: C.primary, ...CardShadow, gap: 6, marginTop: Spacing.xs },
  phaseCardDeload: { borderColor: C.success },
  phaseIconWrap: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  phaseEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  phaseTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.text, letterSpacing: -0.4 },
  phaseWhat: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: C.outlineVariant, ...CardShadow, gap: Spacing.sm },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginBottom: 2 },
  dialRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dialIcon: { width: 30, height: 30, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  dialLabel: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  dialValue: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, flexShrink: 1, textAlign: 'right' },

  noteBox: { flexDirection: 'row', gap: 8, backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },
})
