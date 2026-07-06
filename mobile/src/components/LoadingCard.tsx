import { StyleSheet, View } from 'react-native'
import { Shimmer } from '@/components/motion'
import { useThemedStyles, type Palette } from '@/theme'

// A content-shaped skeleton (badge + title + two meta chips + action bar) that
// pulses while data loads — reads as "a card is coming", not just a grey block.
export function LoadingCard() {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.card}>
      <Shimmer style={styles.badge} />
      <Shimmer style={styles.title} />
      <View style={styles.metaRow}>
        <Shimmer style={styles.chip} />
        <Shimmer style={styles.chip} />
      </View>
      <Shimmer style={styles.bar} />
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  card: {
    borderRadius: 16,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    padding: 16,
    gap: 12,
  },
  badge: { width: 96, height: 16, borderRadius: 8, backgroundColor: C.surfaceContainerHigh },
  title: { width: '70%', height: 22, borderRadius: 8, backgroundColor: C.surfaceContainerHigh },
  metaRow: { flexDirection: 'row', gap: 8 },
  chip: { width: 80, height: 14, borderRadius: 7, backgroundColor: C.surfaceContainerHigh },
  bar: { height: 40, borderRadius: 12, backgroundColor: C.surfaceContainerHigh, marginTop: 4 },
})
