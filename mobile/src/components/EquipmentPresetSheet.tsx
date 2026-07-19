// Tempo — create / edit a saved equipment preset (bottom sheet).
//
// Name it ("Home", "Hotel gym") + tick the gear you have there. Used from the Quick
// Workout screen so a session can be built around a specific setup. TempoSheet is an
// RN <Modal> (see the sheets memory) — not @gorhom.

import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { TempoSheet } from '@/components/TempoSheet'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { EQUIPMENT_OPTIONS, newPresetId, type EquipmentPreset } from '@/lib/equipmentPresets'
import type { Equipment } from '@/types'

interface Props {
  visible: boolean
  preset: EquipmentPreset | null   // null = create new
  onClose: () => void
  onSave: (preset: EquipmentPreset) => void
  onDelete?: (id: string) => void
}

export function EquipmentPresetSheet({ visible, preset, onClose, onSave, onDelete }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const editing = !!preset

  const [name, setName] = useState('')
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setName(preset?.name ?? '')
    setEquipment(preset?.equipment ?? [])
    setSaving(false)
  }, [visible, preset?.id])

  const toggle = (id: Equipment) =>
    setEquipment((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]))

  const handleSave = () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) { Alert.alert('Name your preset', 'Give it a name like “Home” or “Hotel gym”.'); return }
    if (!equipment.length) { Alert.alert('Pick your gear', 'Choose at least one piece of equipment.'); return }
    setSaving(true)
    onSave({ id: preset?.id ?? newPresetId(), name: trimmed, equipment })
  }

  const handleDelete = () => {
    if (!preset || !onDelete) return
    Alert.alert('Delete preset?', `“${preset.name}” will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(preset.id) },
    ])
  }

  return (
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['88%']} scroll>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <View style={styles.headerRow}>
          <View style={styles.heroIcon}><Ionicons name="cube-outline" size={20} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{editing ? 'Edit preset' : 'New equipment preset'}</Text>
            <Text style={styles.subtitle}>Save a setup so a Quick Workout fits the gear you have there.</Text>
          </View>
        </View>

        <Text style={styles.label}>NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Home, Hotel gym, Backyard"
          placeholderTextColor={C.outline}
          maxLength={24}
          autoFocus={!editing}
        />

        <Text style={styles.label}>WHAT'S THERE?</Text>
        <View style={styles.options}>
          {EQUIPMENT_OPTIONS.map((o) => {
            const on = equipment.includes(o.id)
            return (
              <TouchableOpacity key={o.id} style={[styles.option, on && styles.optionOn]} onPress={() => toggle(o.id)} activeOpacity={0.8}>
                <View style={[styles.iconBox, on && styles.iconBoxOn]}>
                  <Ionicons name={o.icon as any} size={19} color={on ? C.onPrimary : C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, on && { color: C.primary }]}>{o.label}</Text>
                  <Text style={styles.optionDesc}>{o.desc}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Ionicons name="checkmark" size={13} color={C.onPrimary} />}
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        <PressableScale style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} scaleTo={0.98}>
          {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.saveBtnText}>{editing ? 'Save changes' : 'Save preset'}</Text>}
        </PressableScale>
        {editing && onDelete && (
          <TouchableOpacity onPress={handleDelete} hitSlop={8} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>Delete preset</Text>
          </TouchableOpacity>
        )}
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xs },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.lg, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 1 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.md },
  input: { height: 50, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md, fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text, marginTop: 4 },
  options: { gap: Spacing.xs, marginTop: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.sm + 2, borderWidth: 1.5, borderColor: 'transparent' },
  optionOn: { borderColor: C.primary, backgroundColor: C.background },
  iconBox: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconBoxOn: { backgroundColor: C.primary },
  optionLabel: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: C.text },
  optionDesc: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  check: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },
  saveBtn: { height: 54, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  deleteBtn: { alignItems: 'center', paddingVertical: Spacing.sm, marginTop: 2 },
  deleteText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.error },
})
