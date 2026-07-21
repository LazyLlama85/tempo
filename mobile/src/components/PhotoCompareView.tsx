// Tempo — before/after progress-photo compare (PRODUCT_AUDIT.html §26, L25).
//
// A drag-to-reveal slider between two photos, built on RN's own PanResponder —
// no new native module, ships via `eas update` like Slider.tsx (the same
// gesture-capture technique this copies, so a drag started on the handle can't
// be stolen by an ancestor ScrollView mid-gesture). This is the artifact: the
// most shareable thing a fitness app can produce, and until now users could
// attach progress photos but never get anything back out.

import { useMemo, useRef, useState } from 'react'
import { Animated, View, Text, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Radius, Spacing, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import * as haptics from '@/lib/haptics'

export interface ComparePhoto {
  url: string
  label: string // e.g. "Mar 3, 2026"
  sub?: string // e.g. "182 lb"
}

interface Props {
  before: ComparePhoto
  after: ComparePhoto
}

const HANDLE = 36

export function PhotoCompareView({ before, after }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [width, setWidth] = useState(0)
  const reveal = useRef(new Animated.Value(0)).current
  const revealX = useRef(0)
  const [dragging, setDragging] = useState(false)

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setWidth(w)
    revealX.current = w / 2
    reveal.setValue(w / 2)
  }

  const respond = (x: number) => {
    if (width <= 0) return
    const clamped = Math.max(0, Math.min(width, x))
    revealX.current = clamped
    reveal.setValue(clamped)
  }

  const pan = useMemo(() => PanResponder.create({
    // Same capture-phase claim as Slider.tsx — otherwise a ScrollView ancestor
    // (the compare screen scrolls on smaller devices) can win a drag mid-gesture.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => { setDragging(true); haptics.tapLight(); respond(e.nativeEvent.locationX) },
    onPanResponderMove: (e) => respond(e.nativeEvent.locationX),
    onPanResponderRelease: () => setDragging(false),
    onPanResponderTerminate: () => setDragging(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [width])

  return (
    <View style={styles.frame} onLayout={onLayout}>
      {width > 0 && (
        <>
          {/* Base layer — AFTER, full width */}
          <Image source={{ uri: after.url }} style={{ width, height: width * (4 / 3) }} contentFit="cover" />

          {/* Clipped overlay — BEFORE, revealed left of the handle */}
          <Animated.View style={[styles.beforeClip, { width: reveal, height: width * (4 / 3) }]}>
            <Image source={{ uri: before.url }} style={{ width, height: width * (4 / 3) }} contentFit="cover" />
          </Animated.View>

          {/* Captions — always full-strength regardless of handle position */}
          <View style={styles.captionLeft} pointerEvents="none">
            <Text style={styles.captionTag}>BEFORE</Text>
            <Text style={styles.captionLabel}>{before.label}</Text>
            {before.sub && <Text style={styles.captionSub}>{before.sub}</Text>}
          </View>
          <View style={styles.captionRight} pointerEvents="none">
            <Text style={styles.captionTag}>AFTER</Text>
            <Text style={styles.captionLabel}>{after.label}</Text>
            {after.sub && <Text style={styles.captionSub}>{after.sub}</Text>}
          </View>

          {/* Drag handle */}
          <View style={styles.dragZone} {...pan.panHandlers}>
            <Animated.View
              pointerEvents="none"
              style={[styles.handleLine, { transform: [{ translateX: reveal }] }]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.handle,
                dragging && styles.handleActive,
                { transform: [{ translateX: Animated.subtract(reveal, HANDLE / 2) }] },
              ]}
            >
              <Ionicons name="chevron-back" size={12} color={C.text} style={{ marginRight: -2 }} />
              <Ionicons name="chevron-forward" size={12} color={C.text} style={{ marginLeft: -2 }} />
            </Animated.View>
          </View>
        </>
      )}
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  frame: {
    width: '100%', aspectRatio: 3 / 4, borderRadius: Radius.lg, overflow: 'hidden',
    backgroundColor: C.surfaceContainerLow,
  },
  beforeClip: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  dragZone: { ...StyleSheet.absoluteFill },
  handleLine: {
    position: 'absolute', top: 0, bottom: 0, width: 2.5, marginLeft: -1.25,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  handle: {
    position: 'absolute', top: '50%', marginTop: -HANDLE / 2, width: HANDLE, height: HANDLE,
    borderRadius: HANDLE / 2, backgroundColor: 'rgba(255,255,255,0.95)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 5, elevation: 4,
  },
  handleActive: { transform: [{ scale: 1.08 }] },
  captionLeft: {
    position: 'absolute', left: Spacing.sm, bottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6,
  },
  captionRight: {
    position: 'absolute', right: Spacing.sm, bottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6,
    alignItems: 'flex-end',
  },
  captionTag: { fontFamily: 'Inter_800ExtraBold', fontSize: 9.5, color: '#fff', letterSpacing: 0.6 },
  captionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: '#fff', marginTop: 1 },
  captionSub: { fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.85)' },
})
