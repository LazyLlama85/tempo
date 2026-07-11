// Tempo — TimePickerSheet: a dependency-free 12-hour time picker.
//
// A bottom-sheet list of times in 15-minute steps, shown in 12-hour format. We
// roll our own (instead of @react-native-community/datetimepicker) so there's no
// extra native module / dev-client rebuild, and the look stays consistent with
// the rest of Tempo's dark sheets. Values are 'HH:MM:SS' (24h) for storage.

import { useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoSheet } from '@/components/TempoSheet'

const STEP = 15
const ROW_H = 48
const SNAP_FRACTION = 0.70   // must match the TempoSheet snapPoints={['70%']} below
const HEADER_H = 44          // approx. rendered height of the title/Clear row

export interface TimeOption { value: string; label: string }

// All 15-minute times in a day → [{ value: '06:30:00', label: '6:30 AM' }, …].
const OPTIONS: TimeOption[] = (() => {
  const out: TimeOption[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += STEP) {
      const ap = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 || 12
      out.push({
        value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
        label: `${h12}:${String(m).padStart(2, '0')} ${ap}`,
      })
    }
  }
  return out
})()

// '6:30 AM' for a stored 'HH:MM[:SS]' value (used by callers to render the row).
export function formatTime12(t: string | null | undefined): string {
  if (!t) return 'Not set'
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  if (Number.isNaN(h)) return 'Not set'
  return `${h % 12 || 12}:${mStr ?? '00'} ${h >= 12 ? 'PM' : 'AM'}`
}

// Normalise 'HH:MM' or 'HH:MM:SS' to the option key 'HH:MM:00' (snap to :00 secs).
function toKey(t: string | null | undefined): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  return `${(h ?? '00').padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}:00`
}

interface Props {
  visible: boolean
  value: string | null
  title: string
  onSelect: (value: string) => void
  onClose: () => void
  /** Show a "Clear" action (for optional fields like work/school hours). */
  onClear?: () => void
}

export function TimePickerSheet({ visible, value, title, onSelect, onClose, onClear }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { height: winH } = useWindowDimensions()
  const scrollRef = useRef<any>(null)
  const selectedKey = toKey(value)

  // gorhom's BottomSheetView (used for the non-`scroll` TempoSheet mode, needed
  // here to keep the header pinned above the list) has no bottom/height in its
  // default style — inside a fixed snapPoints sheet that leaves the nested
  // BottomSheetScrollView with no bounded viewport to scroll within, so it just
  // renders all 96 rows at full height and anything past the snap point is
  // clipped with no way to reach it (can't pick a time later than ~mid-afternoon).
  // Giving the list an explicit height (snap-point fraction of the window, minus
  // the header) restores real scrolling.
  const listHeight = Math.max(ROW_H * 3, winH * SNAP_FRACTION - HEADER_H - Spacing.sm - Math.max(insets.bottom, Spacing.md))

  // Jump the list to the current value when the sheet opens.
  useEffect(() => {
    if (!visible) return
    const idx = OPTIONS.findIndex(o => o.value === selectedKey)
    if (idx >= 0) {
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, idx * ROW_H - 120), animated: false }), 30)
    }
  }, [visible, selectedKey])

  return (
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['70%']}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {onClear && (
            <TouchableOpacity onPress={onClear} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        <BottomSheetScrollView ref={scrollRef} style={[styles.list, { height: listHeight }]} showsVerticalScrollIndicator={false}>
          {OPTIONS.map(o => {
            const sel = o.value === selectedKey
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.row, sel && styles.rowSel]}
                onPress={() => onSelect(o.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.rowText, sel && styles.rowTextSel]}>{o.label}</Text>
                {sel && <Ionicons name="checkmark" size={18} color={C.primary} />}
              </TouchableOpacity>
            )
          })}
          <View style={{ height: Spacing.lg }} />
        </BottomSheetScrollView>
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: {
    flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  title: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  clear: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.error },
  list: { marginTop: Spacing.xs },
  row: {
    height: ROW_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, borderRadius: Radius.md,
  },
  rowSel: { backgroundColor: C.primarySoft },
  rowText: { fontFamily: 'Inter_500Medium', fontSize: 16, color: C.textSecondary },
  rowTextSel: { fontFamily: 'Inter_700Bold', color: C.primary },
})
