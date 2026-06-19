// Tempo — EditWorkoutSheet: full manual control over a scheduled workout.
//
// Smart scheduling assists; it never traps. From here the user can move a workout
// to any day + time, or remove it — and the calendar stays in sync (the old event
// is deleted and a fresh one created at the new time, on the same calendar).

import { useEffect, useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'
import { addWorkoutToCalendar, removeWorkoutFromCalendar } from '@/services/calendarSync'
import type { CalendarProvider } from '@/types'

const C = Colors.light

export interface EditableWorkout {
  id: string
  focus: string
  planned_date: string         // 'YYYY-MM-DD'
  planned_start_time: string   // 'HH:MM:SS'
  planned_duration_min: number
  calendar_event_id: string | null
  calendar_provider: CalendarProvider | null
}

interface Props {
  visible: boolean
  workout: EditableWorkout | null
  userId: string
  client: SupabaseClient
  preferredCalendar: CalendarProvider | null
  onClose: () => void
  onSaved: () => void
}

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Next 14 days, starting today, as pickable chips.
const NEXT_DAYS = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d })

export function EditWorkoutSheet({ visible, workout, userId, client, preferredCalendar, onClose, onSaved }: Props) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('07:00:00')
  const [showTime, setShowTime] = useState(false)
  const [saving, setSaving] = useState(false)

  // Re-seed local state whenever a different workout is opened.
  useEffect(() => {
    if (workout) { setDate(workout.planned_date); setTime(workout.planned_start_time) }
  }, [workout?.id])

  if (!workout) return null

  const changed = date !== workout.planned_date || time !== workout.planned_start_time

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const { error } = await client
        .from('scheduled_workouts')
        .update({ planned_date: date, planned_start_time: time, status: 'scheduled' })
        .eq('id', workout.id)
        .eq('user_id', userId)
      if (error) throw error

      // Keep the calendar in sync: drop the old event, recreate at the new time on
      // the SAME calendar it was on. Best-effort — the move itself already stuck.
      if (workout.calendar_event_id) {
        await removeWorkoutFromCalendar(client, workout, userId).catch(() => {})
        await addWorkoutToCalendar(
          client,
          { ...workout, planned_date: date, planned_start_time: time, calendar_event_id: null, calendar_provider: null },
          userId,
          workout.calendar_provider ?? preferredCalendar,
        ).catch(() => {})
      }
      onSaved()
      onClose()
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = () => {
    Alert.alert('Remove workout?', `"${workout.focus}" will be taken off your schedule. You can always add a new one.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (saving) return
          setSaving(true)
          try {
            if (workout.calendar_event_id) await removeWorkoutFromCalendar(client, workout, userId).catch(() => {})
            await client
              .from('scheduled_workouts')
              .update({ status: 'skipped' })
              .eq('id', workout.id)
              .eq('user_id', userId)
            onSaved()
            onClose()
          } catch {
            Alert.alert('Could not remove', 'Please try again.')
          } finally {
            setSaving(false)
          }
        },
      },
    ])
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.eyebrow}>EDIT WORKOUT</Text>
          <Text style={styles.title}>{workout.focus}</Text>

          <Text style={styles.label}>DAY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRow}>
            {NEXT_DAYS.map(d => {
              const ds = toDateStr(d)
              const on = ds === date
              return (
                <TouchableOpacity key={ds} style={[styles.dayChip, on && styles.dayChipOn]} onPress={() => setDate(ds)} activeOpacity={0.8}>
                  <Text style={[styles.dayWd, on && styles.dayTextOn]}>{WD[d.getDay()]}</Text>
                  <Text style={[styles.dayNum, on && styles.dayTextOn]}>{d.getDate()}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          <Text style={styles.label}>TIME</Text>
          <TouchableOpacity style={styles.timeBtn} onPress={() => setShowTime(true)} activeOpacity={0.7}>
            <Ionicons name="time-outline" size={18} color={C.primary} />
            <Text style={styles.timeBtnText}>{formatTime12(time)}</Text>
            <Ionicons name="chevron-forward" size={16} color={C.outline} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, (!changed || saving) && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={!changed || saving}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.removeBtn} onPress={handleRemove} disabled={saving} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={16} color={C.error} />
            <Text style={styles.removeBtnText}>Remove from schedule</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TimePickerSheet
        visible={showTime}
        value={time}
        title="Workout time"
        onSelect={v => { setTime(v); setShowTime(false) }}
        onClose={() => setShowTime(false)}
      />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.xs,
  },
  handle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.sm },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.3, marginBottom: Spacing.xs },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.sm },
  daysRow: { gap: Spacing.xs, paddingVertical: 4 },
  dayChip: {
    width: 52, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', gap: 2,
    borderWidth: 1.5, borderColor: C.outlineVariant,
  },
  dayChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  dayWd: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.outline },
  dayNum: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.text },
  dayTextOn: { color: C.onPrimary },
  timeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  timeBtnText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  saveBtn: { height: 54, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  removeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  removeBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.error },
})
