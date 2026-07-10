// Tempo — spotlight coach-mark overlay + target registry hooks.
//
// The Home tour dims the screen, cuts a spotlight around one element, and floats a
// tooltip near it — without freezing the UI (the highlighted element stays visible)
// and one concept at a time. Screens tag highlightable elements with
// useTutorialTarget(id); the overlay reads the active step's target rect and draws
// four dim strips framing it (a dependency-free "hole") plus a pulsing ring. A
// missing/unmeasured target falls back to a centered card, so the tour never breaks.

import { useCallback, useEffect, useRef } from 'react'
import {
  Animated, Easing, Modal, StyleSheet, Text, View, useWindowDimensions,
  type View as RNView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { PressableScale, useReducedMotion } from '@/components/motion'
import * as haptics from '@/lib/haptics'
import { useTutorialStore, type TargetRect } from '@/stores/tutorial'
import { shouldShowTip, markTipSeen } from '@/lib/tutorial'

// ── Target registry hook ──────────────────────────────────────────────────────
// Attach the returned ref to a host View; the overlay can then measure it into
// window coordinates on demand.
export function useTutorialTarget(id: string) {
  const ref = useRef<RNView>(null)
  const register = useTutorialStore(s => s.registerTarget)
  const unregister = useTutorialStore(s => s.unregisterTarget)
  const setRect = useTutorialStore(s => s.setTargetRect)

  useEffect(() => {
    const measure = () => {
      requestAnimationFrame(() => {
        ref.current?.measureInWindow?.((x, y, width, height) => {
          if (width > 0 && height > 0) setRect(id, { x, y, width, height })
        })
      })
    }
    register(id, measure)
    return () => unregister(id)
  }, [id, register, unregister, setRect])

  return ref
}

// ── One-off contextual tip hook ───────────────────────────────────────────────
// Returns [show, dismiss] — `show` is true only the first time per device.
export function useOnceTip(id: string): [boolean, () => void] {
  const shownRef = useRef(shouldShowTip(id))
  const forceRef = useRef(0)
  const dismiss = useCallback(() => { markTipSeen(id); shownRef.current = false; forceRef.current++ }, [id])
  return [shownRef.current, dismiss]
}

// ── Overlay ────────────────────────────────────────────────────────────────────

const DIM = 'rgba(15,16,20,0.72)'

export function TutorialOverlay() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const { width: sw, height: sh } = useWindowDimensions()
  const reduce = useReducedMotion()

  const activeTour = useTutorialStore(s => s.activeTour)
  const stepIndex = useTutorialStore(s => s.stepIndex)
  const steps = useTutorialStore(s => s.activeSteps())
  const targets = useTutorialStore(s => s.targets)
  const measurers = useTutorialStore(s => s.measurers)
  const nextStep = useTutorialStore(s => s.nextStep)
  const endTour = useTutorialStore(s => s.endTour)

  const step = activeTour ? steps[stepIndex] : null
  const rect: TargetRect | undefined = step?.target ? targets[step.target] : undefined

  // Re-measure the active target when the step changes (layout may lag a frame).
  useEffect(() => {
    if (!step?.target) return
    const m = measurers[step.target]
    if (!m) return
    m()
    const t = setTimeout(m, 260)
    return () => clearTimeout(t)
  }, [step?.target, measurers, stepIndex])

  // Gentle pulse on the highlight ring (skipped under reduced motion).
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduce || !rect) { pulse.setValue(0); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [reduce, rect, pulse, stepIndex])

  useEffect(() => { if (step) haptics.tapLight() }, [stepIndex, step?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeTour || !step) return null

  const pad = 8
  const hole = rect
    ? { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null

  // Tooltip sits below the target (or above, per placement / screen room).
  const below = hole ? (step.placement === 'top' ? false : hole.y + hole.h < sh * 0.6) : true
  const tooltipTop = hole ? (below ? hole.y + hole.h + 12 : undefined) : sh / 2 - 90
  const tooltipBottom = hole && !below ? sh - hole.y + 12 : undefined

  const isLast = stepIndex + 1 >= steps.length

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => endTour({ skipped: true })} statusBarTranslucent>
      {/* Four dim strips frame the spotlight; each advances on tap. */}
      {hole ? (
        <>
          <Dim onPress={nextStep} style={{ left: 0, top: 0, width: sw, height: hole.y }} />
          <Dim onPress={nextStep} style={{ left: 0, top: hole.y, width: hole.x, height: hole.h }} />
          <Dim onPress={nextStep} style={{ left: hole.x + hole.w, top: hole.y, width: sw - (hole.x + hole.w), height: hole.h }} />
          <Dim onPress={nextStep} style={{ left: 0, top: hole.y + hole.h, width: sw, height: sh - (hole.y + hole.h) }} />
          {/* Highlight ring around the spotlight */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', left: hole.x, top: hole.y, width: hole.w, height: hole.h,
              borderRadius: Radius.lg, borderWidth: 2.5, borderColor: C.primary,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
            }}
          />
        </>
      ) : (
        <Dim onPress={nextStep} style={{ left: 0, top: 0, width: sw, height: sh }} />
      )}

      {/* Tooltip card */}
      <View
        pointerEvents="box-none"
        style={[styles.tipWrap, { top: tooltipTop, bottom: tooltipBottom, paddingHorizontal: Spacing.containerPadding }]}
      >
        <View style={styles.tipCard}>
          <View style={styles.tipStepRow}>
            <Text style={styles.tipStep}>{stepIndex + 1} of {steps.length}</Text>
            <PressableScale onPress={() => endTour({ skipped: true })} hitSlop={8}>
              <Text style={styles.tipSkip}>Skip</Text>
            </PressableScale>
          </View>
          <Text style={styles.tipTitle}>{step.title}</Text>
          <Text style={styles.tipBody}>{step.body}</Text>
          <PressableScale style={styles.tipNext} onPress={nextStep}>
            <Text style={styles.tipNextText}>{isLast ? 'Done' : 'Next'}</Text>
          </PressableScale>
        </View>
      </View>
      {/* Safe-area guard so the card clears notches when pinned to bottom */}
      <View pointerEvents="none" style={{ height: insets.bottom }} />
    </Modal>
  )
}

function Dim({ onPress, style }: { onPress: () => void; style: any }) {
  return <PressableScale scaleTo={1} onPress={onPress} style={[{ position: 'absolute', backgroundColor: DIM }, style]}><View /></PressableScale>
}

const makeStyles = (C: Palette) => StyleSheet.create({
  tipWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  tipCard: {
    alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.xs,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 30, elevation: 10,
  },
  tipStepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tipStep: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  tipSkip: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  tipTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  tipBody: { fontFamily: 'Inter_400Regular', fontSize: 14.5, color: C.textSecondary, lineHeight: 21 },
  tipNext: { height: 46, borderRadius: Radius.lg, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xs },
  tipNextText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
