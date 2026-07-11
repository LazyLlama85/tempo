// Tempo — SvgLineChart.
//
// A small, dependency-light line+area chart (react-native-svg) for trend data —
// first use: the Progress tab's weight trend, which previously had real math
// (bodyMeasurements.computeWeightTrend/rollingAverage) behind it but no chart at
// all, just text numbers. Sizes itself to its container via a fixed viewBox +
// preserveAspectRatio="none", so no onLayout measuring is needed.

import { View, Text, StyleSheet } from 'react-native'
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg'
import { Spacing, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'

export interface ChartPoint {
  label: string
  value: number
}

interface Props {
  points: ChartPoint[]
  height?: number
  color?: string
  emptyText?: string
}

const VB_W = 320
const PAD_Y = 12

export function SvgLineChart({ points, height = 110, color, emptyText }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const stroke = color ?? C.primary

  if (points.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>{emptyText ?? 'Log a few more entries to see your trend.'}</Text>
      </View>
    )
  }

  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const usableH = height - PAD_Y * 2
  const stepX = points.length > 1 ? VB_W / (points.length - 1) : 0

  // A flat trend (every value identical — e.g. a stable weigh-in streak) has no
  // range to normalize against. Falling back to `range = 1` would map every point
  // to the same y as the *minimum*, drawing the line pinned to the chart's floor
  // instead of a flat line through the middle — reading as broken/crashed data
  // rather than "nothing's changed."
  const coords = points.map((p, i) => ({
    x: i * stepX,
    y: range === 0 ? PAD_Y + usableH / 2 : PAD_Y + usableH - ((p.value - min) / range) * usableH,
  }))

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
  const last = coords[coords.length - 1]
  const first = coords[0]
  const areaPath = `${linePath} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`

  return (
    <View style={{ height }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${VB_W} ${height}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="tempoAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={areaPath} fill="url(#tempoAreaGrad)" />
        {/* preserveAspectRatio="none" stretches x/y independently to fill the
            container, so a stroke width defined in viewBox units would render
            thicker or thinner depending on each segment's angle. non-scaling-stroke
            keeps it a constant on-screen width regardless of that stretch. */}
        <Path
          d={linePath}
          stroke={stroke}
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <Circle cx={last.x} cy={last.y} r={4.5} fill={stroke} />
      </Svg>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },
})
