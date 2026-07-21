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

import { useState } from 'react'
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { PressableScale } from '@/components/motion'
import { SvgProgressRing } from '@/components/SvgProgressRing'
import { TempoLottie } from '@/components/TempoLottie'

const RPE_OPTIONS = [6, 7, 8, 9, 10]

export interface FocusModeField {
  key: string
  label: string
  value: string
  kbd: 'decimal-pad' | 'number-pad'
  onChange: (v: string) => void
}

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
  // "How much weight did you do?" — the set that just logged, editable right
  // here during rest so the user never has to exit to the list. Undefined
  // (not resting, or nothing just logged) hides the editor entirely.
  lastSetFields?: FocusModeField[]
  onSaveLastSet?: () => void
  // "How hard was that?" — the same optional RPE follow-up the list view
  // shows, surfaced here too so it's reachable even for an exercise's LAST
  // set (Focus Mode used to close itself the instant that set logged, before
  // this bar had a chance to render — see the fix in plan.tsx's auto-close
  // effect). null/undefined hides it (nothing just logged, or not resting).
  lastSetRpe?: number | null
  onSetRpe?: (rpe: number) => void
}

export function FocusMode({
  visible, onClose, exerciseName, setLabel, targetRepsLabel,
  resting, restSecondsLeft, restTotal, onAdjustRest,
  formImage, onViewForm, done, onSkip, onDone,
  lastSetFields, onSaveLastSet,
  lastSetRpe, onSetRpe,
}: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const [savedTick, setSavedTick] = useState(false)
  // getExerciseGifSource builds a fresh { uri, headers } object every call, so a
  // remote formImage never keeps referential identity across renders — key on the
  // uri (or the local asset number) instead of the object itself, so a load
  // failure reliably falls back to "Form guide" instead of retrying/flashing a
  // broken image whenever this component happens to re-render.
  const formImageKey = typeof formImage === 'number' ? formImage : formImage?.uri ?? null
  const [failedImageKey, setFailedImageKey] = useState<string | number | null>(null)
  const showFormImage = formImage != null && formImageKey !== failedImageKey
  const saveLastSet = () => {
    onSaveLastSet?.()
    setSavedTick(true)
    setTimeout(() => setSavedTick(false), 1200)
  }

  const ringValue = resting && restSecondsLeft != null
    ? Math.max(0, Math.min(100, (restSecondsLeft / Math.max(1, restTotal)) * 100))
    : 100

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Exit focus mode">
            <Ionicons name="chevron-down" size={26} color={C.textSecondary} />
          </TouchableOpacity>

          {/* Everything above the SKIP/DONE row scrolls — the rest-timer card,
              weight/reps/RPE editor, and form preview can add up to more than
              one screen's height (especially with Dynamic Type on a smaller
              phone), and a fixed View let that content push SKIP/DONE off the
              bottom edge with no way to reach them. keyboardShouldPersistTaps
              lets the Save button still register while a weight/reps field is
              focused, and tapping anywhere else in the scroll area dismisses
              the keyboard instead of trapping it open. */}
          <ScrollView
            style={{ width: '100%', flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.exerciseName} numberOfLines={2}>{exerciseName}</Text>
            <View style={styles.setPill}>
              <Text style={styles.setPillText}>{setLabel}</Text>
            </View>

            {/* Tempo Coach, running in place while you rest — only shown while
                resting, purely decorative above the ring, so a failed/missing
                animation never affects the countdown itself. */}
            {resting && restSecondsLeft != null && (
              <TempoLottie source={require('@/assets/lottie/coach/sprinting.json')} width={62} height={76} style={styles.coachBadge} />
            )}

            <TouchableOpacity
              style={styles.ringWrap}
              activeOpacity={resting ? 0.8 : 1}
              disabled={!resting}
              onPress={resting ? onSkip : undefined}
              accessible
              accessibilityRole={resting ? 'button' : undefined}
              accessibilityLabel={
                resting && restSecondsLeft != null
                  ? `Resting, ${formatElapsed(restSecondsLeft)} remaining. Tap to skip rest.`
                  : `${targetRepsLabel}${done ? ', done' : ''}`
              }
            >
              <SvgProgressRing
                value={ringValue}
                size={220}
                stroke={14}
                gradientFrom={resting ? C.primary : C.primaryBright}
                gradientTo={C.primary}
              >
                {resting && restSecondsLeft != null ? (
                  <>
                    <Text style={styles.ringCaption} maxFontSizeMultiplier={1.2}>RESTING</Text>
                    <Text style={styles.ringBig} maxFontSizeMultiplier={1}>{formatElapsed(restSecondsLeft)}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.ringCaption} maxFontSizeMultiplier={1.2}>{targetRepsLabel}</Text>
                    <Ionicons name={done ? 'checkmark-circle' : 'barbell-outline'} size={40} color={done ? C.success : C.primary} />
                  </>
                )}
              </SvgProgressRing>
            </TouchableOpacity>
            {/* A tap-to-skip ring with no hint reads as a dead, decorative
                shape — spell out that it's interactive right underneath it. */}
            {resting && <Text style={styles.ringTapHint}>TAP RING TO SKIP REST</Text>}

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

            {resting && lastSetFields && lastSetFields.length > 0 && (
              <View style={styles.lastSetCard}>
                <Text style={styles.lastSetLabel}>HOW MUCH DID YOU DO?</Text>
                <View style={styles.lastSetRow}>
                  {lastSetFields.map(f => (
                    <View key={f.key} style={styles.lastSetField}>
                      <TextInput
                        style={styles.lastSetInput}
                        value={f.value}
                        onChangeText={f.onChange}
                        onEndEditing={saveLastSet}
                        keyboardType={f.kbd}
                        placeholder="0"
                        placeholderTextColor={C.outline}
                      />
                      <Text style={styles.lastSetFieldLabel}>{f.label}</Text>
                    </View>
                  ))}
                  {/* Pencil (not a checkmark) — matches the runner list's own
                      "this is done, tap to edit" language (plan.tsx), so this
                      doesn't read as a second "confirm" action right below
                      numbers that were already logged. Flashes to a checkmark
                      briefly as save confirmation, then reverts to pencil. */}
                  <PressableScale style={styles.lastSetSaveBtn} onPress={saveLastSet} scaleTo={0.9} accessibilityLabel="Save edited set">
                    <Ionicons name={savedTick ? 'checkmark-done' : 'pencil'} size={savedTick ? 18 : 15} color={C.onPrimary} />
                  </PressableScale>
                </View>
                {/* Optional RPE — same follow-up the scrolling list offers,
                    surfaced here too so it's reachable for a set logged while
                    Focus Mode is open, including an exercise's very last set
                    (which used to close Focus Mode before this had a chance
                    to render at all). */}
                {onSetRpe && (
                  <View style={styles.rpeRow}>
                    <Text style={styles.rpeRowLabel}>HOW HARD?</Text>
                    {RPE_OPTIONS.map(n => (
                      <PressableScale
                        key={n}
                        style={[styles.rpeChip, lastSetRpe === n && styles.rpeChipActive]}
                        onPress={() => onSetRpe(n)}
                        scaleTo={0.88}
                        accessibilityRole="button"
                        accessibilityLabel={`Rate this set RPE ${n}`}
                      >
                        <Text style={[styles.rpeChipText, lastSetRpe === n && styles.rpeChipTextActive]}>{n}</Text>
                      </PressableScale>
                    ))}
                  </View>
                )}
              </View>
            )}

            {showFormImage ? (
              <TouchableOpacity style={styles.formPreview} onPress={onViewForm} activeOpacity={0.85}>
                <Image
                  source={formImage}
                  style={styles.formImage}
                  contentFit="contain"
                  onError={() => setFailedImageKey(formImageKey)}
                />
                <View style={styles.formLabelRow}>
                  <Ionicons name="play-circle" size={16} color="#fff" />
                  <Text style={styles.formLabelText}>View form guide</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.formPreviewEmpty} onPress={onViewForm} activeOpacity={0.7}>
                <Ionicons name="book-outline" size={18} color={C.primary} />
                <Text style={styles.formPreviewEmptyText}>Form guide</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Fixed footer, outside the scroll area — always reachable no
              matter how tall the content above gets. */}
          <View style={[styles.bottomRow, { paddingBottom: insets.bottom + Spacing.md }]}>
            <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.8}>
              <Text style={styles.skipText}>SKIP</Text>
            </TouchableOpacity>
            {/* Once every set is done, this becomes the way back to the full
                session list (all exercises) instead of a dead, disabled
                button — there's nothing left to confirm here. */}
            <PressableScale
              style={[styles.doneBtn, done && styles.doneBtnDone]}
              onPress={done ? onClose : onDone}
              scaleTo={0.96}
              accessibilityRole="button"
              accessibilityLabel={done ? 'All sets done — view full session' : 'Done with this set'}
            >
              <Text style={styles.doneText}>{done ? 'ALL DONE' : 'DONE WITH SET'}</Text>
              <Ionicons name="checkmark" size={18} color={C.onPrimary} />
            </PressableScale>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface, paddingHorizontal: Spacing.lg, alignItems: 'center' },
  scrollContent: { alignItems: 'center', paddingBottom: Spacing.lg },
  closeBtn: { alignSelf: 'center', padding: Spacing.xs, marginBottom: Spacing.sm },
  exerciseName: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, textAlign: 'center', letterSpacing: -0.3 },
  setPill: {
    marginTop: Spacing.sm, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  setPillText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary, letterSpacing: 0.6 },
  coachBadge: { alignSelf: 'center', marginTop: Spacing.md },
  ringWrap: { marginTop: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  ringCaption: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline, letterSpacing: 0.8, marginBottom: 6 },
  ringBig: { fontFamily: C.fontDisplay, fontSize: 44, color: C.text, letterSpacing: -1 },
  ringTapHint: { fontFamily: 'Inter_600SemiBold', fontSize: 10.5, color: C.outline, letterSpacing: 0.6, marginTop: 8 },
  restAdjustRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginTop: Spacing.lg,
  },
  adjustBtn: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.outlineVariant,
  },
  restAdjustLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.8, width: 90, textAlign: 'center' },
  lastSetCard: {
    marginTop: Spacing.md, width: '100%', backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs,
  },
  lastSetLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, textAlign: 'center' },
  lastSetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  lastSetField: { flex: 1, alignItems: 'center' },
  lastSetInput: {
    width: '100%', height: 44, borderRadius: Radius.md, backgroundColor: C.background,
    borderWidth: 1, borderColor: C.outlineVariant, textAlign: 'center',
    fontFamily: C.fontDisplay, fontSize: 17, color: C.text,
  },
  lastSetFieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5, marginTop: 3 },
  lastSetSaveBtn: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
  },
  rpeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  rpeRowLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary, marginRight: 2 },
  rpeChip: {
    flex: 1, height: 34, borderRadius: Radius.sm, backgroundColor: C.background,
    borderWidth: 1, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  rpeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  rpeChipText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  rpeChipTextActive: { color: C.onPrimary },
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
  bottomRow: { flexDirection: 'row', gap: Spacing.sm, width: '100%', paddingTop: Spacing.md },
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
