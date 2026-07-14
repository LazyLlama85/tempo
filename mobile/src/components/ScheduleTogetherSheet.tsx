// Tempo — "Work out with a friend" sheet. Shows the times Tempo found you're both
// free (shared-availability engine) and sends a workout invite; accepting schedules
// it for both. Opened from a friend's profile.

import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { TempoSheet } from '@/components/TempoSheet'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { suggestSlotsWith, sendWorkoutInvite } from '@/lib/scheduling'
import { minutesToTime, type SharedSlot } from '@/lib/availability'
import * as haptics from '@/lib/haptics'

const DURATIONS = [30, 45, 60, 90]
const FOCUS_PRESETS = ['Push Day', 'Pull Day', 'Leg Day', 'Upper Body', 'Lower Body', 'Full Body', 'Cardio', 'Core']

function slotDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface Props {
  visible: boolean
  friendId: string
  friendName: string
  onClose: () => void
  onSent?: () => void
}

export function ScheduleTogetherSheet({ visible, friendId, friendName, onClose, onSent }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [duration, setDuration] = useState(60)
  const [focus, setFocus] = useState('Workout')
  const [loading, setLoading] = useState(false)
  const [slots, setSlots] = useState<SharedSlot[]>([])
  const [shared, setShared] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!visible || !userId || !friendId) return
    setLoading(true)
    suggestSlotsWith(supabase, userId, friendId, duration)
      .then((r) => { setSlots(r.slots); setShared(r.availabilityShared) })
      .catch(() => setSlots([]))
      .finally(() => setLoading(false))
  }, [visible, userId, friendId, duration])

  const send = async (slot: SharedSlot) => {
    if (sending) return
    setSending(true)
    haptics.tapMedium()
    const ok = await sendWorkoutInvite(supabase, friendId, focus.trim() || 'Workout', slot.date, minutesToTime(slot.startMin), duration)
    setSending(false)
    if (ok) {
      onClose()
      onSent?.()
      Alert.alert('Invite sent', `${friendName} will get your invite for ${slotDateLabel(slot.date)}, ${slot.label}.`)
    } else {
      Alert.alert('Couldn’t send', 'Please try again.')
    }
  }

  return (
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['82%']} scroll>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <Text style={styles.title}>Work out with {friendName}</Text>
        <Text style={styles.hint}>Tempo found times you're both free. Pick one to send an invite — accepting schedules it for both of you.</Text>

        <Text style={styles.label}>WORKOUT</Text>
        <View style={styles.focusChips}>
          {FOCUS_PRESETS.map((f) => {
            const on = focus.trim().toLowerCase() === f.toLowerCase()
            return (
              <TouchableOpacity key={f} style={[styles.focusChip, on && styles.focusChipOn]} onPress={() => { haptics.tapLight(); setFocus(f) }} activeOpacity={0.85}>
                <Text style={[styles.focusChipText, on && styles.focusChipTextOn]}>{f}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <TextInput style={styles.input} value={focus} onChangeText={setFocus} placeholder="or type your own" placeholderTextColor={C.outline} maxLength={40} />

        <Text style={styles.label}>DURATION</Text>
        <View style={styles.chips}>
          {DURATIONS.map((d) => {
            const on = duration === d
            return (
              <TouchableOpacity key={d} style={[styles.chip, on && styles.chipOn]} onPress={() => { haptics.tapLight(); setDuration(d) }} activeOpacity={0.85}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{d} min</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={styles.label}>SUGGESTED TIMES</Text>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        ) : !shared ? (
          <Text style={styles.empty}>{friendName} hasn't shared their availability yet. They can turn it on under Friends → Privacy → Availability.</Text>
        ) : slots.length === 0 ? (
          <Text style={styles.empty}>No shared free time in the next two weeks. Try a shorter duration, or update your availability under Profile → Availability.</Text>
        ) : (
          <View style={{ gap: Spacing.xs }}>
            {slots.map((s) => (
              <PressableScale key={`${s.date}-${s.startMin}`} style={styles.slot} onPress={() => send(s)} scaleTo={0.97} disabled={sending}>
                <View style={styles.slotIcon}><Ionicons name="calendar-outline" size={18} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.slotDate}>{slotDateLabel(s.date)}</Text>
                  <Text style={styles.slotTime}>{s.label} · {duration} min</Text>
                </View>
                <Ionicons name="paper-plane-outline" size={17} color={C.primary} />
              </PressableScale>
            ))}
          </View>
        )}
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.xs },
  title: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: Spacing.xs },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.sm },
  input: {
    height: 48, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text, marginTop: 4,
  },
  focusChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 4 },
  focusChip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant, backgroundColor: C.background },
  focusChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  focusChipText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.textSecondary },
  focusChipTextOn: { color: C.onPrimary },
  chips: { flexDirection: 'row', gap: Spacing.xs, marginTop: 4 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant, backgroundColor: C.background },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  chipTextOn: { color: C.onPrimary },
  center: { paddingVertical: Spacing.xl, alignItems: 'center' },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, paddingVertical: Spacing.sm },
  slot: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  slotIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  slotDate: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  slotTime: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, marginTop: 1 },
})
