// Tempo — exercise picker (bottom sheet).
//
// Search the library (built-ins + the user's custom exercises) and add exercises
// to the workout being built. The whole library is cached client-side, so results
// are instant and ranked (see lib/exerciseSearch) — and near-identical variants of
// the same movement (barbell / dumbbell / cable bench press …) are COLLAPSED into
// one family row that expands on demand, so a search for "bench" isn't 40 rows of
// scrolling. Each row has an info button (form GIF + how-to) so you can confirm
// it's the right movement before adding. The sheet keeps a FIXED tall height with
// a KeyboardAvoidingView so results stay visible above the keyboard while typing.

import { useMemo, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native'
import { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { TempoSheet } from '@/components/TempoSheet'
import { PulseLoader } from '@/components/brand'
import {
  useExerciseLibrary, searchLibrary, groupFamilies, muscleGroupOf, MUSCLE_GROUPS,
  type ExerciseFamily,
} from '@/lib/exerciseSearch'
import { CustomExerciseSheet } from '@/components/CustomExerciseSheet'
import { ExerciseFormSheet, type FormExercise } from '@/components/ExerciseFormSheet'
import type { Exercise, MuscleGroup } from '@/types'

interface Props {
  visible: boolean
  userId: string
  client: SupabaseClient
  existingIds: string[]
  onClose: () => void
  onAdd: (ex: Exercise) => void
  // Tapping an already-added exercise's circle removes it (undo an accidental add
  // without leaving the search). Optional so older callers still compile.
  onRemove?: (ex: Exercise) => void
}

const EQUIP_SHORT: Record<string, string> = {
  full_gym: 'Machine', dumbbells: 'Dumbbells', barbell: 'Barbell',
  kettlebell: 'Kettlebell', resistance_bands: 'Bands', bodyweight: 'Bodyweight',
}

// Flattened list model: a family's representative row, plus its variant rows when
// the family is expanded.
type Row =
  | { type: 'rep'; family: ExerciseFamily }
  | { type: 'variant'; ex: Exercise; famKey: string }

export function ExercisePickerSheet({ visible, userId, client, existingIds, onClose, onAdd, onRemove }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<MuscleGroup | null>(null)
  const [added, setAdded] = useState<Set<string>>(() => new Set(existingIds))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [formEx, setFormEx] = useState<FormExercise | null>(null)

  const { data: library, isLoading, refetch } = useExerciseLibrary(visible)

  // Re-sync the "already in this workout" set each time the sheet opens.
  const [wasVisible, setWasVisible] = useState(visible)
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setAdded(new Set(existingIds))
      setQuery('')
      setGroup(null)
      setExpanded(new Set())
    }
  }

  const families = useMemo(
    () => groupFamilies(searchLibrary(library ?? [], query, { muscleGroup: group })),
    [library, query, group],
  )

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const fam of families) {
      out.push({ type: 'rep', family: fam })
      if (expanded.has(fam.key)) {
        for (const ex of fam.members.slice(1)) out.push({ type: 'variant', ex, famKey: fam.key })
      }
    }
    return out
  }, [families, expanded])

  const handleAdd = (ex: Exercise) => {
    onAdd(ex)
    setAdded(s => new Set(s).add(ex.id))
  }
  const handleRemove = (ex: Exercise) => {
    onRemove?.(ex)
    setAdded(s => { const n = new Set(s); n.delete(ex.id); return n })
  }
  const toggle = (key: string) =>
    setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  // The circle is a toggle: tap to add, tap the checkmark again to remove (undo an
  // accidental add without leaving the search). Removal needs an onRemove handler.
  const renderAddButton = (ex: Exercise) => {
    const isAdded = added.has(ex.id)
    return (
      <TouchableOpacity
        onPress={() => (isAdded ? handleRemove(ex) : handleAdd(ex))}
        disabled={isAdded && !onRemove}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={isAdded ? `Remove ${ex.name}` : `Add ${ex.name}`}
      >
        <Ionicons
          name={isAdded ? 'checkmark-circle' : 'add-circle'}
          size={26}
          color={isAdded ? C.success : C.primary}
        />
      </TouchableOpacity>
    )
  }
  const renderInfoButton = (ex: Exercise) => (
    <TouchableOpacity
      onPress={() => setFormEx(ex as FormExercise)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`How to do ${ex.name}`}
    >
      <Ionicons name="information-circle-outline" size={22} color={C.outline} />
    </TouchableOpacity>
  )

  return (
    <TempoSheet visible={visible} onClose={onClose} snapPoints={['92%']}>
      <View style={styles.sheet}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Add exercises</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={C.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={C.outline} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search 1,300+ exercises…"
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label="All" on={group === null} onPress={() => setGroup(null)} styles={styles} />
          {MUSCLE_GROUPS.map(g => (
            <Chip key={g.id} label={g.label} on={group === g.id} onPress={() => setGroup(group === g.id ? null : g.id)} styles={styles} />
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={styles.center}><PulseLoader caption="Loading exercises…" /></View>
        ) : (
          <BottomSheetFlatList
            data={rows}
            keyExtractor={(r) => r.type === 'rep' ? r.family.key : `v:${r.ex.id}`}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: Spacing.lg }}
            initialNumToRender={14}
            maxToRenderPerBatch={20}
            windowSize={8}
            ListHeaderComponent={
              <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)} activeOpacity={0.85}>
                <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                <Text style={styles.newBtnText}>New custom exercise</Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                No exercises match “{query}”. Try a muscle (“chest”), a movement (“press”), or create a custom one above.
              </Text>
            }
            renderItem={({ item }) => {
              if (item.type === 'variant') {
                const ex = item.ex
                const equip = EQUIP_SHORT[ex.required_equipment?.[0] ?? ''] ?? ''
                return (
                  <View style={styles.variantRow}>
                    <View style={styles.variantTick} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.variantName} numberOfLines={1}>{ex.name}</Text>
                      <Text style={styles.exMeta} numberOfLines={1}>{[equip, ex.experience_level].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {renderInfoButton(ex)}
                    {renderAddButton(ex)}
                  </View>
                )
              }
              const fam = item.family
              const ex = fam.representative
              const count = fam.members.length
              const isOpen = expanded.has(fam.key)
              const groupLabel = MUSCLE_GROUPS.find(g => g.id === muscleGroupOf(ex))?.label
              const equip = EQUIP_SHORT[ex.required_equipment?.[0] ?? ''] ?? ''
              return (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.exName} numberOfLines={1}>{ex.name}</Text>
                      {ex.is_custom && <View style={styles.customTag}><Text style={styles.customTagText}>CUSTOM</Text></View>}
                    </View>
                    <Text style={styles.exMeta} numberOfLines={1}>
                      {[groupLabel, equip, ex.experience_level].filter(Boolean).join(' · ')}
                    </Text>
                    {count > 1 && (
                      <TouchableOpacity style={styles.variationsBtn} onPress={() => toggle(fam.key)} hitSlop={6}>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={C.primary} />
                        <Text style={styles.variationsText}>
                          {isOpen ? 'Hide' : `${count - 1} more`} variation{count - 1 === 1 ? '' : 's'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {renderInfoButton(ex)}
                  {renderAddButton(ex)}
                </View>
              )
            }}
          />
        )}
      </View>

      <CustomExerciseSheet
        visible={createOpen}
        userId={userId}
        client={client}
        onClose={() => setCreateOpen(false)}
        onSaved={(ex) => { handleAdd(ex); refetch() }}
      />
      <ExerciseFormSheet exercise={formEx} onClose={() => setFormEx(null)} />
    </TempoSheet>
  )
}

function Chip({ label, on, onPress, styles }: { label: string; on: boolean; onPress: () => void; styles: any }) {
  return (
    <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { flex: 1, padding: Spacing.lg, paddingBottom: 0, gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md, height: 46 },
  searchInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text },
  chipScroll: { flexGrow: 0 },
  chipRow: { gap: Spacing.xs, paddingVertical: 2 },
  chip: {
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant,
    backgroundColor: C.background, paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  chipTextOn: { color: C.onPrimary },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: C.primary, backgroundColor: C.surfaceContainerLow, marginBottom: Spacing.xs,
  },
  newBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', paddingVertical: Spacing.lg, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  exName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, flexShrink: 1 },
  customTag: { backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  customTagText: { fontFamily: 'Inter_700Bold', fontSize: 8, color: C.primary, letterSpacing: 0.5 },
  exMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  variationsBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, alignSelf: 'flex-start' },
  variationsText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.2 },
  variantRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm - 1, paddingLeft: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh, backgroundColor: C.surfaceContainerLow,
  },
  variantTick: { width: 3, height: 26, borderRadius: 2, backgroundColor: C.outlineVariant },
  variantName: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },
})
