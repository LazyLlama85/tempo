// Tempo — a bottom-sheet option picker.
//
// Replaces multi-option Alert.alert menus: Android renders at most three alert
// buttons, so any list of choices (starter templates, split presets, …) silently
// lost options there — and a system alert reads generic besides. This is the
// branded, scrollable list the design system uses instead.

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { TempoSheet } from '@/components/TempoSheet'

export interface OptionSheetItem {
  key: string
  label: string
  sub?: string
  icon?: string
  // Destructive actions (Delete, Skip) render red — the affordance Alert.alert's
  // style:'destructive' gave before these menus moved into a sheet.
  destructive?: boolean
}

interface Props {
  visible: boolean
  title: string
  subtitle?: string
  options: OptionSheetItem[]
  onSelect: (key: string) => void
  onClose: () => void
}

export function OptionSheet({ visible, title, subtitle, options, onSelect, onClose }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()

  return (
    <TempoSheet visible={visible} onClose={onClose} scroll>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={styles.list}>
          {options.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={styles.row}
              onPress={() => onSelect(o.key)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={o.label}
            >
              {!!o.icon && (
                <View style={[styles.iconWrap, o.destructive && { backgroundColor: C.dangerSoft }]}>
                  <Ionicons name={o.icon as any} size={18} color={o.destructive ? C.error : C.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, o.destructive && { color: C.error }]} numberOfLines={1}>{o.label}</Text>
                {!!o.sub && <Text style={styles.rowSub} numberOfLines={2}>{o.sub}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.sm },
  title: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  list: { gap: Spacing.xs, marginTop: Spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 1 },
  cancelBtn: { height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg, backgroundColor: C.surfaceContainerLow, marginTop: Spacing.xs },
  cancelText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.textSecondary },
})
