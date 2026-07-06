// Tempo — motion toolkit.
//
// Small, dependency-light building blocks for the app's animation pass:
//   • PressableScale — tactile press feedback (scale dip) for buttons/cards
//   • FadeInView     — staggered entrance for cards/list items
//   • PopIn          — celebratory spring-in for hero moments
//   • Shimmer        — pulsing skeleton fill for loading states
//   • useReducedMotion / useScreenFocused — shared hooks
//
// One hard rule, learned from a real bug: content must NEVER be able to get
// stuck invisible. Entrances render at rest (fully visible), dip to their
// hidden pose only in the same JS tick the animation starts, and run on plain
// JS Animated — no Reanimated `entering` layout animations, which can silently
// fail to fire when a screen mounts mid-transition on the new architecture.
// If an entrance is ever skipped, the worst case is "no animation", never
// "no content".

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo, Animated, Easing, Pressable,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native'
import { useIsFocused } from 'expo-router'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduce(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => { mounted = false; sub.remove() }
  }, [])
  return reduce
}

// Whether the enclosing screen is focused. Screens mount unfocused now that all
// tabs render at startup (lazy: false), so entrances wait for first focus —
// otherwise they'd play invisibly before the user ever sees the tab. Must render
// inside a screen (everything in this app does).
export function useScreenFocused(): boolean {
  return useIsFocused()
}

interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  scaleTo?: number
  /** Accepted for drop-in parity with TouchableOpacity; visual feedback is the scale. */
  activeOpacity?: number
}

// A press target that gently scales down on touch and springs back — the core
// "tactile" feel. Full drop-in for TouchableOpacity: the Pressable itself is the
// animated, styled element, so layout styles (flex, absolute positioning) apply
// to the real touch target and every Pressable prop passes through.
export function PressableScale({
  children, style, scaleTo = 0.96, activeOpacity: _activeOpacity,
  disabled, onPressIn, onPressOut, ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current
  const to = (v: number, bounciness = 0) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness }).start()
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      disabled={disabled}
      onPressIn={(e) => { if (!disabled) to(scaleTo); onPressIn?.(e) }}
      onPressOut={(e) => { to(1, 5); onPressOut?.(e) }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  )
}

// Wraps a tab screen's content in a soft focus entrance: each time the screen
// regains focus it rises 10px and fades from 55% — the "smooth transition"
// between tabs, owned by the screen instead of the navigator so an interrupted
// transition can never strand a scene hidden. Rest state is fully visible; the
// dip below happens only in the tick the animation starts. Reduce-Motion aware.
export function ScreenTransition({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion()
  const focused = useScreenFocused()
  const opacity = useRef(new Animated.Value(1)).current
  const translateY = useRef(new Animated.Value(0)).current
  const wasFocused = useRef(focused)

  useEffect(() => {
    const regained = focused && !wasFocused.current
    wasFocused.current = focused
    if (!regained || reduce) return
    opacity.setValue(0.55)
    translateY.setValue(10)
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ])
    anim.start()
    return () => {
      anim.stop()
      opacity.setValue(1)
      translateY.setValue(0)
    }
  }, [focused, reduce, opacity, translateY])

  return (
    <Animated.View style={[{ flex: 1 }, style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  )
}

interface FadeInViewProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  delay?: number
  duration?: number
  disabled?: boolean
}

// Entrance: fade + rise. Plays once, on the first frame the screen is actually
// focused. Skips under Reduce Motion (renders at rest).
export function FadeInView({ children, style, delay = 0, duration = 320, disabled }: FadeInViewProps) {
  const reduce = useReducedMotion()
  const focused = useScreenFocused()
  const opacity = useRef(new Animated.Value(1)).current
  const translateY = useRef(new Animated.Value(0)).current
  const played = useRef(false)

  useEffect(() => {
    if (played.current || disabled) return
    if (reduce) { played.current = true; return }
    if (!focused) return
    played.current = true
    opacity.setValue(0)
    translateY.setValue(12)
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ])
    anim.start()
    return () => {
      // If we're torn down mid-flight, land at rest — visible, always.
      anim.stop()
      opacity.setValue(1)
      translateY.setValue(0)
    }
  }, [focused, reduce, disabled, opacity, translateY, delay, duration])

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  )
}

// Celebratory spring-in (scale + fade), for hero moments like the completion badge.
export function PopIn({ children, style, delay = 0, disabled }: FadeInViewProps) {
  const reduce = useReducedMotion()
  const focused = useScreenFocused()
  const opacity = useRef(new Animated.Value(1)).current
  const scale = useRef(new Animated.Value(1)).current
  const played = useRef(false)

  useEffect(() => {
    if (played.current || disabled) return
    if (reduce) { played.current = true; return }
    if (!focused) return
    played.current = true
    opacity.setValue(0)
    scale.setValue(0.5)
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, delay, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, delay, friction: 5, tension: 120, useNativeDriver: true }),
    ])
    anim.start()
    return () => {
      anim.stop()
      opacity.setValue(1)
      scale.setValue(1)
    }
  }, [focused, reduce, disabled, opacity, scale, delay])

  return (
    <Animated.View style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  )
}

// A pulsing skeleton block for loading states.
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion()
  const opacity = useRef(new Animated.Value(0.45)).current
  useEffect(() => {
    if (reduce) { opacity.setValue(0.6); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduce, opacity])
  return <Animated.View style={[style, { opacity }]} />
}
