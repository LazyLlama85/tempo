// Tempo — Active-session Focus Mode.
//
// A full-screen view for whichever set is currently in play, built after the
// founder's own reference: the rest timer especially deserves the whole
// screen, not a small floating pill above a scrolling card list — there's
// nothing else to do while resting, so the screen should say so clearly.
//
// ADDITIVE, not a replacement: the runner's scrollable exercise-card list,
// the +/- menu, RPE bar, warm-up toggle, trash, "+ Add Exercise", and the
// Pause sheet all keep working exactly as they do today. This is a second,
// optional way to view the SAME state — every prop here is read from state
// that already exists in `(tabs)/plan.tsx`; nothing is duplicated or owned
// here. Closing Focus Mode returns to the normal list with nothing lost.

import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { PressableScale } from '@/components/motion'
import { SvgProgressRing } from '@/components/SvgProgressRing'

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

interface Props {
  visible: boolean
  onClose: () => void
  exerciseName: string
  setLabel: string          // "SET 3 OF 4"
  targetRepsLabel: string   // "TARGET 12 REPS" or "TARGET 8-10 REPS"
  resting: boolean
  restSecondsLeft: number | null
  restTotal: number
  onAdjustRest: (deltaSec: number) => void
  // Whatever expo-image's <Image source={...}> accepts — a require()'d local
  // asset (number), a { uri, headers, cacheKey } remote descriptor, or none.
  formImage: number | { uri: string; headers?: Record<string, string>; cacheKey?: string } | null
  onViewForm: () => void
  done: boolean
  onSkip: () => void
  onDone: () => void
}

export function FocusMode({
  visible, onClose, exerciseName, setLabel, targetRepsLabel,
  resting, restSecondsLeft, restTotal, onAdjustRest,
  formImage, onViewForm, done, onSkip, onDone,
}: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()

  const ringValue = resting && restSecondsLeft != null
    ? Math.max(0, Math.min(100, (restSecondsLeft / Math.max(1, restTotal)) * 100))
    : 100

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + Spacing.md }]}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Exit focus mode">
          <Ionicons name="chevron-down" size={26} color={C.textSecondary} />
        </TouchableOpacity>

        <Text style={styles.exerciseName} numberOfLines={2}>{exerciseName}</Text>
        <View style={styles.setPill}>
          <Text style={styles.setPillText}>{setLabel}</Text>
        </View>

        <View style={styles.ringWrap}>
          <SvgProgressRing
            value={ringValue}
            size={220}
            stroke={14}
            gradientFrom={resting ? C.primary : C.primaryBright}
            gradientTo={C.primary}
          >
            {resting && restSecondsLeft != null ? (
              <>
                <Text style={styles.ringCaption}>RESTING</Text>
                <Text style={styles.ringBig}>{formatElapsed(restSecondsLeft)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.ringCaption}>{targetRepsLabel}</Text>
                <Ionicons name={done ? 'checkmark-circle' : 'barbell-outline'} size={40} color={done ? C.success : C.primary} />
              </>
            )}
          </SvgProgressRing>
        </View>

        {resting ? (
          <View style={styles.restAdjustRow}>
            <PressableScale style={styles.adjustBtn} onPress={() => onAdjustRest(-15)} scaleTo={0.88} accessibilityLabel="15 seconds less rest">
              <Ionicons name="remove" size={22} color={C.text} />
            </PressableScale>
            <Text style={styles.restAdjustLabel}>REST TIMER</Text>
            <PressableScale style={styles.adjustBtn} onPress={() => onAdjustRest(15)} scaleTo={0.88} accessibilityLabel="15 seconds more rest">
              <Ionicons name="add" size={22} color={C.text} />
            </PressableScale>
          </View>
        ) : (
          <View style={{ height: 24 + 22 }} />
        )}

        {formImage ? (
          <TouchableOpacity style={styles.formPreview} onPress={onViewForm} activeOpacity={0.85}>
            <Image source={formImage} style={styles.formImage} contentFit="contain" />
            <View style={styles.formLabelRow}>
              <Ionicons name="play-circle" size={16} color="#fff" />
              <Text style={styles.formLabelText}>View form video</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.formPreviewEmpty} onPress={onViewForm} activeOpacity={0.7}>
            <Ionicons name="book-outline" size={18} color={C.primary} />
            <Text style={styles.formPreviewEmptyText}>Form guide</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomRow}>
          <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.8}>
            <Text style={styles.skipText}>SKIP</Text>
          </TouchableOpacity>
          <PressableScale style={[styles.doneBtn, done && styles.doneBtnDone]} onPress={onDone} scaleTo={0.96}>
            <Text style={styles.doneText}>{done ? 'DONE' : 'DONE'}</Text>
            <Ionicons name="checkmark" size={18} color={C.onPrimary} />
          </PressableScale>
        </View>
      </View>
    </Modal>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface, paddingHorizontal: Spacing.lg, alignItems: 'center' },
  closeBtn: { alignSelf: 'center', padding: Spacing.xs, marginBottom: Spacing.sm },
  exerciseName: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, textAlign: 'center', letterSpacing: -0.3 },
  setPill: {
    marginTop: Spacing.sm, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  setPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary, letterSpacing: 0.6 },
  ringWrap: { marginTop: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  ringCaption: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline, letterSpacing: 0.8, marginBottom: 6 },
  ringBig: { fontFamily: C.fontDisplay, fontSize: 44, color: C.text, letterSpacing: -1 },
  restAdjustRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginTop: Spacing.lg,
  },
  adjustBtn: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.outlineVariant,
  },
  restAdjustLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.8, width: 90, textAlign: 'center' },
  formPreview: {
    marginTop: Spacing.lg, width: '100%', height: 140, borderRadius: Radius.lg,
    overflow: 'hidden', backgroundColor: C.surfaceContainerLow,
  },
  formImage: { width: '100%', height: '100%' },
  formLabelRow: {
    position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(15,15,20,0.7)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6,
  },
  formLabelText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#fff' },
  formPreviewEmpty: {
    marginTop: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: Spacing.sm,
  },
  formPreviewEmptyText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  bottomRow: { flexDirection: 'row', gap: Spacing.sm, width: '100%', marginTop: 'auto', paddingTop: Spacing.lg },
  skipBtn: {
    flex: 1, height: 54, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  skipText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textSecondary, letterSpacing: 0.5 },
  doneBtn: {
    flex: 2, height: 54, borderRadius: Radius.lg, backgroundColor: C.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  doneBtnDone: { backgroundColor: C.success },
  doneText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary, letterSpacing: 0.3 },
})
