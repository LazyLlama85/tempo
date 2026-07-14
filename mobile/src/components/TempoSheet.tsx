// Tempo — shared bottom sheet.
//
// HISTORY: this briefly wrapped @gorhom/bottom-sheet (for a real pan-to-dismiss
// gesture), but on the current bleeding-edge stack (RN 0.85 / React 19 / new
// architecture) gorhom's imperative `present()` silently rendered NOTHING in
// release builds — no sheet, no backdrop — so every button whose only job was to
// open a sheet (Edit Profile, Log Weight, Sign Out, every OptionSheet, the
// pickers…) appeared dead. Reverted to React Native's own <Modal>, which is what
// these sheets used before the redesign and which is bulletproof: it presents in
// its own native window (so it also shows correctly above `presentation:'modal'`
// screens), needs no provider / reanimated / gesture-handler, and can't silently
// no-op. We trade gorhom's swipe-to-dismiss for reliability — tap-outside and the
// handle still dismiss.
//
// The public API (`visible` / `onClose` / `scroll` / `snapPoints` / `style`) is
// unchanged, so callers didn't move. `snapPoints` is honoured as a fixed sheet
// HEIGHT (e.g. ['92%'] → 92% tall, giving inner FlatList/ScrollView a bounded
// viewport); omit it and the sheet sizes to its content up to 90%.

import { useEffect, useState } from 'react'
import {
  Modal, View, ScrollView, StyleSheet, Pressable,
  KeyboardAvoidingView, Platform, type ViewStyle,
} from 'react-native'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme } from '@/theme'

interface TempoSheetProps {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
  /** Content scrolls internally (long forms/lists). Wraps children in a ScrollView. */
  scroll?: boolean
  /**
   * Fixed snap point (e.g. ['85%']). The first entry sets the sheet's HEIGHT.
   * Omit for the default: the sheet sizes to its content, capped at 90% — right
   * for short sheets (option pickers, single-field forms). Give an explicit value
   * for sheets that hold their own scrollable list, so that list gets a bounded
   * height to scroll within.
   */
  snapPoints?: (string | number)[]
  style?: object
}

// First snap point → height fraction (0–0.95). Percentage strings ('92%') and
// bare numbers ≤1 are fractions; larger numbers are treated as a fraction of the
// screen via a soft cap. Returns null when no snap point is given (content-sized).
function snapFraction(snapPoints?: (string | number)[]): number | null {
  if (!snapPoints || snapPoints.length === 0) return null
  const v = snapPoints[0]
  if (typeof v === 'number') return v <= 1 ? v : Math.min(0.95, v / 100)
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(v.trim())
  return m ? Math.min(0.95, parseFloat(m[1]) / 100) : null
}

export function TempoSheet({ visible, onClose, children, scroll, snapPoints, style }: TempoSheetProps) {
  const C = useTheme()

  // Keep the Modal mounted through its close animation: flip to visible immediately
  // on open; on close, let RN play the slide-out before unmounting.
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) { setMounted(true); return }
    const id = setTimeout(() => setMounted(false), 220)
    return () => clearTimeout(id)
  }, [visible])
  if (!mounted && !visible) return null

  const frac = snapFraction(snapPoints)
  const fixed = frac != null
  const sheetSize: ViewStyle = fixed
    ? { height: `${Math.round(frac * 100)}%` as `${number}%` }
    : { maxHeight: '90%' }

  const body = scroll ? (
    // fixed height → fill it (flex:1); content-sized → shrink so it caps at the
    // sheet's maxHeight and scrolls, yet still hugs short content.
    <ScrollView
      style={[fixed ? styles.fill : styles.shrink, style]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[fixed ? styles.fill : undefined, style]}>{children}</View>
  )

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Backdrop — tap to dismiss. */}
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, sheetSize, { backgroundColor: C.surface }]}>
            {/* Handle also dismisses (the affordance looks draggable). */}
            <Pressable onPress={onClose} hitSlop={12} style={styles.handleTap}>
              <View style={[styles.handle, { backgroundColor: C.outlineVariant }]} />
            </Pressable>
            {body}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  kav: { justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    overflow: 'hidden',
  },
  handleTap: { alignItems: 'center', paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  handle: { width: 40, height: 4, borderRadius: Radius.full },
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  scrollContent: { paddingBottom: 32 },
})
