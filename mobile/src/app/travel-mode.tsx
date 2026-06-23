// Tempo — Travel mode (temporary equipment change).
//
// "I'm away from my usual setup until Friday." The user picks the equipment they
// actually have right now and when they'll be back; while it's on, Tempo programs
// Quick Workouts, swaps, and in-session substitutions against THIS gear instead of
// their home equipment — then expires on its own when the date passes. Fully
// reversible: "I'm back home" clears it and the normal plan resumes untouched.

import { useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { saveTravelMode, clearTravelMode, describeTravelUntil } from '@/lib/travelMode'
import type { Equipment, TravelMode } from '@/types'

const C = Colors.light

const EQUIP: { id: Equipment; label: string; desc: string; icon: string }[] = [
  { id: 'full_gym', label: 'Full gym', desc: 'Hotel or guest gym — machines & racks', icon: 'business-outline' },
  { id: 'dumbbells', label: 'Dumbbells', desc: 'A pair of dumbbells', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell & plates', desc: 'Barbell with a rack or bench', icon: 'fitness-outline' },
  { id: 'resistance_bands', label: 'Resistance bands', desc: 'Travel bands', icon: 'pulse-outline' },
  { id: 'bodyweight', label: 'No equipment', desc: 'Bodyweight only', icon: 'body-outline' },
]

type DurId = 'today' | 'weekend' | 'week' | 'twoweeks' | 'open'
const DURATIONS: { id: DurId; label: string }[] = [
  { id: 'today', label: 'Just today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: '1 week' },
  { id: 'twoweeks', label: '2 weeks' },
  { id: 'open', label: 'Until I turn it off' },
]

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Resolve a preset to an inclusive end date (or null = open-ended).
function untilFor(dur: DurId): string | null {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  switch (dur) {
    case 'today': return dateStr(d)
    case 'week': { d.setDate(d.getDate() + 6); return dateStr(d) }
    case 'twoweeks': { d.setDate(d.getDate() + 13); return dateStr(d) }
    case 'weekend': {
      // Through the coming Sunday (today if it's already Sunday).
      const day = d.getDay()                 // 0=Sun
      const add = day === 0 ? 0 : 7 - day
      d.setDate(d.getDate() + add)
      return dateStr(d)
    }
    case 'open': return null
  }
}

// Map an existing TravelMode's `until` back to the closest preset for editing.
function durFromUntil(until: string | null): DurId {
  if (!until) return 'open'
  for (const id of ['today', 'weekend', 'week', 'twoweeks'] as DurId[]) {
    if (untilFor(id) === until) return id
  }
  return 'open'
}

export default function TravelModeScreen() {
  const router = useRouter()
  const { profile, session, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const existing = (profile?.travel_mode as TravelMode | null) ?? null

  const [equipment, setEquipment] = useState<Equipment[]>(existing?.equipment ?? [])
  const [dur, setDur] = useState<DurId>(existing ? durFromUntil(existing.until) : 'week')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [saving, setSaving] = useState(false)

  const active = !!existing?.equipment?.length
  const toggle = (id: Equipment) =>
    setEquipment(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id])

  const handleSave = async () => {
    if (!userId || saving) return
    if (!equipment.length) { Alert.alert('Pick your equipment', 'Choose what you have with you right now.'); return }
    setSaving(true)
    const tm: TravelMode = { equipment, until: untilFor(dur), label: label.trim() || null }
    const ok = await saveTravelMode(supabase, userId, tm)
    if (ok) await refreshProfile()
    setSaving(false)
    if (ok) router.back()
    else Alert.alert('Could not save', 'Please try again.')
  }

  const handleClear = async () => {
    if (!userId || saving) return
    setSaving(true)
    await clearTravelMode(supabase, userId)
    await refreshProfile()
    setSaving(false)
    router.back()
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Travel Mode</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.heroIcon}>
          <Ionicons name="airplane" size={22} color={C.primary} />
        </View>
        <Text style={styles.intro}>
          Away from your usual setup? Tell Tempo what you have with you and it'll adapt
          your workouts — Quick Workouts, swaps, and substitutions — to match. Your home
          plan stays exactly as it is and resumes automatically when you're back.
        </Text>

        {active && (
          <View style={styles.activeCard}>
            <Ionicons name="checkmark-circle" size={18} color={C.success} />
            <Text style={styles.activeText}>
              Travel mode is on{existing?.until ? ` ${describeTravelUntil(existing.until)}` : ''}.
            </Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>WHAT DO YOU HAVE RIGHT NOW?</Text>
        <View style={styles.options}>
          {EQUIP.map(o => {
            const on = equipment.includes(o.id)
            return (
              <TouchableOpacity
                key={o.id}
                style={[styles.option, on && styles.optionOn]}
                onPress={() => toggle(o.id)}
                activeOpacity={0.8}
              >
                <View style={[styles.iconBox, on && styles.iconBoxOn]}>
                  <Ionicons name={o.icon as any} size={20} color={on ? C.onPrimary : C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, on && { color: C.primary }]}>{o.label}</Text>
                  <Text style={styles.optionDesc}>{o.desc}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Ionicons name="checkmark" size={14} color={C.onPrimary} />}
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={styles.sectionLabel}>HOW LONG?</Text>
        <View style={styles.durWrap}>
          {DURATIONS.map(d => {
            const on = dur === d.id
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.durChip, on && styles.durChipOn]}
                onPress={() => setDur(d.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.durChipText, on && styles.durChipTextOn]}>{d.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <Text style={styles.hint}>
          {dur === 'open' ? 'Stays on until you turn it off.' : `Back to your home plan ${describeTravelUntil(untilFor(dur))}.`}
        </Text>

        <Text style={styles.sectionLabel}>LABEL (OPTIONAL)</Text>
        <TextInput
          style={styles.input}
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Hotel gym, Visiting family"
          placeholderTextColor={C.outline}
          maxLength={28}
        />
      </ScrollView>

      <View style={styles.footer}>
        {active && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear} disabled={saving} activeOpacity={0.85}>
            <Ionicons name="home-outline" size={17} color={C.primary} />
            <Text style={styles.clearBtnText}>I'm back home</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={C.onPrimary} /> : (
            <Text style={styles.saveBtnText}>{active ? 'Update travel mode' : 'Turn on travel mode'}</Text>
          )}
        </TouchableOpacity>
      </View>
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
  heroIcon: {
    width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs,
  },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },
  activeCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.successSoft, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs,
  },
  activeText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.success },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  options: { gap: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1.5, borderColor: 'transparent',
  },
  optionOn: { borderColor: C.primary, backgroundColor: C.background },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxOn: { backgroundColor: C.primary },
  optionLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  optionDesc: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  check: {
    width: 22, height: 22, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },

  durWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  durChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: C.outlineVariant, backgroundColor: C.background,
  },
  durChipOn: { borderColor: C.primary, backgroundColor: C.primarySoft },
  durChipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  durChipTextOn: { color: C.primary },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  input: {
    height: 48, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text,
  },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  clearBtn: {
    height: 50, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surfaceContainerLow,
  },
  clearBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  saveBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
