// Tempo — Muscle Map.
//
// Anatomically-real muscular figure (front + back) from `react-native-body-highlighter`
// (MIT). In **status** mode it shades each INDIVIDUAL muscle by its own recovery status
// (`statusBySlug` — so biceps can differ from triceps, quads from hamstrings). The
// **heatmap** and **rank** modes shade by Tempo's six coarse groups. Tapping a muscle
// selects it (a slug in status mode, a coarse group in the other modes).

import Body, { type Slug, type ExtendedBodyPart } from 'react-native-body-highlighter'
import { View, StyleSheet } from 'react-native'
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

// Tempo's coarse group → the library's fine muscle slugs, per view (used by the
// heatmap/rank modes and to resolve a tapped slug back to its coarse group).
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

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`
}

export function MuscleMap({
  view, statusByGroup = {}, statusBySlug, heatByGroup, rankByGroup, mode = 'status',
  selected, selectedSlug, onSelect, onSelectSlug, dimmed = false, size = 220,
}: {
  view: BodyView
  /** Coarse per-group status (heatmap/rank fallback). */
  statusByGroup?: Partial<Record<MuscleGroup, MuscleStatus>>
  /** Per-individual-muscle status (status mode). Keys are body-figure slugs. */
  statusBySlug?: Partial<Record<string, MuscleStatus>>
  /** 0–1 training stimulus per group, for heatmap mode. */
  heatByGroup?: Partial<Record<MuscleGroup, number>>
  /** Rank tier per group, for rank mode. */
  rankByGroup?: Partial<Record<MuscleGroup, MuscleTier>>
  mode?: MapMode
  selected?: MuscleGroup | null
  selectedSlug?: string | null
  onSelect?: (g: MuscleGroup) => void
  onSelectSlug?: (slug: string) => void
  dimmed?: boolean
  size?: number
}) {
  const C = useTheme()
  const isFront = view === 'front'
  const groupMap = isFront ? GROUP_TO_SLUGS_FRONT : GROUP_TO_SLUGS_BACK
  const slugToGroup = isFront ? SLUG_TO_GROUP_FRONT : SLUG_TO_GROUP_BACK

  const colorForGroup = (g: MuscleGroup): string => {
    if (mode === 'heatmap') {
      const heat = Math.max(0, Math.min(1, heatByGroup?.[g] ?? 0))
      return hexToRgba(C.primary, 0.14 + heat * 0.86)
    }
    if (mode === 'rank') return muscleTierColor(C, rankByGroup?.[g])
    return muscleStatusColor(C, statusByGroup[g])
  }

  // Status mode with per-muscle data → shade each muscle individually.
  const fine = mode === 'status' && !!statusBySlug

  const data: ExtendedBodyPart[] = []
  if (fine) {
    const slugsForView = new Set<Slug>(Object.values(groupMap).flat())
    slugsForView.forEach((slug) => {
      const st = statusBySlug![slug]
      if (!st) return // untrained muscle → defaultFill
      const color = muscleStatusColor(C, st)
      const sel = selectedSlug === slug
      data.push(sel ? { slug, color, styles: { stroke: C.text, strokeWidth: 2 } } : { slug, color })
    })
  } else {
    ;(Object.keys(groupMap) as MuscleGroup[]).forEach((g) => {
      const slugs = groupMap[g]
      if (!slugs.length) return
      const color = colorForGroup(g)
      const sel = selected === g
      slugs.forEach((slug) =>
        data.push(sel ? { slug, color, styles: { stroke: C.text, strokeWidth: 2 } } : { slug, color }))
    })
  }

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
          onBodyPartPress={(onSelect || onSelectSlug) ? (p) => {
            const s = p.slug
            if (!s) return
            if (fine && onSelectSlug) { onSelectSlug(s); return }
            const g = slugToGroup[s]
            if (g && onSelect) onSelect(g)
          } : undefined}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
})
