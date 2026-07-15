// Tempo — Muscle Map.
//
// A clean, geometric athletic figure (front + back) built from simple SVG shapes —
// modern and motivational, NOT a medical anatomy diagram. Each of the six coarse
// muscle groups Tempo actually tracks (chest/back/shoulders/arms/legs/core) is a
// tappable, status-coloured zone. Deliberately schematic so it reads well without
// hand-authored anatomical paths.

import Svg, { Circle, Rect, Ellipse, G } from 'react-native-svg'
import { View, StyleSheet } from 'react-native'
import { useTheme, type Palette } from '@/theme'
import type { MuscleStatus } from '@/lib/fitnessInsights'

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core'
export type BodyView = 'front' | 'back'

export function muscleStatusColor(C: Palette, status: MuscleStatus | undefined): string {
  switch (status) {
    case 'optimal': return C.readyHigh       // green
    case 'attention': return C.readyMed      // amber
    case 'fatigued': return C.readyLow       // ember/red
    case 'growing': return C.eventPersonal   // purple
    default: return C.surfaceContainerHigh
  }
}

interface ZoneShape { type: 'rect' | 'ellipse'; props: Record<string, number> }
type ZoneMap = Partial<Record<MuscleGroup, ZoneShape[]>>

// viewBox 0 0 200 380. Neutral silhouette (head/neck/hips) is drawn separately.
const FRONT: ZoneMap = {
  shoulders: [
    { type: 'ellipse', props: { cx: 63, cy: 80, rx: 19, ry: 13 } },
    { type: 'ellipse', props: { cx: 137, cy: 80, rx: 19, ry: 13 } },
  ],
  chest: [
    { type: 'rect', props: { x: 70, y: 84, width: 27, height: 30, rx: 9 } },
    { type: 'rect', props: { x: 103, y: 84, width: 27, height: 30, rx: 9 } },
  ],
  arms: [
    { type: 'rect', props: { x: 42, y: 88, width: 17, height: 76, rx: 8 } },
    { type: 'rect', props: { x: 141, y: 88, width: 17, height: 76, rx: 8 } },
  ],
  core: [{ type: 'rect', props: { x: 80, y: 118, width: 40, height: 62, rx: 12 } }],
  legs: [
    { type: 'rect', props: { x: 74, y: 202, width: 23, height: 120, rx: 11 } },
    { type: 'rect', props: { x: 103, y: 202, width: 23, height: 120, rx: 11 } },
  ],
}

const BACK: ZoneMap = {
  shoulders: [
    { type: 'ellipse', props: { cx: 63, cy: 80, rx: 19, ry: 13 } },
    { type: 'ellipse', props: { cx: 137, cy: 80, rx: 19, ry: 13 } },
  ],
  back: [
    { type: 'rect', props: { x: 76, y: 78, width: 48, height: 22, rx: 8 } },   // traps
    { type: 'rect', props: { x: 71, y: 100, width: 26, height: 46, rx: 9 } },  // lat L
    { type: 'rect', props: { x: 103, y: 100, width: 26, height: 46, rx: 9 } }, // lat R
    { type: 'rect', props: { x: 82, y: 148, width: 36, height: 30, rx: 8 } },  // lower back
  ],
  arms: [
    { type: 'rect', props: { x: 42, y: 88, width: 17, height: 76, rx: 8 } },
    { type: 'rect', props: { x: 141, y: 88, width: 17, height: 76, rx: 8 } },
  ],
  legs: [
    { type: 'rect', props: { x: 76, y: 182, width: 48, height: 24, rx: 10 } }, // glutes
    { type: 'rect', props: { x: 74, y: 208, width: 23, height: 114, rx: 11 } },
    { type: 'rect', props: { x: 103, y: 208, width: 23, height: 114, rx: 11 } },
  ],
}

export function MuscleMap({
  view,
  statusByGroup,
  selected,
  onSelect,
  dimmed = false,
  size = 240,
}: {
  view: BodyView
  statusByGroup: Partial<Record<MuscleGroup, MuscleStatus>>
  selected?: MuscleGroup | null
  onSelect?: (g: MuscleGroup) => void
  /** Free-preview teaser: colours shown faintly. */
  dimmed?: boolean
  size?: number
}) {
  const C = useTheme()
  const zones = view === 'front' ? FRONT : BACK
  const neutral = C.surfaceContainerHigh

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size * (380 / 200)} viewBox="0 0 200 380">
        {/* Neutral silhouette */}
        <G>
          <Circle cx={100} cy={34} r={19} fill={neutral} />
          <Rect x={91} y={50} width={18} height={12} rx={4} fill={neutral} />
          <Rect x={74} y={180} width={52} height={26} rx={9} fill={neutral} />
        </G>
        {/* Muscle zones */}
        {(Object.keys(zones) as MuscleGroup[]).map((group) => {
          const isSel = selected === group
          const base = muscleStatusColor(C, statusByGroup[group])
          const opacity = dimmed ? 0.5 : 1
          return (
            <G key={group} onPress={onSelect ? () => onSelect(group) : undefined}>
              {zones[group]!.map((s, i) =>
                s.type === 'ellipse' ? (
                  <Ellipse key={i} {...s.props} fill={base} fillOpacity={opacity}
                    stroke={isSel ? C.text : 'transparent'} strokeWidth={isSel ? 2 : 0} />
                ) : (
                  <Rect key={i} {...s.props} fill={base} fillOpacity={opacity}
                    stroke={isSel ? C.text : 'transparent'} strokeWidth={isSel ? 2 : 0} />
                ),
              )}
            </G>
          )
        })}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
})
