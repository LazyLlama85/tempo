import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ThemedView } from '@/components/themed-view'
import { ThemedText } from '@/components/themed-text'
import { Colors, Spacing } from '@/constants/theme'
import { useColorScheme } from 'react-native'
import type { Equipment } from '@/types'

const OPTIONS: { id: Equipment; label: string; description: string }[] = [
  { id: 'full_gym', label: 'Full gym', description: 'Barbells, cables, machines — the works' },
  { id: 'dumbbells', label: 'Dumbbells only', description: 'Adjustable or fixed dumbbells at home' },
  { id: 'barbell', label: 'Barbell & plates', description: 'Home setup with a rack or bench' },
  { id: 'resistance_bands', label: 'Resistance bands', description: 'Bands and bodyweight only' },
  { id: 'bodyweight', label: 'No equipment', description: 'Bodyweight training anywhere' },
]

export default function EquipmentScreen() {
  const router = useRouter()
  const { goal, experience } = useLocalSearchParams<{ goal: string; experience: string }>()
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light']
  const [selected, setSelected] = useState<Equipment[]>([])

  const toggle = (id: Equipment) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    )
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary">Step 3 of 5</ThemedText>
          <ThemedText type="subtitle" style={styles.title}>What equipment do you have?</ThemedText>
          <ThemedText themeColor="textSecondary">Select all that apply. We'll only use what you actually have.</ThemedText>
        </View>

        <View style={styles.options}>
          {OPTIONS.map((option) => {
            const isSelected = selected.includes(option.id)
            return (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.option,
                  {
                    backgroundColor: colors.backgroundElement,
                    borderWidth: 1.5,
                    borderColor: isSelected ? '#3B82F6' : 'transparent',
                  },
                ]}
                onPress={() => toggle(option.id)}
                activeOpacity={0.7}
              >
                <View style={styles.optionRow}>
                  <View style={styles.optionText}>
                    <ThemedText type="smallBold">{option.label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{option.description}</ThemedText>
                  </View>
                  {isSelected && <View style={styles.checkmark} />}
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, { opacity: selected.length > 0 ? 1 : 0.35 }]}
          onPress={() =>
            router.push({
              pathname: '/onboarding/schedule',
              params: { goal, experience, equipment: selected.join(',') },
            })
          }
          disabled={selected.length === 0}
          activeOpacity={0.8}
        >
          <ThemedText type="smallBold" style={styles.nextText}>Continue</ThemedText>
        </TouchableOpacity>
      </SafeAreaView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  header: { gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 36 },
  options: { flex: 1, gap: Spacing.two },
  option: { padding: Spacing.three, borderRadius: 14 },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  optionText: { flex: 1, gap: 4 },
  checkmark: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#3B82F6' },
  nextButton: {
    backgroundColor: '#3B82F6',
    padding: Spacing.three,
    borderRadius: 14,
    alignItems: 'center',
  },
  nextText: { color: '#FFFFFF' },
})
