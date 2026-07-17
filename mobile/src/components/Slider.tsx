// Tempo — a dependency-free horizontal slider (drag-to-set-a-number).
//
// Built on RN's own PanResponder rather than a native slider library — no new
// native module, no rebuild, ships via `eas update` like every other primitive in
// this file's family (AnimatedRing, SvgProgressRing). Used for onboarding's
// personal-data questions (starting weight) where a drag feels more like a real
// fitness app's first-run than a bare numeric keyboard.

import { useMemo, useRef, useState } from 'react'
import { View, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native'
import { Radius, type Palette } from '@/constants/theme'
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
}

export function Slider({ value, min, max, step = 1, onChange, onSlidingComplete, accessibilityLabel }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [trackWidth, setTrackWidth] = useState(0)
  const lastStepped = useRef(value)

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

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => respond(e.nativeEvent.locationX),
    onPanResponderMove: (e) => respond(e.nativeEvent.locationX),
    onPanResponderRelease: () => onSlidingComplete?.(lastStepped.current),
    onPanResponderTerminate: () => onSlidingComplete?.(lastStepped.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [trackWidth, min, max, step])

  return (
    <View
      style={styles.track}
      onLayout={onLayout}
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: C.primary }]} />
      <View style={[styles.thumb, { left: `${pct * 100}%`, borderColor: C.primary }]} />
    </View>
  )
}

const THUMB = 26

const makeStyles = (C: Palette) => StyleSheet.create({
  track: {
    height: 8, borderRadius: Radius.full, backgroundColor: C.surfaceContainerHigh,
    justifyContent: 'center', marginVertical: THUMB / 2,
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: Radius.full },
  thumb: {
    position: 'absolute', width: THUMB, height: THUMB, borderRadius: Radius.full,
    backgroundColor: '#fff', borderWidth: 3, marginLeft: -THUMB / 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
})
