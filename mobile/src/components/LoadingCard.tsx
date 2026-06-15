import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { Colors } from '@/constants/theme'

const C = Colors.light

export function LoadingCard() {
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start()
  }, [opacity])

  return <Animated.View style={[styles.card, { opacity }]} />
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    height: 120,
    backgroundColor: C.surfaceContainerLow,
  },
})
