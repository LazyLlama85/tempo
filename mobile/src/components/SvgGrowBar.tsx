// Tempo — SvgGrowBar.
//
// The Progress volume chart's bar, upgraded from a flat-color Animated.View to a
// gradient-filled SVG rect — still grows from the baseline on mount/period
// change, just reads a shade more premium (the WHOOP/Apple-Fitness reference
// point uses gradient fills, not flat ones, for this exact chart type). A
// normalized 0–100 viewBox + preserveAspectRatio="none" lets the bar fill
// whatever width its flex column gives it, same trick as SvgLineChart.

import { useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg'
import { useReducedMotion } from '@/components/motion'

const AnimatedRect = Animated.createAnimatedComponent(Rect)

interface Props {
  height: number
  color: string
  gradientTo?: string
  delay?: number
  radius?: number
}

let barIdCounter = 0

// rx is in the normalized 0–100 horizontal unit space (scales with whatever
// actual width the flex column gives the bar); ry is in real vertical pixels
// (the vertical axis maps 1:1, viewBox height === the height prop) — different
// units are intentional so the rounded corners stay roughly circular instead of
// an odd ellipse once the two axes scale independently.
export function SvgGrowBar({ height, color, gradientTo, delay = 0, radius = 15 }: Props) {
  const reduce = useReducedMotion()
  const h = useRef(new Animated.Value(reduce ? height : 2)).current
  const gradId = useRef(`tempoBarGrad${barIdCounter++}`).current

  useEffect(() => {
    if (reduce) { h.setValue(height); return }
    const anim = Animated.timing(h, {
      toValue: height, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    })
    anim.start()
    return () => anim.stop()
  }, [height, reduce, h, delay])

  const y = Animated.subtract(height, h)

  return (
    <Svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={gradientTo ?? color} stopOpacity={0.65} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <AnimatedRect x={0} y={y} width={100} height={h} rx={radius} ry={6} fill={`url(#${gradId})`} />
    </Svg>
  )
}
