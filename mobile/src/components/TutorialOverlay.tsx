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
  type View as RNView, type ScrollView, type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { PressableScale, useReducedMotion } from '@/components/motion'
import * as haptics from '@/lib/haptics'
import { useTutorialStore, type TargetRect } from '@/stores/tutorial'
import { shouldShowTip, markTipSeen, TOUR_STEPS, spotlightLayout, type TutorialStep } from '@/lib/tutorial'

// Stable empty reference so the "no active tour" case never mints a new array.
const EMPTY_STEPS: TutorialStep[] = []

// Only scroll when the target is meaningfully off from the comfortable spot
// (avoids a jittery micro-scroll for something already roughly in place).
const SCROLL_THRESHOLD_PX = 40

// ── Target registry hook ──────────────────────────────────────────────────────
// Attach the returned ref to a host View; the overlay can then measure it into
// window coordinates on demand.
//
// `scrollIntoView: true` additionally scrolls the screen's registered scroll
// container (useTutorialScrollContainer) to bring an off-screen/awkwardly-placed
// target into a comfortable spot BEFORE measuring — fixes steps that used to just
// point at empty space when their target was below the fold. Opt-in and false by
// default: targets that live OUTSIDE any scrollable content (the tab bar's GO /
// Progress / Profile buttons — always visible, fixed position) must never trigger
// a scroll attempt, since scrolling the page can't move them and would just be a
// pointless animation.
export function useTutorialTarget(id: string | null, opts?: { scrollIntoView?: boolean }) {
  const ref = useRef<RNView>(null)
  const register = useTutorialStore(s => s.registerTarget)
  const unregister = useTutorialStore(s => s.unregisterTarget)
  const setRect = useTutorialStore(s => s.setTargetRect)
  const { height: winH } = useWindowDimensions()
  const scrollIntoView = !!opts?.scrollIntoView

  useEffect(() => {
    if (!id) return
    const measure = () => {
      requestAnimationFrame(() => {
        ref.current?.measureInWindow?.((x, y, width, height) => {
          if (width <= 0 || height <= 0) return
          const container = scrollIntoView ? useTutorialStore.getState().scrollContainer : null
          const desiredY = winH * 0.3
          const delta = y - desiredY
          if (container && Math.abs(delta) > SCROLL_THRESHOLD_PX) {
            container.scrollTo(Math.max(0, container.getScrollY() + delta))
            // Re-measure once the scroll animation has settled, so the stored
            // rect matches where the element actually ends up.
            setTimeout(() => {
              ref.current?.measureInWindow?.((x2, y2, w2, h2) => {
                if (w2 > 0 && h2 > 0) setRect(id, { x: x2, y: y2, width: w2, height: h2 })
              })
            }, 340)
            return
          }
          setRect(id, { x, y, width, height })
        })
      })
    }
    register(id, measure)
    return () => unregister(id)
  }, [id, register, unregister, setRect, winH, scrollIntoView])

  return ref
}

// ── Scroll container registration ─────────────────────────────────────────────
// A screen that hosts tour targets calls this once and spreads the result onto
// its main ScrollView: `<ScrollView ref={scrollRef} onScroll={onScroll} ...>`.
// Registers/clears a {scrollTo, getScrollY} pair the store exposes to
// useTutorialTarget above, so a below-the-fold step can bring itself into view.
export function useTutorialScrollContainer() {
  const scrollRef = useRef<ScrollView>(null)
  const scrollY = useRef(0)
  const setContainer = useTutorialStore(s => s.setScrollContainer)

  useEffect(() => {
    setContainer({
      scrollTo: (y: number) => scrollRef.current?.scrollTo({ y, animated: true }),
      getScrollY: () => scrollY.current,
    })
    return () => setContainer(null)
  }, [setContainer])

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y
  }, [])

  return { scrollRef, onScroll }
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
  const targets = useTutorialStore(s => s.targets)
  const nextStep = useTutorialStore(s => s.nextStep)
  const endTour = useTutorialStore(s => s.endTour)
  const router = useRouter()

  // Derive steps from a STABLE module constant (`TOUR_STEPS`, keyed by tour id) —
  // selecting `activeSteps()` from the store returned a fresh array every render,
  // which makes zustand's snapshot compare unequal every time → "getSnapshot
  // should be cached" infinite loop. Adding a new tour is just a new TOUR_STEPS
  // entry (lib/tutorial.ts) — this lookup never needs to change again.
  const steps = activeTour ? TOUR_STEPS[activeTour] ?? EMPTY_STEPS : EMPTY_STEPS
  const step = activeTour ? steps[stepIndex] : null
  const rect: TargetRect | undefined = step?.target ? targets[step.target] : undefined

  // Cross-screen tours (T.conceptsTour): navigate to a step's screen the first
  // time we land on it. Tracked with refs rather than usePathname so this never
  // depends on how expo-router formats a given route's pathname (group segments
  // stripped or not) — we only need to know "did THIS overlay already push here
  // for THIS tour", which a plain ref answers exactly. Reset whenever the active
  // tour changes so a fresh run always re-navigates its first step.
  const lastScreenRef = useRef<string | null>(null)
  const lastTourRef = useRef<typeof activeTour>(null)
  useEffect(() => {
    if (activeTour !== lastTourRef.current) {
      lastTourRef.current = activeTour
      lastScreenRef.current = null
    }
    if (step?.screen && step.screen !== lastScreenRef.current) {
      lastScreenRef.current = step.screen
      router.push(step.screen as never)
    }
  }, [activeTour, step?.screen, router])

  // Re-measure the active target when the step changes. A same-screen target is
  // usually ready within a frame (the 260ms retry below covers it); a
  // cross-screen target may need longer — the destination tab has to actually
  // become visible (or, for a real navigation, mount) first — so this polls a
  // few times over ~1.5s rather than giving up after one retry. Reads the
  // measurer fresh from the store each attempt (not a subscribed selector) so a
  // target that registers mid-poll (a screen mounting late) is still caught.
  useEffect(() => {
    if (!step?.target) return
    const targetId = step.target
    let cancelled = false
    const attempt = () => {
      if (cancelled) return
      useTutorialStore.getState().measurers[targetId]?.()
    }
    attempt()
    const timers = [200, 450, 800, 1300].map(ms => setTimeout(attempt, ms))
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [step?.target, stepIndex])

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

  // Layout is a pure function (lib/tutorial.spotlightLayout) so the awkward
  // cases have unit tests rather than only showing up on a device. It also
  // clamps the card against the BOTTOM of the screen, which is the fix for the
  // first-run bug where a tall high target pushed the card (and the Next
  // button) off the bottom edge and the tour looked frozen on step 1.
  const layout = spotlightLayout({
    rect, screenH: sh, insetTop: insets.top, insetBottom: insets.bottom, placement: step.placement,
  })
  const hole = layout.hole
  const tooltipTop = layout.top
  const tooltipBottom = layout.bottom
  const tooltipMaxHeight = layout.maxHeight

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
          {/* The hole itself also advances. No step needs the user to interact
              with the highlighted element, and leaving it inert made most of
              the screen a dead zone: taps did nothing, which is what made the
              tour read as frozen. */}
          <Dim onPress={nextStep} style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, backgroundColor: 'transparent' }} />
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
        style={[
          styles.tipWrap,
          { top: tooltipTop, bottom: tooltipBottom, maxHeight: tooltipMaxHeight, paddingHorizontal: Spacing.containerPadding },
        ]}
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
