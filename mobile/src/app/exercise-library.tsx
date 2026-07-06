// Tempo — Exercise Library (modal).
//
// A browsable version of the whole movement library (1300+ built-ins + the user's
// custom exercises): instant ranked search by name/muscle/shorthand ("rdl", "ohp"),
// muscle-group and equipment filters, and a form guide (GIF + how-to + muscles) one
// tap away. This is where a beginner studies "what is a Romanian deadlift?" BEFORE
// the gym — previously exercises only ever appeared mid-session or in the builder.

import { useMemo, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ScrollView,
} from 'react-native'
import { PulseLoader } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { ExerciseFormSheet, type FormExercise } from '@/components/ExerciseFormSheet'
import {
  useExerciseLibrary, searchLibrary, groupFamilies, muscleGroupOf, MUSCLE_GROUPS,
  type ExerciseFamily,
} from '@/lib/exerciseSearch'
import { needsApparatus } from '@/lib/equipmentMatch'
import type { Exercise, MuscleGroup } from '@/types'

const EQUIP_FILTERS: { id: string; label: string }[] = [
  { id: 'bodyweight', label: 'No equipment' },
  { id: 'pull_up_bar', label: 'Pull-up bar' },
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'barbell', label: 'Barbell' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'full_gym', label: 'Machines & cables' },
  { id: 'resistance_bands', label: 'Bands' },
]

const EQUIP_SHORT: Record<string, string> = {
  full_gym: 'Machine', dumbbells: 'Dumbbells', barbell: 'Barbell',
  kettlebell: 'Kettlebell', resistance_bands: 'Bands', bodyweight: 'Bodyweight',
  pull_up_bar: 'Pull-up bar',
}

// Label a row's equipment: bodyweight moves that need a bar/dip/rings read
// "Pull-up bar", the rest use their first required-equipment tag.
function equipLabelFor(ex: Pick<Exercise, 'name' | 'required_equipment'>): string {
  if ((ex.required_equipment ?? []).includes('bodyweight') && needsApparatus(ex.name)) return 'Pull-up bar'
  return EQUIP_SHORT[ex.required_equipment?.[0] ?? ''] ?? ''
}

// Flattened list model: a movement family's representative row, plus its variant
// rows when expanded.
type LibRow =
  | { type: 'rep'; family: ExerciseFamily }
  | { type: 'variant'; ex: Exercise; famKey: string }

export default function ExerciseLibraryScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()

  const { data: library, isLoading } = useExerciseLibrary()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<MuscleGroup | null>(null)
  const [equip, setEquip] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [formEx, setFormEx] = useState<FormExercise | null>(null)

  const families = useMemo(
    () => groupFamilies(searchLibrary(library ?? [], query, { muscleGroup: group, equipment: equip })),
    [library, query, group, equip],
  )

  const rows = useMemo<LibRow[]>(() => {
    const out: LibRow[] = []
    for (const fam of families) {
      out.push({ type: 'rep', family: fam })
      if (expanded.has(fam.key)) for (const ex of fam.members.slice(1)) out.push({ type: 'variant', ex, famKey: fam.key })
    }
    return out
  }, [families, expanded])

  const toggle = (key: string) =>
    setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const totalCount = useMemo(() => families.reduce((n, f) => n + f.members.length, 0), [families])

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close library">
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Exercise Library</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={C.outline} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises, muscles, “rdl”, “ohp”…"
          placeholderTextColor={C.outline}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={C.outline} />
          </TouchableOpacity>
        )}
      </View>

      {/* Muscle-group filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        <Chip label="All" on={group === null} onPress={() => setGroup(null)} styles={styles} />
        {MUSCLE_GROUPS.map(g => (
          <Chip key={g.id} label={g.label} on={group === g.id} onPress={() => setGroup(group === g.id ? null : g.id)} styles={styles} />
        ))}
      </ScrollView>

      {/* Equipment filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        <Chip label="Any equipment" on={equip === null} onPress={() => setEquip(null)} styles={styles} small />
        {EQUIP_FILTERS.map(e => (
          <Chip key={e.id} label={e.label} on={equip === e.id} onPress={() => setEquip(equip === e.id ? null : e.id)} styles={styles} small />
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}><PulseLoader caption="Loading exercises…" /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.type === 'rep' ? r.family.key : `v:${r.ex.id}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={16}
          maxToRenderPerBatch={24}
          windowSize={10}
          ListHeaderComponent={
            <Text style={styles.countText}>
              {totalCount} EXERCISE{totalCount === 1 ? '' : 'S'} · {families.length} MOVEMENT{families.length === 1 ? '' : 'S'}
            </Text>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>Nothing matches — try a different search or filter.</Text>
          }
          renderItem={({ item }) => item.type === 'variant'
            ? <VariantRow ex={item.ex} styles={styles} C={C} onPress={() => setFormEx(item.ex as FormExercise)} />
            : <FamilyRow family={item.family} styles={styles} C={C}
                isOpen={expanded.has(item.family.key)}
                onToggle={() => toggle(item.family.key)}
                onPress={() => setFormEx(item.family.representative as FormExercise)} />
          }
        />
      )}

      <ExerciseFormSheet exercise={formEx} onClose={() => setFormEx(null)} />
    </SafeAreaView>
  )
}

function FamilyRow({ family, styles, C, isOpen, onToggle, onPress }: {
  family: ExerciseFamily; styles: any; C: Palette; isOpen: boolean; onToggle: () => void; onPress: () => void
}) {
  const item = family.representative
  const count = family.members.length
  const groupLabel = MUSCLE_GROUPS.find(g => g.id === muscleGroupOf(item))?.label
  const equip = equipLabelFor(item)
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Ionicons name={item.is_custom ? 'construct-outline' : 'barbell-outline'} size={17} color={C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
          {item.is_custom && <View style={styles.customTag}><Text style={styles.customTagText}>CUSTOM</Text></View>}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[groupLabel, equip, item.experience_level].filter(Boolean).join(' · ')}
        </Text>
        {count > 1 && (
          <TouchableOpacity style={styles.variationsBtn} onPress={onToggle} hitSlop={8}>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={C.primary} />
            <Text style={styles.variationsText}>{isOpen ? 'Hide' : `${count - 1} more`} variation{count - 1 === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Ionicons name="chevron-forward" size={15} color={C.outline} />
    </TouchableOpacity>
  )
}

function VariantRow({ ex, styles, C, onPress }: { ex: Exercise; styles: any; C: Palette; onPress: () => void }) {
  const equip = equipLabelFor(ex)
  return (
    <TouchableOpacity style={styles.variantRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.variantTick} />
      <View style={{ flex: 1 }}>
        <Text style={styles.variantName} numberOfLines={1}>{ex.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{[equip, ex.experience_level].filter(Boolean).join(' · ')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={C.outline} />
    </TouchableOpacity>
  )
}

function Chip({ label, on, onPress, styles, small }: { label: string; on: boolean; onPress: () => void; styles: any; small?: boolean }) {
  return (
    <TouchableOpacity style={[styles.chip, small && styles.chipSmall, on && styles.chipOn]} onPress={onPress} activeOpacity={0.8}>
      <Text
        style={[styles.chipText, small && styles.chipTextSmall, on && styles.chipTextOn]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, height: 44,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text },
  chipScroll: { flexGrow: 0 },
  chipRow: { gap: Spacing.xs, paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.sm, alignItems: 'center' },
  chip: {
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant,
    backgroundColor: C.background, paddingHorizontal: Spacing.md + 2,
    minHeight: 40, alignItems: 'center', justifyContent: 'center',
  },
  chipSmall: { minHeight: 38, borderWidth: 1.5 },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 14.5, lineHeight: 20, color: C.textSecondary },
  chipTextSmall: { fontSize: 13.5, lineHeight: 19 },
  chipTextOn: { color: C.onPrimary },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl },
  countText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, paddingVertical: Spacing.xs },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', paddingVertical: Spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: Radius.md,
    backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  rowName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, flexShrink: 1 },
  customTag: { backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  customTagText: { fontFamily: 'Inter_700Bold', fontSize: 8, color: C.primary, letterSpacing: 0.5 },
  rowMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1, textTransform: 'capitalize' },
  variationsBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, alignSelf: 'flex-start' },
  variationsText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.2 },
  variantRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm, paddingLeft: Spacing.xl,
    borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh, backgroundColor: C.surfaceContainerLow,
  },
  variantTick: { width: 3, height: 24, borderRadius: 2, backgroundColor: C.outlineVariant },
  variantName: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },
})
