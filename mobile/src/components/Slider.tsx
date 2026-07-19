// Tempo — a dependency-free horizontal slider (drag-to-set-a-number).
//
// Built on RN's own PanResponder rather than a native slider library — no new
// native module, no rebuild, ships via `eas update` like every other primitive in
// this file's family (AnimatedRing, SvgProgressRing). Used for onboarding's
// personal-data questions (starting weight) where a drag feels more like a real
// fitness app's first-run than a bare numeric keyboard.
//
// Bug fix (2026-07-19): dragging inside a ScrollView (onboarding's weight step)
// used to scroll the PAGE instead of moving the thumb — RN's PanResponder claims
// the responder on `onStartShouldSetPanResponder`, but without also claiming it in
// the CAPTURE phase and refusing to release it, the ancestor ScrollView's own
// native pan recognizer can still win the touch (or reclaim it mid-drag) once the
// user's finger moves far enough to look like a scroll gesture. Fixed by claiming
// in the capture phase (`onStartShouldSetPanResponderCapture` /
// `onMoveShouldSetPanResponderCapture`) and refusing every termination request
// (`onPanResponderTerminationRequest: () => false`) — once the thumb is grabbed,
// nothing above it in the tree can take the gesture back.

import { useMemo, useRef, useState } from 'react'
import { Animated, View, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native'
import { Radius, Spacing, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import * as haptics from '@/lib/haptics'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  onSlidingComplete?: (v: number) => void
  accessibilityLabel?: string
  /** Format the floating value bubble shown while dragging (default: plain number). */
  formatValue?: (v: number) => string
}

export function Slider({ value, min, max, step = 1, onChange, onSlidingComplete, accessibilityLabel, formatValue }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [trackWidth, setTrackWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  const lastStepped = useRef(value)
  const thumbScale = useRef(new Animated.Value(1)).current
  const bubbleOpacity = useRef(new Animated.Value(0)).current

  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const snap = (v: number) => clamp(Math.round((v - min) / step) * step + min)
  const pct = trackWidth > 0 ? (clamp(value) - min) / (max - min) : 0

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)

  const respond = (x: number) => {
    if (trackWidth <= 0) return
    const raw = min + (x / trackWidth) * (max - min)
    const next = snap(raw)
    if (next !== lastStepped.current) { lastStepped.current = next; haptics.tapLight() }
    onChange(next)
  }

  const grab = (x: number) => {
    setDragging(true)
    Animated.parallel([
      Animated.spring(thumbScale, { toValue: 1.25, useNativeDriver: true, speed: 30, bounciness: 8 }),
      Animated.timing(bubbleOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start()
    respond(x)
  }
  const release = () => {
    setDragging(false)
    Animated.parallel([
      Animated.spring(thumbScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }),
      Animated.timing(bubbleOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start()
    onSlidingComplete?.(lastStepped.current)
  }

  const pan = useMemo(() => PanResponder.create({
    // Claim the gesture in the CAPTURE phase (before any ancestor's own responder
    // logic runs) so the parent ScrollView never gets first refusal on a touch that
    // started on the thumb/track.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once granted, never hand the gesture back — this is what actually stops the
    // ScrollView from "stealing" a drag partway through.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => grab(e.nativeEvent.locationX),
    onPanResponderMove: (e) => respond(e.nativeEvent.locationX),
    onPanResponderRelease: release,
    onPanResponderTerminate: release,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [trackWidth, min, max, step])

  const bubbleText = formatValue ? formatValue(value) : String(value)
  const thumbLeftPct = pct * 100

  return (
    <View style={styles.wrap}>
      {/* Floating value bubble — appears above the thumb while dragging */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bubble,
          {
            left: `${thumbLeftPct}%` as `${number}%`,
            opacity: bubbleOpacity,
            transform: [
              { translateX: -22 },
              { scale: bubbleOpacity.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
            ],
          },
        ]}
      >
        <View style={styles.bubbleInner}>
          <Animated.Text style={styles.bubbleText}>{bubbleText}</Animated.Text>
        </View>
        <View style={styles.bubbleArrow} />
      </Animated.View>

      <View
        style={styles.track}
        onLayout={onLayout}
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value }}
      >
        <View style={styles.trackBg} />
        <View style={[styles.fill, { width: `${thumbLeftPct}%` }]}>
          <View style={styles.fillGradientTop} />
        </View>
        {/* Tick marks at 0/25/50/75/100% — a quiet sense of scale on the track */}
        {[0, 25, 50, 75, 100].map((t) => (
          <View key={t} pointerEvents="none" style={[styles.tick, { left: `${t}%` as `${number}%` }]} />
        ))}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: `${thumbLeftPct}%`,
              borderColor: C.primary,
              transform: [{ scale: thumbScale }],
            },
            dragging && styles.thumbActive,
          ]}
        >
          <View style={[styles.thumbDot, { backgroundColor: C.primary }]} />
        </Animated.View>
      </View>
    </View>
  )
}

const THUMB = 28
const TRACK_H = 10

const makeStyles = (C: Palette) => StyleSheet.create({
  wrap: { paddingTop: 34, paddingBottom: 14 },
  track: {
    height: TRACK_H, borderRadius: Radius.full,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    borderRadius: Radius.full, backgroundColor: C.surfaceContainerHigh,
  },
  fill: {
    position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: Radius.full,
    backgroundColor: C.primary, overflow: 'hidden',
  },
  fillGradientTop: {
    position: 'absolute', left: 0, right: 0, top: 0, height: '50%',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  tick: {
    position: 'absolute', top: '50%', width: 2, height: 2, borderRadius: 1,
    marginTop: -1, marginLeft: -1, backgroundColor: 'rgba(0,0,0,0.12)',
  },
  thumb: {
    position: 'absolute', width: THUMB, height: THUMB, borderRadius: Radius.full,
    top: TRACK_H / 2 - THUMB / 2,
    backgroundColor: '#fff', borderWidth: 3, marginLeft: -THUMB / 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  thumbActive: {
    shadowOpacity: 0.32, shadowRadius: 8, elevation: 6,
  },
  thumbDot: { width: 8, height: 8, borderRadius: 4 },

  bubble: { position: 'absolute', top: -6, alignItems: 'center', width: 44 },
  bubbleInner: {
    backgroundColor: C.text, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4,
    minWidth: 44, alignItems: 'center',
  },
  bubbleText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.surface },
  bubbleArrow: {
    width: 8, height: 8, backgroundColor: C.text, transform: [{ rotate: '45deg' }], marginTop: -4,
  },
})
