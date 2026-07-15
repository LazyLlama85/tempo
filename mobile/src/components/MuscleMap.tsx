// Tempo — Muscle Map.
//
// A stylized muscular figure (front + back) built from organic SVG shapes — rounded
// muscle "bellies" and tapered limbs over a neutral silhouette, so it reads as a body,
// not a block diagram. Motivational, not a medical chart. Each of the six coarse
// muscle groups Tempo tracks (chest/back/shoulders/arms/legs/core) is a tappable,
// status- or heat-coloured zone. (For a photoreal body, drop in a real anatomical SVG
// asset and keep the same group ids + fills.)

import { ReactNode } from 'react'
import Svg, { Ellipse, Path, G } from 'react-native-svg'
import { View, Text, StyleSheet } from 'react-native'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, type Palette } from '@/theme'
import type { MuscleStatus, MuscleTier } from '@/lib/fitnessInsights'

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core'
export type BodyView = 'front' | 'back'
export type MapMode = 'status' | 'heatmap' | 'rank'

const VB_W = 220
const VB_H = 480

export function muscleStatusColor(C: Palette, status: MuscleStatus | undefined): string {
  switch (status) {
    case 'optimal': return C.readyHigh       // green
    case 'attention': return C.readyMed      // amber
    case 'fatigued': return C.readyLow       // ember/red
    case 'growing': return C.eventPersonal   // purple
    default: return C.surfaceContainerHigh
  }
}

// Rank-tier colours (Beginner→World Class), matching the reference legend.
export function muscleTierColor(C: Palette, tier: MuscleTier | undefined): string {
  switch (tier) {
    case 'novice': return C.primary          // blue
    case 'intermediate': return C.readyHigh  // green
    case 'advanced': return C.eventPersonal  // purple
    case 'elite': return C.ember             // orange
    case 'world_class': return C.error       // red
    default: return C.surfaceContainerHigh   // beginner / untrained — grey
  }
}

type Shape =
  | { t: 'e'; cx: number; cy: number; rx: number; ry: number }
  | { t: 'p'; d: string }
type Zones = Partial<Record<MuscleGroup, Shape[]>>

// Neutral, non-muscle silhouette parts (head / neck / hips / hands / feet).
const SILHOUETTE_FRONT: Shape[] = [
  { t: 'e', cx: 110, cy: 44, rx: 22, ry: 27 },   // head
  { t: 'p', d: 'M99 66 h22 v18 q-11 6 -22 0 Z' }, // neck
  { t: 'e', cx: 110, cy: 250, rx: 33, ry: 22 },  // hips
  { t: 'e', cx: 52, cy: 246, rx: 9, ry: 11 },    // L hand
  { t: 'e', cx: 168, cy: 246, rx: 9, ry: 11 },   // R hand
  { t: 'e', cx: 91, cy: 455, rx: 13, ry: 12 },   // L foot
  { t: 'e', cx: 129, cy: 455, rx: 13, ry: 12 },  // R foot
]
const SILHOUETTE_BACK = SILHOUETTE_FRONT

const FRONT: Zones = {
  shoulders: [
    { t: 'e', cx: 66, cy: 104, rx: 21, ry: 18 },
    { t: 'e', cx: 154, cy: 104, rx: 21, ry: 18 },
  ],
  chest: [
    { t: 'e', cx: 90, cy: 122, rx: 22, ry: 17 },
    { t: 'e', cx: 130, cy: 122, rx: 22, ry: 17 },
  ],
  arms: [
    { t: 'e', cx: 55, cy: 156, rx: 14, ry: 30 },   // L bicep
    { t: 'e', cx: 51, cy: 212, rx: 12, ry: 32 },   // L forearm
    { t: 'e', cx: 165, cy: 156, rx: 14, ry: 30 },  // R bicep
    { t: 'e', cx: 169, cy: 212, rx: 12, ry: 32 },  // R forearm
  ],
  core: [{ t: 'e', cx: 110, cy: 182, rx: 24, ry: 44 }],
  legs: [
    { t: 'e', cx: 91, cy: 312, rx: 20, ry: 58 },   // L quad
    { t: 'e', cx: 91, cy: 412, rx: 15, ry: 40 },   // L calf
    { t: 'e', cx: 129, cy: 312, rx: 20, ry: 58 },  // R quad
    { t: 'e', cx: 129, cy: 412, rx: 15, ry: 40 },  // R calf
  ],
}

const BACK: Zones = {
  shoulders: [
    { t: 'e', cx: 66, cy: 104, rx: 21, ry: 18 },
    { t: 'e', cx: 154, cy: 104, rx: 21, ry: 18 },
  ],
  back: [
    { t: 'e', cx: 110, cy: 104, rx: 30, ry: 15 },  // traps
    { t: 'e', cx: 90, cy: 145, rx: 21, ry: 34 },   // L lat
    { t: 'e', cx: 130, cy: 145, rx: 21, ry: 34 },  // R lat
    { t: 'e', cx: 110, cy: 190, rx: 22, ry: 28 },  // lower back
  ],
  arms: [
    { t: 'e', cx: 55, cy: 156, rx: 14, ry: 30 },
    { t: 'e', cx: 51, cy: 212, rx: 12, ry: 32 },
    { t: 'e', cx: 165, cy: 156, rx: 14, ry: 30 },
    { t: 'e', cx: 169, cy: 212, rx: 12, ry: 32 },
  ],
  legs: [
    { t: 'e', cx: 110, cy: 252, rx: 33, ry: 22 },  // glutes
    { t: 'e', cx: 91, cy: 318, rx: 20, ry: 56 },   // L ham
    { t: 'e', cx: 91, cy: 414, rx: 15, ry: 40 },   // L calf
    { t: 'e', cx: 129, cy: 318, rx: 20, ry: 56 },  // R ham
    { t: 'e', cx: 129, cy: 414, rx: 15, ry: 40 },  // R calf
  ],
}

// Bubble anchor (normalized 0–1 within the viewBox) per group.
const ANCHOR: Record<MuscleGroup, { x: number; y: number }> = {
  chest: { x: 0.5, y: 0.25 },
  back: { x: 0.5, y: 0.23 },
  shoulders: { x: 0.3, y: 0.21 },
  arms: { x: 0.25, y: 0.33 },
  core: { x: 0.5, y: 0.38 },
  legs: { x: 0.5, y: 0.66 },
}

export interface MapBubble { group: MuscleGroup; text: string; tone: string }

export function MuscleMap({
  view, statusByGroup, heatByGroup, rankByGroup, mode = 'status', selected, onSelect, dimmed = false, bubbles, size = 220,
}: {
  view: BodyView
  statusByGroup: Partial<Record<MuscleGroup, MuscleStatus>>
  /** 0–1 training stimulus per group, for heatmap mode. */
  heatByGroup?: Partial<Record<MuscleGroup, number>>
  /** Rank tier per group, for rank mode. */
  rankByGroup?: Partial<Record<MuscleGroup, MuscleTier>>
  mode?: MapMode
  selected?: MuscleGroup | null
  onSelect?: (g: MuscleGroup) => void
  dimmed?: boolean
  bubbles?: MapBubble[]
  size?: number
}) {
  const C = useTheme()
  const zones = view === 'front' ? FRONT : BACK
  const silhouette = view === 'front' ? SILHOUETTE_FRONT : SILHOUETTE_BACK
  const neutral = C.surfaceContainerHigh
  const w = size
  const h = size * (VB_H / VB_W)

  const renderShape = (sh: Shape, key: number, fill: string, opacity: number, sel: boolean): ReactNode =>
    sh.t === 'e' ? (
      <Ellipse key={key} cx={sh.cx} cy={sh.cy} rx={sh.rx} ry={sh.ry} fill={fill} fillOpacity={opacity}
        stroke={sel ? C.text : 'transparent'} strokeWidth={sel ? 2.5 : 0} />
    ) : (
      <Path key={key} d={sh.d} fill={fill} fillOpacity={opacity}
        stroke={sel ? C.text : 'transparent'} strokeWidth={sel ? 2.5 : 0} />
    )

  const fillFor = (group: MuscleGroup): { fill: string; opacity: number } => {
    if (mode === 'heatmap') {
      const heat = Math.max(0, Math.min(1, heatByGroup?.[group] ?? 0))
      return { fill: C.primary, opacity: dimmed ? (0.1 + heat * 0.35) : (0.14 + heat * 0.86) }
    }
    if (mode === 'rank') {
      return { fill: muscleTierColor(C, rankByGroup?.[group]), opacity: dimmed ? 0.45 : 1 }
    }
    return { fill: muscleStatusColor(C, statusByGroup[group]), opacity: dimmed ? 0.45 : 1 }
  }

  return (
    <View style={[styles.wrap, { width: w, height: h }]}>
      <Svg width={w} height={h} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <G>{silhouette.map((sh, i) => renderShape(sh, i, neutral, 1, false))}</G>
        {(Object.keys(zones) as MuscleGroup[]).map((group) => {
          const isSel = selected === group
          const { fill, opacity } = fillFor(group)
          return (
            <G key={group} onPress={onSelect ? () => onSelect(group) : undefined}>
              {zones[group]!.map((sh, i) => renderShape(sh, i, fill, opacity, isSel))}
            </G>
          )
        })}
      </Svg>

      {bubbles?.map((b) => {
        const a = ANCHOR[b.group]
        return (
          <View key={b.group} pointerEvents="none" style={[styles.bubble, { backgroundColor: b.tone, left: a.x * w - 20, top: a.y * h - 12 }]}>
            <Text style={styles.bubbleText}>{b.text}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  bubble: { position: 'absolute', minWidth: 40, alignItems: 'center', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  bubbleText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: '#fff' },
})
