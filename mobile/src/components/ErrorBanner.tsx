import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Colors, Spacing } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'


interface Props {
  message: string
  onRetry: () => void
}

export function ErrorBanner({ message, onRetry }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.card}>
      <Text style={styles.message}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retry}>Retry</Text>
      </TouchableOpacity>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  card: {
    backgroundColor: C.dangerSoft,
    borderColor: 'rgba(255,107,107,0.35)',
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  message: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.error,
    lineHeight: 20,
  },
  retry: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.error,
    marginLeft: Spacing.md,
  },
})
