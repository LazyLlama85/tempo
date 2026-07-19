// Tempo — thin wrapper around lottie-react-native for the app's Duolingo-style
// character/celebration animations (the sign-in "live logo" moment, the rest
// timer's coach, etc.) — distinct from the existing hand-built Animated+SVG
// primitives (SvgProgressRing, TempoPulse, celebration.tsx's ConfettiBurst),
// which stay exactly as they are; this is for the character-driven stuff that
// genuinely needs a rigged asset rather than procedural shapes.
//
// Built for the free tier of Lottie sourcing (LottieFiles' free plan, or any
// other free/CC0 .json export) — recoloring to Tempo's palette doesn't need a
// paid tool: `colorFilters` (lottie-react-native's own, free, open-source
// prop) recolors by layer keypath, findable in LottieFiles' free online
// preview (Layers panel) or any text editor (search the JSON for a shape's
// "nm" field). See assets/lottie/README.md for the current asset list and
// exactly which keypaths each one uses.
//
// Never lets a bad/missing animation file take anything else down with it:
// onAnimationFailure hides the view and reports it (best-effort) rather than
// leaving a broken native view or crashing whatever screen embedded it.

import { useEffect, useRef, useState } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import LottieView, { type AnimationObject } from 'lottie-react-native'
import { useReducedMotion } from '@/components/motion'
import { captureException } from '@/lib/crashReporting'

export interface TempoLottieProps {
  /** A `require('../assets/lottie/whatever.json')` result, or a remote {uri}. */
  source: string | AnimationObject | { uri: string }
  /** Square box side length. Ignored if `width`/`height` are given. */
  size?: number
  /** Non-square box — use for a source whose own aspect ratio isn't 1:1 (most of the Tempo Coach poses aren't). */
  width?: number
  height?: number
  style?: StyleProp<ViewStyle>
  loop?: boolean
  /** Recolor specific layers — see this file's header comment for how to find keypaths. */
  colorFilters?: { keypath: string; color: string }[]
  /**
   * 0-1 — drive the animation from real app state (e.g. rest-timer progress)
   * instead of free-running playback. Omit for a normal autoplay/loop.
   */
  progress?: number
}

// Under Reduced Motion, freeze on a single static frame rather than removing
// the element outright — same principle as the rest of the app's motion code
// (content must never just vanish because an accessibility setting is on).
const REDUCED_MOTION_FRAME = 0

export function TempoLottie({ source, size = 64, width, height, style, loop = true, colorFilters, progress }: TempoLottieProps) {
  const reduce = useReducedMotion()
  const [failed, setFailed] = useState(false)
  const ref = useRef<LottieView>(null)

  useEffect(() => {
    if (reduce || progress != null) return
    ref.current?.play()
  }, [reduce, progress])

  if (failed) return null

  return (
    <View style={[{ width: width ?? size, height: height ?? size }, style]}>
      <LottieView
        ref={ref}
        source={source}
        autoPlay={!reduce && progress == null}
        loop={loop && !reduce}
        progress={reduce ? REDUCED_MOTION_FRAME : progress}
        colorFilters={colorFilters}
        style={{ width: '100%', height: '100%' }}
        onAnimationFailure={(error) => {
          setFailed(true)
          captureException(new Error(`TempoLottie failed to load: ${error}`))
        }}
      />
    </View>
  )
}
