// Tempo — Availability & Scheduling settings.
//
// Where the user tells Tempo about their real day so the Smart Scheduler can work
// around it: sleep window, work/school hours, which weekdays they'll train, their
// preferred time of day, how flexible workouts can be, and which calendar to sync
// to. Everything here is editable any time and feeds lib/smartSchedule directly.

import { useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, Switch, Alert, ActivityIndicator, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'
import { describeBlock } from '@/lib/unavailability'
import type { TimeOfDay, ScheduleFlexibility, CalendarProvider, UnavailableBlock } from '@/types'

// Local id for a new block (no server round-trip needed — these live in JSON).
const genId = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`

const C = Colors.light

const DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'Mon' }, { iso: 2, label: 'Tue' }, { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' }, { iso: 5, label: 'Fri' }, { iso: 6, label: 'Sat' }, { iso: 7, label: 'Sun' },
]

const TODS: { id: TimeOfDay; label: string }[] = [
  { id: 'morning', label: 'Morning' }, { id: 'afternoon', label: 'Afternoon' }, { id: 'evening', label: 'Evening' },
]

const FLEX: { id: ScheduleFlexibility; label: string; desc: string }[] = [
  { id: 'strict', label: 'Strict', desc: 'Protect my workout days — only nudge the time.' },
  { id: 'balanced', label: 'Balanced', desc: 'Move a workout within a day or so if life gets busy.' },
  { id: 'flexible', label: 'Flexible', desc: 'Move workouts anywhere that week to keep me on track.' },
]

type PickerField = 'wake' | 'bed' | 'workStart' | 'workEnd' | 'schoolStart' | 'schoolEnd' | 'unavailStart' | 'unavailEnd'

export default function AvailabilityScreen() {
  const router = useRouter()
  const { profile, session, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [wake, setWake] = useState<string | null>(profile?.wake_time ?? '06:30:00')
  const [bed, setBed] = useState<string | null>(profile?.bedtime ?? '22:30:00')
  const [workStart, setWorkStart] = useState<string | null>(profile?.work_start ?? null)
  const [workEnd, setWorkEnd] = useState<string | null>(profile?.work_end ?? null)
  const [schoolStart, setSchoolStart] = useState<string | null>(profile?.school_start ?? null)
  const [schoolEnd, setSchoolEnd] = useState<string | null>(profile?.school_end ?? null)
  const [tod, setTod] = useState<TimeOfDay | null>(profile?.preferred_time_of_day ?? null)
  const [days, setDays] = useState<number[]>(profile?.training_days ?? [])
  const [flex, setFlex] = useState<ScheduleFlexibility>(profile?.schedule_flexibility ?? 'balanced')
  const [calendar, setCalendar] = useState<CalendarProvider | null>(profile?.preferred_calendar ?? null)

  // "Completely unavailable" blocks + the inline add-form state.
  const [blocks, setBlocks] = useState<UnavailableBlock[]>(profile?.unavailable_blocks ?? [])
  const [adding, setAdding] = useState(false)
  const [uDays, setUDays] = useState<number[]>([])
  const [uAllDay, setUAllDay] = useState(true)
  const [uStart, setUStart] = useState<string | null>('09:00:00')
  const [uEnd, setUEnd] = useState<string | null>('17:00:00')
  const [uLabel, setULabel] = useState('')

  const [picker, setPicker] = useState<PickerField | null>(null)
  const [saving, setSaving] = useState(false)

  const toggleUDay = (iso: number) =>
    setUDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort((a, b) => a - b))

  // Create one block per chosen weekday so "every Sat & Sun" is two clean rows.
  const addUnavailable = () => {
    if (!uDays.length) { Alert.alert('Pick a day', 'Choose at least one day you’re unavailable.'); return }
    if (!uAllDay && !(uStart && uEnd && uStart < uEnd)) {
      Alert.alert('Check the times', 'The “from” time needs to be before the “until” time.'); return
    }
    const created: UnavailableBlock[] = uDays.map(wd => ({
      id: genId(),
      scope: 'weekday',
      weekday: wd,
      allDay: uAllDay,
      ...(uAllDay ? {} : { start: uStart ?? undefined, end: uEnd ?? undefined }),
      ...(uLabel.trim() ? { label: uLabel.trim() } : {}),
    }))
    setBlocks(prev => [...prev, ...created])
    setAdding(false); setUDays([]); setUAllDay(true); setUStart('09:00:00'); setUEnd('17:00:00'); setULabel('')
  }

  const removeBlock = (id: string) => setBlocks(prev => prev.filter(b => b.id !== id))

  const workOn = workStart != null && workEnd != null
  const schoolOn = schoolStart != null && schoolEnd != null

  const toggleWork = (on: boolean) => {
    if (on) { setWorkStart('09:00:00'); setWorkEnd('17:00:00') }
    else { setWorkStart(null); setWorkEnd(null) }
  }
  const toggleSchool = (on: boolean) => {
    if (on) { setSchoolStart('08:00:00'); setSchoolEnd('15:00:00') }
    else { setSchoolStart(null); setSchoolEnd(null) }
  }
  const toggleDay = (iso: number) =>
    setDays(prev => prev.includes(iso) ? prev.filter(d => d !== iso) : [...prev, iso].sort((a, b) => a - b))

  // Resolve the picker field → current value + setter.
  const pickerValue = (): string | null => {
    switch (picker) {
      case 'wake': return wake
      case 'bed': return bed
      case 'workStart': return workStart
      case 'workEnd': return workEnd
      case 'schoolStart': return schoolStart
      case 'schoolEnd': return schoolEnd
      case 'unavailStart': return uStart
      case 'unavailEnd': return uEnd
      default: return null
    }
  }
  const applyPicker = (v: string) => {
    switch (picker) {
      case 'wake': setWake(v); break
      case 'bed': setBed(v); break
      case 'workStart': setWorkStart(v); break
      case 'workEnd': setWorkEnd(v); break
      case 'schoolStart': setSchoolStart(v); break
      case 'schoolEnd': setSchoolEnd(v); break
      case 'unavailStart': setUStart(v); break
      case 'unavailEnd': setUEnd(v); break
    }
    setPicker(null)
  }

  const pickerTitle: Record<PickerField, string> = {
    wake: 'Wake-up time', bed: 'Bedtime',
    workStart: 'Work starts', workEnd: 'Work ends',
    schoolStart: 'School starts', schoolEnd: 'School ends',
    unavailStart: 'Unavailable from', unavailEnd: 'Unavailable until',
  }

  const handleSave = async () => {
    if (!userId || saving) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          wake_time: wake, bedtime: bed,
          work_start: workStart, work_end: workEnd,
          school_start: schoolStart, school_end: schoolEnd,
          preferred_time_of_day: tod,
          training_days: days,
          schedule_flexibility: flex,
          preferred_calendar: calendar,
          unavailable_blocks: blocks,
        })
        .eq('user_id', userId)
      if (error) throw error
      await refreshProfile()
      router.back()
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const TimeRow = ({ label, value, field }: { label: string; value: string | null; field: PickerField }) => (
    <TouchableOpacity style={styles.timeRow} onPress={() => setPicker(field)} activeOpacity={0.7}>
      <Text style={styles.timeRowLabel}>{label}</Text>
      <View style={styles.timeRowRight}>
        <Text style={styles.timeRowValue}>{formatTime12(value)}</Text>
        <Ionicons name="chevron-forward" size={16} color={C.outline} />
      </View>
    </TouchableOpacity>
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Availability</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Tell Tempo about your day. Workouts are scheduled around your sleep, work, and
          classes — never on top of them.
        </Text>

        {/* Sleep */}
        <Text style={styles.sectionLabel}>SLEEP</Text>
        <View style={styles.card}>
          <TimeRow label="Wake up" value={wake} field="wake" />
          <View style={styles.divider} />
          <TimeRow label="Bedtime" value={bed} field="bed" />
        </View>
        <Text style={styles.hint}>Tempo never schedules a workout while you're asleep.</Text>

        {/* Work */}
        <Text style={styles.sectionLabel}>WORK HOURS</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.timeRowLabel}>I have set work hours</Text>
            <Switch
              value={workOn}
              onValueChange={toggleWork}
              trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
              thumbColor="#fff"
            />
          </View>
          {workOn && (
            <>
              <View style={styles.divider} />
              <TimeRow label="Starts" value={workStart} field="workStart" />
              <View style={styles.divider} />
              <TimeRow label="Ends" value={workEnd} field="workEnd" />
            </>
          )}
        </View>

        {/* School */}
        <Text style={styles.sectionLabel}>SCHOOL HOURS</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.timeRowLabel}>I have set school hours</Text>
            <Switch
              value={schoolOn}
              onValueChange={toggleSchool}
              trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
              thumbColor="#fff"
            />
          </View>
          {schoolOn && (
            <>
              <View style={styles.divider} />
              <TimeRow label="Starts" value={schoolStart} field="schoolStart" />
              <View style={styles.divider} />
              <TimeRow label="Ends" value={schoolEnd} field="schoolEnd" />
            </>
          )}
        </View>

        {/* Preferred time of day */}
        <Text style={styles.sectionLabel}>PREFERRED TIME TO TRAIN</Text>
        <View style={styles.segmented}>
          {TODS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.segment, tod === t.id && styles.segmentActive]}
              onPress={() => setTod(tod === t.id ? null : t.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, tod === t.id && styles.segmentTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>Tempo aims for this window, then varies the exact time so your week isn't robotic.</Text>

        {/* Training days */}
        <Text style={styles.sectionLabel}>DAYS I CAN TRAIN</Text>
        <View style={styles.daysRow}>
          {DAYS.map(d => {
            const on = days.includes(d.iso)
            return (
              <TouchableOpacity
                key={d.iso}
                style={[styles.dayChip, on && styles.dayChipOn]}
                onPress={() => toggleDay(d.iso)}
                activeOpacity={0.8}
              >
                <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{d.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <Text style={styles.hint}>{days.length ? 'Workouts land only on the days you pick.' : 'Any day is fair game.'}</Text>

        {/* Completely unavailable */}
        <Text style={styles.sectionLabel}>TIMES I'M COMPLETELY UNAVAILABLE</Text>
        <Text style={styles.hint}>
          Days or times Tempo should never schedule a workout — for religious observance
          (e.g. Shabbat), standing commitments, or any time you simply don't train.
        </Text>

        {blocks.length > 0 && (
          <View style={styles.card}>
            {blocks.map((b, i) => (
              <View key={b.id}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.blockRow}>
                  <View style={styles.blockIcon}>
                    <Ionicons name="moon-outline" size={16} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.blockWhen}>{describeBlock(b)}</Text>
                    {b.label ? <Text style={styles.blockLabel}>{b.label}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => removeBlock(b.id)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={C.outline} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {adding ? (
          <View style={styles.addCard}>
            <Text style={styles.addCardLabel}>WHICH DAYS?</Text>
            <View style={styles.daysRow}>
              {DAYS.map(d => {
                const on = uDays.includes(d.iso)
                return (
                  <TouchableOpacity
                    key={d.iso}
                    style={[styles.dayChip, on && styles.dayChipOn]}
                    onPress={() => toggleUDay(d.iso)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{d.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <View style={styles.addSwitchRow}>
              <Text style={styles.timeRowLabel}>All day</Text>
              <Switch
                value={uAllDay}
                onValueChange={setUAllDay}
                trackColor={{ true: C.primary, false: C.surfaceContainerHigh }}
                thumbColor="#fff"
              />
            </View>

            {!uAllDay && (
              <View style={styles.card}>
                <TimeRow label="From" value={uStart} field="unavailStart" />
                <View style={styles.divider} />
                <TimeRow label="Until" value={uEnd} field="unavailEnd" />
              </View>
            )}

            <TextInput
              style={styles.labelInput}
              value={uLabel}
              onChangeText={setULabel}
              placeholder="Label (optional) — e.g. Shabbat"
              placeholderTextColor={C.outline}
              maxLength={28}
            />

            <View style={styles.addActions}>
              <TouchableOpacity style={styles.addCancel} onPress={() => setAdding(false)} activeOpacity={0.8}>
                <Text style={styles.addCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addConfirm} onPress={addUnavailable} activeOpacity={0.85}>
                <Text style={styles.addConfirmText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={18} color={C.primary} />
            <Text style={styles.addBtnText}>Add an unavailable time</Text>
          </TouchableOpacity>
        )}

        {/* Schedule flexibility */}
        <Text style={styles.sectionLabel}>SCHEDULE FLEXIBILITY</Text>
        <View style={{ gap: Spacing.xs }}>
          {FLEX.map(f => {
            const on = flex === f.id
            return (
              <TouchableOpacity
                key={f.id}
                style={[styles.flexCard, on && styles.flexCardOn]}
                onPress={() => setFlex(f.id)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={on ? C.primary : C.outline}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.flexLabel, on && { color: C.primary }]}>{f.label}</Text>
                  <Text style={styles.flexDesc}>{f.desc}</Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Preferred calendar */}
        <Text style={styles.sectionLabel}>SYNC WORKOUTS TO</Text>
        <View style={styles.segmented}>
          {(['google', 'device'] as CalendarProvider[]).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.segment, calendar === p && styles.segmentActive]}
              onPress={() => setCalendar(calendar === p ? null : p)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, calendar === p && styles.segmentTextActive]}>
                {p === 'google' ? 'Google Calendar' : 'Device Calendar'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>Used when both calendars are connected. Connect one from the Smart Scheduler or Settings.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <TimePickerSheet
        visible={picker !== null}
        value={pickerValue()}
        title={picker ? pickerTitle[picker] : ''}
        onSelect={applyPicker}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  headerTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.text, letterSpacing: -0.2 },
  scroll: { padding: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.sm },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21, marginBottom: Spacing.xs },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  card: {
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    ...CardShadow, overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: Spacing.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  timeRowLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  timeRowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  timeRowValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  segmented: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 4 },
  segment: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segmentActive: { backgroundColor: C.background, ...CardShadow, shadowOpacity: 0.08 },
  segmentText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  segmentTextActive: { fontFamily: 'Inter_700Bold', color: C.text },

  daysRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  dayChip: {
    flex: 1, aspectRatio: 1, borderRadius: Radius.md, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  dayChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  dayChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  dayChipTextOn: { color: C.onPrimary },

  // Unavailable blocks
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  blockIcon: {
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  blockWhen: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  blockLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5,
    borderColor: C.primary, borderStyle: 'dashed', backgroundColor: C.surfaceContainerLow,
  },
  addBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  addCard: {
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    padding: Spacing.md, gap: Spacing.sm, ...CardShadow,
  },
  addCardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  addSwitchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelInput: {
    height: 46, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text,
  },
  addActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  addCancel: {
    flex: 1, height: 46, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceContainerLow,
  },
  addCancelText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textSecondary },
  addConfirm: {
    flex: 1, height: 46, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary,
  },
  addConfirmText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary },

  flexCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: C.outlineVariant,
  },
  flexCardOn: { borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  flexLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  flexDesc: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1, lineHeight: 16 },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  saveBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
