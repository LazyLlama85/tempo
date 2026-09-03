// Arclo — move a workout to a date and time you choose.
//
// Rescheduling used to offer exactly one thing: "Move it", to the slot Arclo
// picked. That is the right default and it is not always right — a scheduling
// app that will not let you pick a time yourself is missing its own point
// (founder, 2026-09-02). This is the manual half, reached from the Reschedule
// sheet's "Pick a date & time".
//
// A SCREEN rather than a sheet, deliberately. TimePickerSheet is a React Native
// <Modal>, and this stack has a documented failure where a Modal opened over
// another Modal strands an invisible backdrop (see TempoSheet's header comment).
// Every other TimePickerSheet caller — workout-builder, availability, onboarding
// — is a screen for exactly that reason, and the day-chip strip below is the same
// pattern workout-builder already uses.
//
// The write path is identical to the suggested move: update the row, then
// resyncMovedWorkout so the calendar event and the pre-workout reminder follow.

import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'
import { resyncMovedWorkout } from '@/lib/moveWorkout'
import { toDateStr } from '@/lib/dates'
import * as haptics from '@/lib/haptics'

const DAYS_AHEAD = 21

interface Row {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: 'device' | 'google' | null
}

export default function MoveWorkoutScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { workoutId } = useLocalSearchParams<{ workoutId?: string }>()
  const userId = useAuthStore((s) => s.session?.user?.id) ?? ''

  const [row, setRow] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState<string>('')
  const [time, setTime] = useState<string>('')
  const [showTime, setShowTime] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!workoutId || !userId) { setLoading(false); return }
      try {
        const { data } = await supabase
          .from('scheduled_workouts')
          .select('id, focus, planned_date, planned_start_time, planned_duration_min, calendar_event_id, calendar_provider')
          .eq('id', workoutId)
          .eq('user_id', userId)
          .maybeSingle()
        if (cancelled) return
        if (data) {
          setRow(data as Row)
          setDate(data.planned_date as string)
          setTime(data.planned_start_time as string)
        }
      } catch { /* falls through to the empty state below */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [workoutId, userId])

  // Built at mount rather than module load, so an app left open across midnight
  // never offers yesterday as a choice.
  const days = useMemo(() => {
    const base = new Date(); base.setHours(0, 0, 0, 0)
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() + i); return d
    })
  }, [])

  const todayStr = toDateStr(new Date())
  const chipLabel = (d: Date) => {
    const ds = toDateStr(d)
    if (ds === todayStr) return 'Today'
    const t = new Date(); t.setDate(t.getDate() + 1)
    if (ds === toDateStr(t)) return 'Tmrw'
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }

  const dirty = !!row && (date !== row.planned_date || time !== row.planned_start_time)

  const save = async () => {
    if (!row || saving || !dirty) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('scheduled_workouts')
        .update({ planned_date: date, planned_start_time: time, status: 'scheduled' })
        .eq('id', row.id)
        .eq('user_id', userId)
      if (error) throw error
      // Best-effort: a calendar hiccup must never undo a move that persisted.
      resyncMovedWorkout(supabase, userId, {
        ...row, planned_date: date, planned_start_time: time,
      }).catch(() => {})
      haptics.success()
      router.back()
    } catch {
      Alert.alert('Could not move it', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Move workout"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
        right={
          <TouchableOpacity onPress={save} disabled={saving || !dirty} hitSlop={8} accessibilityRole="button">
            {saving
              ? <ActivityIndicator color={C.primary} />
              : <Text style={[styles.save, !dirty && styles.saveOff]}>Save</Text>}
          </TouchableOpacity>
        }
      />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : !row ? (
        <View style={styles.center}>
          <Text style={styles.empty}>That workout is no longer here.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.focus}>{row.focus}</Text>
          <Text style={styles.was}>
            Currently {formatTime12(row.planned_start_time)} on{' '}
            {new Date(`${row.planned_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </Text>

          <Text style={styles.label}>DATE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRow}>
            {days.map((d) => {
              const ds = toDateStr(d)
              const on = ds === date
              return (
                <TouchableOpacity
                  key={ds}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                  onPress={() => setDate(ds)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                >
                  <Text style={[styles.dayName, on && styles.dayTextOn]}>{chipLabel(d)}</Text>
                  <Text style={[styles.dayNum, on && styles.dayTextOn]}>{d.getDate()}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          <Text style={styles.label}>TIME</Text>
          <TouchableOpacity
            style={styles.timeRow}
            onPress={() => setShowTime(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Workout time, currently ${formatTime12(time)}`}
          >
            <Ionicons name="time-outline" size={18} color={C.primary} />
            <Text style={styles.timeText}>{formatTime12(time)}</Text>
            <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.hint}>
            Arclo won&rsquo;t move this one automatically once you&rsquo;ve set it yourself.
          </Text>
        </ScrollView>
      )}

      <TimePickerSheet
        visible={showTime}
        value={time}
        title="Workout time"
        onSelect={(v) => { setTime(v); setShowTime(false) }}
        onClose={() => setShowTime(false)}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center' },
  body: { padding: Spacing.containerPadding, paddingBottom: Spacing['2xl'] },
  focus: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.4 },
  was: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, marginTop: 4 },
  label: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary,
    letterSpacing: 0.8, marginTop: Spacing.xl, marginBottom: Spacing.sm,
  },
  daysRow: { gap: Spacing.xs, paddingVertical: 2 },
  dayChip: {
    width: 58, paddingVertical: Spacing.sm, borderRadius: Radius.lg,
    backgroundColor: C.surfaceContainer, alignItems: 'center', gap: 2,
  },
  dayChipOn: { backgroundColor: C.primary },
  dayName: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary },
  dayNum: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  dayTextOn: { color: C.onPrimary },
  timeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: C.surfaceContainer, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, height: 52,
  },
  timeText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15, color: C.text },
  hint: {
    fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary,
    marginTop: Spacing.xl, lineHeight: 19,
  },
  save: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  saveOff: { color: C.textSecondary, opacity: 0.5 },
})
