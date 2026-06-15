import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Colors, Spacing } from '@/constants/theme'

const C = Colors.light

interface Props {
  message: string
  onRetry: () => void
}

export function ErrorBanner({ message, onRetry }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.message}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retry}>Retry</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF1F0',
    borderColor: '#FFCDD2',
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
