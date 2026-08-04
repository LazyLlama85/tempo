// Tempo — PR Browser (modal).
//
// The Progress tab's Personal Records card only ever showed the 5 most recent
// PRs, with no way to look up an arbitrary exercise's history — you could see
// your bench PR because you happened to hit one recently, but not your squat if
// you hadn't. This is a plain search over the same shared exercise library
// (lib/exerciseSearch, used everywhere else) — pick anything, see its trend.

import { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList } from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import {
  useExerciseLibrary, searchLibrary, groupFamilies, muscleGroupOf, MUSCLE_GROUPS,
} from '@/lib/exerciseSearch'

export default function PrBrowserScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()

  const { data: library, isLoading } = useExerciseLibrary()
  const [query, setQuery] = useState('')

  // Flat, representative-only list (one row per movement family) — a PR search
  // cares about the movement, not every equipment variant of it.
  const rows = useMemo(
    () => groupFamilies(searchLibrary(library ?? [], query)).map((f) => f.representative),
    [library, query],
  )

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Search Your PRs"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={C.outline} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search an exercise…"
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

      {isLoading ? (
        <View style={styles.center}><PulseLoader caption="Loading exercises…" /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(ex) => ex.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={<Text style={styles.emptyText}>Nothing matches — try a different search.</Text>}
          renderItem={({ item }) => {
            const groupLabel = MUSCLE_GROUPS.find((g) => g.id === muscleGroupOf(item))?.label
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/exercise-progress', params: { exerciseId: item.id, name: item.name } })}
              >
                <View style={styles.rowIcon}><Ionicons name="trending-up" size={17} color={C.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                  {!!groupLabel && <Text style={styles.rowMeta}>{groupLabel}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={15} color={C.outline} />
              </TouchableOpacity>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.sm,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, height: 44,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', paddingVertical: Spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: Radius.md,
    backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center',
  },
  rowName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  rowMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1, textTransform: 'capitalize' },
})
