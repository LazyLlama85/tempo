// Tempo — SvgProgressRing.
//
// A true stroke-based circular progress ring (react-native-svg), for the
// Progress tab's Consistency Score — the WHOOP/Apple-Fitness reference point
// this was designed against uses a soft gradient stroke, not a flat fill. The
// original `AnimatedRing` (two clipped half-circle Views, no SVG) stays as-is
// for its other call sites (Home's weekly target, workout-complete) — this is
// additive, not a replacement, so nothing else changes behavior.

import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, View } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import { useTheme } from '@/theme'
import { useReducedMotion, useScreenFocused } from '@/components/motion'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

interface Props {
  /** 0–100 */
  value: number
  size?: number
  stroke?: number
  trackColor?: string
  gradientFrom?: string
  gradientTo?: string
  /** Rendered in the center of the ring. */
  children?: ReactNode
  duration?: number
  delay?: number
}

export function SvgProgressRing({
  value, size = 140, stroke = 14, trackColor, gradientFrom, gradientTo, children, duration = 900, delay = 0,
}: Props) {
  const C = useTheme()
  const reduce = useReducedMotion()
  const focused = useScreenFocused()
  const track = trackColor ?? C.surfaceContainerHigh
  const from = gradientFrom ?? C.primary
  const to = gradientTo ?? C.primary

  const target = Math.max(0, Math.min(100, value))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  const progress = useRef(new Animated.Value(0)).current
  const lastTarget = useRef(0)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (reduce) {
      progress.setValue(target)
      lastTarget.current = target
      return
    }
    if (!focused && !hasAnimated.current) return
    if (target === lastTarget.current && hasAnimated.current) return
    hasAnimated.current = true
    const travel = Math.abs(target - lastTarget.current)
    lastTarget.current = target
    const anim = Animated.timing(progress, {
      toValue: target,
      duration: duration + travel * 4,
      delay,
      useNativeDriver: false, // SVG stroke props aren't native-driver eligible
    })
    anim.start()
    return () => anim.stop()
  }, [target, focused, reduce, progress, duration, delay])

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  })

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id="tempoRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={from} />
            <Stop offset="100%" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#tempoRingGrad)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
      {children}
    </View>
  )
}
