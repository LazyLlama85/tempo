// Tempo — Muscle Map.
//
// Anatomically-real muscular figure (front + back) rendered from
// `react-native-body-highlighter` (MIT) SVG path data. Each of the six coarse
// muscle groups Tempo tracks (chest/back/shoulders/arms/legs/core) is mapped to
// the library's fine muscle slugs and coloured by status / heatmap / rank, so the
// same public API drives a realistic body instead of stylised blobs.
//
// Public API is unchanged from the previous geometric version: `MuscleMap`,
// `muscleStatusColor`, `muscleTierColor`, the `MapBubble` interface and the
// `MuscleGroup` / `BodyView` / `MapMode` types — every existing call site keeps
// working, bubbles included (their anchors are re-derived from the anatomy below).

import Body, { type Slug, type ExtendedBodyPart } from 'react-native-body-highlighter'
import { bodyFront } from 'react-native-body-highlighter/dist/assets/bodyFront'
import { bodyBack } from 'react-native-body-highlighter/dist/assets/bodyBack'
import { View, Text, StyleSheet } from 'react-native'
import { Radius } from '@/constants/theme'
import { useTheme, type Palette } from '@/theme'
import type { MuscleStatus, MuscleTier } from '@/lib/fitnessInsights'

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core'
export type BodyView = 'front' | 'back'
export type MapMode = 'status' | 'heatmap' | 'rank'

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

// Tempo's coarse group → the library's fine muscle slugs, per view. Muscles that
// don't exist on a given view (e.g. chest on the back) simply have no slugs there.
const GROUP_TO_SLUGS_FRONT: Record<MuscleGroup, Slug[]> = {
  chest: ['chest'],
  back: ['trapezius'],
  shoulders: ['deltoids'],
  arms: ['biceps', 'triceps', 'forearm'],
  legs: ['quadriceps', 'calves', 'adductors', 'tibialis'],
  core: ['abs', 'obliques'],
}
const GROUP_TO_SLUGS_BACK: Record<MuscleGroup, Slug[]> = {
  chest: [],
  back: ['trapezius', 'upper-back', 'lower-back'],
  shoulders: ['deltoids'],
  arms: ['triceps', 'forearm'],
  legs: ['gluteal', 'hamstring', 'calves', 'adductors'],
  core: [],
}

function invertGroups(m: Record<MuscleGroup, Slug[]>): Partial<Record<Slug, MuscleGroup>> {
  const out: Partial<Record<Slug, MuscleGroup>> = {}
  ;(Object.keys(m) as MuscleGroup[]).forEach((g) => m[g].forEach((s) => { out[s] = g }))
  return out
}
const SLUG_TO_GROUP_FRONT = invertGroups(GROUP_TO_SLUGS_FRONT)
const SLUG_TO_GROUP_BACK = invertGroups(GROUP_TO_SLUGS_BACK)

// --- Bubble anchors: centroid per group derived from the anatomy path data, so
// recovery-% / rank callouts land on the right muscle. Front viewBox is
// "0 0 724 1448", back is "724 0 724 1448" (SvgMaleWrapper).
const VB_W = 724
const VB_H = 1448
type Anchor = { x: number; y: number }
type PathPart = { slug?: Slug; path?: { common?: string[]; left?: string[]; right?: string[] } }

function computeAnchors(
  body: ReadonlyArray<PathPart>,
  groupMap: Record<MuscleGroup, Slug[]>,
  xOffset: number,
): Partial<Record<MuscleGroup, Anchor>> {
  const out: Partial<Record<MuscleGroup, Anchor>> = {}
  ;(Object.keys(groupMap) as MuscleGroup[]).forEach((g) => {
    const slugs = groupMap[g]
    if (!slugs.length) return
    let sx = 0, sy = 0, n = 0
    for (const part of body) {
      if (!part.slug || !slugs.includes(part.slug)) continue
      for (const arr of [part.path?.common, part.path?.left, part.path?.right]) {
        if (!arr) continue
        for (const d of arr) {
          const nums = d.match(/-?\d*\.?\d+/g)
          if (!nums) continue
          for (let i = 0; i + 1 < nums.length; i += 2) { sx += +nums[i]; sy += +nums[i + 1]; n++ }
        }
      }
    }
    if (n > 0) out[g] = { x: (sx / n - xOffset) / VB_W, y: (sy / n) / VB_H }
  })
  return out
}
const ANCHOR_FRONT = computeAnchors(bodyFront as ReadonlyArray<PathPart>, GROUP_TO_SLUGS_FRONT, 0)
const ANCHOR_BACK = computeAnchors(bodyBack as ReadonlyArray<PathPart>, GROUP_TO_SLUGS_BACK, VB_W)

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`
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
  const isFront = view === 'front'
  const groupMap = isFront ? GROUP_TO_SLUGS_FRONT : GROUP_TO_SLUGS_BACK
  const slugToGroup = isFront ? SLUG_TO_GROUP_FRONT : SLUG_TO_GROUP_BACK
  const anchors = isFront ? ANCHOR_FRONT : ANCHOR_BACK

  const colorForGroup = (g: MuscleGroup): string => {
    if (mode === 'heatmap') {
      const heat = Math.max(0, Math.min(1, heatByGroup?.[g] ?? 0))
      return hexToRgba(C.primary, 0.14 + heat * 0.86)
    }
    if (mode === 'rank') return muscleTierColor(C, rankByGroup?.[g])
    return muscleStatusColor(C, statusByGroup[g])
  }

  // Expand each group's colour onto its member muscles; highlight the selected group.
  const data: ExtendedBodyPart[] = []
  ;(Object.keys(groupMap) as MuscleGroup[]).forEach((g) => {
    const slugs = groupMap[g]
    if (!slugs.length) return
    const color = colorForGroup(g)
    const sel = selected === g
    slugs.forEach((slug) =>
      data.push(sel ? { slug, color, styles: { stroke: C.text, strokeWidth: 2 } } : { slug, color }))
  })

  const scale = size / 200 // SvgMaleWrapper renders at 200*scale × 400*scale
  const w = size
  const h = size * 2

  return (
    <View style={[styles.wrap, { width: w, height: h }]}>
      <View style={{ opacity: dimmed ? 0.5 : 1 }}>
        <Body
          data={data}
          side={view}
          gender="male"
          scale={scale}
          border={C.outline}
          defaultFill={C.surfaceContainerHigh}
          onBodyPartPress={onSelect ? (p) => {
            const s = p.slug
            if (!s) return
            const g = slugToGroup[s]
            if (g) onSelect(g)
          } : undefined}
        />
      </View>

      {bubbles?.map((b) => {
        const a = anchors[b.group]
        if (!a) return null
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
