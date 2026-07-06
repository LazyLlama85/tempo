// Tempo — AnimatedRing.
//
// A dependency-free circular progress ring that ANIMATES whenever its value
// changes (mount, refresh, live updates). Built from two clipped half-circle
// fills driven by one Animated value — the same geometry the static ring used,
// now with motion. No SVG, no extra native modules.

import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { Motion } from '@/constants/theme'
import { useTheme } from '@/theme'
import { useReducedMotion, useScreenFocused } from '@/components/motion'

interface Props {
  /** 0–100 */
  value: number
  size?: number
  stroke?: number
  color?: string
  trackColor?: string
  /** Center hole fill — match the parent card's background. */
  holeColor?: string
  /** Rendered in the center of the ring. */
  children?: ReactNode
  /** ms; scaled a little by how far the ring travels. */
  duration?: number
  delay?: number
}

export function AnimatedRing({
  value, size = 140, stroke = 14, color, trackColor, holeColor, children, duration = Motion.slow, delay = 0,
}: Props) {
  const C = useTheme()
  const reduce = useReducedMotion()
  const focused = useScreenFocused()
  const fill = color ?? C.primary
  const track = trackColor ?? C.surfaceContainerHigh
  const hole = holeColor ?? C.background

  const target = Math.max(0, Math.min(100, value))
  const progress = useRef(new Animated.Value(0)).current
  const lastTarget = useRef(0)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (reduce) {
      progress.setValue(target)
      lastTarget.current = target
      return
    }
    // Wait for first focus so the sweep happens in front of the user, then
    // animate every subsequent change from wherever the ring currently is.
    if (!focused && !hasAnimated.current) return
    if (target === lastTarget.current && hasAnimated.current) return
    hasAnimated.current = true
    const travel = Math.abs(target - lastTarget.current)
    lastTarget.current = target
    const anim = Animated.timing(progress, {
      toValue: target,
      duration: duration + travel * 4,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [target, focused, reduce, progress, duration, delay])

  const half = size / 2
  const inner = size - stroke * 2

  // Right half sweeps 12→6 o'clock across 0–50; left half 6→12 across 50–100.
  const rightRotate = progress.interpolate({
    inputRange: [0, 50], outputRange: ['180deg', '0deg'], extrapolate: 'clamp',
  })
  const leftRotate = progress.interpolate({
    inputRange: [50, 100], outputRange: ['-180deg', '0deg'], extrapolate: 'clamp',
  })
  // The left fill only exists past 50% — a continuous stand-in for the static
  // version's `p > 50 &&` conditional.
  const leftOpacity = progress.interpolate({
    inputRange: [0, 49.999, 50], outputRange: [0, 0, 1], extrapolate: 'clamp',
  })

  return (
    <View style={{ width: size, height: size, borderRadius: half, overflow: 'hidden', backgroundColor: track }}>
      {/* Right half */}
      <View style={{ position: 'absolute', top: 0, right: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View
          style={{
            position: 'absolute', top: 0, left: 0, width: half, height: size,
            backgroundColor: fill,
            transform: [
              { translateX: -(half / 2) },
              { rotate: rightRotate },
              { translateX: half / 2 },
            ],
          }}
        />
      </View>

      {/* Left half */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: half, height: size, overflow: 'hidden', opacity: leftOpacity }}>
        <Animated.View
          style={{
            position: 'absolute', top: 0, left: 0, width: half, height: size,
            backgroundColor: fill,
            transform: [
              { translateX: half / 2 },
              { rotate: leftRotate },
              { translateX: -(half / 2) },
            ],
          }}
        />
      </Animated.View>

      {/* Inner mask — the ring hole (must render on top) */}
      <View
        style={{
          position: 'absolute', top: stroke, left: stroke,
          width: inner, height: inner, borderRadius: inner / 2,
          backgroundColor: hole,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  )
}
