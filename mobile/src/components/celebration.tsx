// Tempo — celebration toolkit.
//
//   • ConfettiBurst — a one-shot, tasteful confetti fall for real milestones
//   • CountUp       — numbers that tick up to their value (stats feel earned)
//
// Both honor Reduce Motion (confetti skipped, numbers render final value) and
// are pure JS — no native modules, nothing can strand mid-transition.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated, Easing, StyleSheet, Text, useWindowDimensions,
  type StyleProp, type TextStyle,
} from 'react-native'
import { useTheme } from '@/theme'
import { useReducedMotion } from '@/components/motion'

// ── Confetti ──────────────────────────────────────────────────────────────────

interface ConfettiProps {
  /** Re-fires whenever this changes to a new truthy value. */
  trigger?: boolean
  count?: number
  duration?: number
  colors?: string[]
  onDone?: () => void
}

interface Piece {
  x: number          // 0–1 of screen width
  drift: number      // px sideways over the fall
  size: number
  color: string
  delay: number
  spin: string       // final rotation, e.g. '720deg'
  fall: number       // 0–1 how far down the screen it lands
  round: boolean     // circles + rectangles mix
}

// A brief, physical-feeling confetti fall from the top of the screen. One shot:
// pieces mount, fall with a decelerating ease, fade, and unmount — nothing loops,
// nothing lingers, taps pass straight through.
export function ConfettiBurst({ trigger = true, count = 28, duration = 2400, colors, onDone }: ConfettiProps) {
  const C = useTheme()
  const reduce = useReducedMotion()
  const { width, height } = useWindowDimensions()
  const [live, setLive] = useState(false)
  const progress = useRef(new Animated.Value(0)).current

  const palette = colors ?? [C.primary, C.primaryBright, C.gold, C.success, C.ember]

  const pieces = useMemo<Piece[]>(() => {
    if (!live) return []
    return Array.from({ length: count }, (_, i) => ({
      x: Math.random(),
      drift: (Math.random() - 0.5) * 140,
      size: 6 + Math.random() * 6,
      color: palette[i % palette.length],
      delay: Math.random() * 260,
      spin: `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.round(Math.random() * 540))}deg`,
      fall: 0.5 + Math.random() * 0.4,
      round: Math.random() < 0.35,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, count])

  useEffect(() => {
    if (!trigger || reduce) return
    setLive(true)
    progress.setValue(0)
    const anim = Animated.timing(progress, {
      toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true,
    })
    anim.start(() => {
      setLive(false)
      onDone?.()
    })
    return () => anim.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, reduce])

  if (!live) return null

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
      {pieces.map((p, i) => {
        const translateY = progress.interpolate({
          inputRange: [0, 1], outputRange: [-30, height * p.fall],
        })
        const translateX = progress.interpolate({
          inputRange: [0, 1], outputRange: [0, p.drift],
        })
        const rotate = progress.interpolate({
          inputRange: [0, 1], outputRange: ['0deg', p.spin],
        })
        const opacity = progress.interpolate({
          inputRange: [0, 0.05, 0.75, 1], outputRange: [0, 1, 1, 0],
        })
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: p.x * width,
              top: 0,
              width: p.size,
              height: p.round ? p.size : p.size * 1.7,
              borderRadius: p.round ? p.size / 2 : 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        )
      })}
    </Animated.View>
  )
}

// ── CountUp ───────────────────────────────────────────────────────────────────

interface CountUpProps {
  value: number
  duration?: number
  delay?: number
  style?: StyleProp<TextStyle>
  /** Format the in-flight value (default: rounded, locale-grouped). */
  formatter?: (v: number) => string
}

// A stat that ticks up from its previous value — progress you can watch land.
// Reduce Motion (or a 0 target) renders the final number immediately.
export function CountUp({ value, duration = 900, delay = 0, style, formatter }: CountUpProps) {
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(() => (reduce ? value : 0))
  const fromRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (reduce || value === fromRef.current) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    const startAt = Date.now() + delay
    const tick = () => {
      const t = (Date.now() - startAt) / duration
      if (t >= 1) {
        fromRef.current = value
        setDisplay(value)
        return
      }
      if (t > 0) {
        const eased = 1 - Math.pow(1 - t, 3)
        setDisplay(from + (value - from) * eased)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      // Land on the final value even if interrupted — never a stuck partial.
      fromRef.current = value
      setDisplay(value)
    }
  }, [value, reduce, duration, delay])

  const text = formatter ? formatter(display) : Math.round(display).toLocaleString()
  return <Text style={style}>{text}</Text>
}
