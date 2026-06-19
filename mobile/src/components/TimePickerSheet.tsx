// Tempo — TimePickerSheet: a dependency-free 12-hour time picker.
//
// A bottom-sheet list of times in 15-minute steps, shown in 12-hour format. We
// roll our own (instead of @react-native-community/datetimepicker) so there's no
// extra native module / dev-client rebuild, and the look stays consistent with
// the rest of Tempo's dark sheets. Values are 'HH:MM:SS' (24h) for storage.

import { useEffect, useRef } from 'react'
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'

const C = Colors.light
const STEP = 15
const ROW_H = 48

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
  const scrollRef = useRef<ScrollView>(null)
  const selectedKey = toKey(value)

  // Jump the list to the current value when the sheet opens.
  useEffect(() => {
    if (!visible) return
    const idx = OPTIONS.findIndex(o => o.value === selectedKey)
    if (idx >= 0) {
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, idx * ROW_H - 120), animated: false }), 30)
    }
  }, [visible, selectedKey])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {onClear && (
              <TouchableOpacity onPress={onClear} hitSlop={8}>
                <Text style={styles.clear}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView ref={scrollRef} style={styles.list} showsVerticalScrollIndicator={false}>
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
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md, maxHeight: '70%',
  },
  handle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.text, letterSpacing: -0.3 },
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
