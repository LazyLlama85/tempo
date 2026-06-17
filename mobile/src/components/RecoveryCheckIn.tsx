import { useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { computeReadiness, readinessLabel, saveCheckin, type RecoveryInputs } from '@/lib/recovery'

const C = Colors.light

// soreness/stress are inverse — the "1" end is the good one, so the scale hints flip.
const METRICS: { key: keyof RecoveryInputs; label: string; low: string; high: string }[] = [
  { key: 'sleep', label: 'Sleep quality', low: 'Poor', high: 'Great' },
  { key: 'energy', label: 'Energy', low: 'Drained', high: 'Fired up' },
  { key: 'soreness', label: 'Soreness', low: 'None', high: 'Very sore' },
  { key: 'stress', label: 'Stress', low: 'Calm', high: 'Stressed' },
]

interface Props {
  visible: boolean
  userId: string
  onClose: () => void
  onSaved: (readiness: number) => void
}

export function RecoveryCheckIn({ visible, userId, onClose, onSaved }: Props) {
  const [v, setV] = useState<RecoveryInputs>({ sleep: 3, energy: 3, soreness: 3, stress: 3 })
  const [saving, setSaving] = useState(false)
  const readiness = computeReadiness(v)

  const save = async () => {
    setSaving(true)
    const score = await saveCheckin(userId, v)
    setSaving(false)
    if (score == null) { onClose(); return }   // table not set up yet — fail quietly
    onSaved(score)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.eyebrow}>DAILY CHECK-IN</Text>
          <Text style={styles.title}>How are you recovering?</Text>

          {METRICS.map(m => (
            <View key={m.key} style={styles.metric}>
              <View style={styles.metricLabelRow}>
                <Text style={styles.metricLabel}>{m.label}</Text>
              </View>
              <View style={styles.scaleRow}>
                {[1, 2, 3, 4, 5].map(n => {
                  const on = v[m.key] === n
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[styles.scaleBtn, on && styles.scaleBtnOn]}
                      onPress={() => setV(prev => ({ ...prev, [m.key]: n }))}
                    >
                      <Text style={[styles.scaleText, on && styles.scaleTextOn]}>{n}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
              <View style={styles.hintRow}>
                <Text style={styles.hint}>{m.low}</Text>
                <Text style={styles.hint}>{m.high}</Text>
              </View>
            </View>
          ))}

          {/* Live readiness preview */}
          <View style={styles.preview}>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewEyebrow}>READINESS</Text>
              <Text style={styles.previewLabel}>{readinessLabel(readiness)}</Text>
            </View>
            <Text style={styles.previewScore}>{readiness}<Text style={styles.previewUnit}>/100</Text></Text>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save check-in'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(27,27,28,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.xs },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.text, letterSpacing: -0.3, marginBottom: Spacing.sm },
  metric: { gap: 6, marginBottom: Spacing.xs },
  metricLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  scaleRow: { flexDirection: 'row', gap: Spacing.xs },
  scaleBtn: {
    flex: 1, height: 44, borderRadius: Radius.md, backgroundColor: C.background,
    borderWidth: 1, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  scaleBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  scaleText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.textSecondary },
  scaleTextOn: { color: C.onPrimary },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between' },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.outline },
  preview: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs,
  },
  previewEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 },
  previewLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, marginTop: 2 },
  previewScore: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, color: C.primary, letterSpacing: -1 },
  previewUnit: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },
  saveBtn: { height: 54, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xs },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary, letterSpacing: 0.3 },
})
