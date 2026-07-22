// Tempo — Muscle Map.
//
// Anatomically-real muscular figure (front + back) from `react-native-body-highlighter`
// (MIT). In **status** mode it shades each INDIVIDUAL muscle by its own recovery status
// (`statusBySlug` — so biceps can differ from triceps, quads from hamstrings). The
// **heatmap** and **rank** modes shade by Tempo's six coarse groups. Tapping a muscle
// selects it (a slug in status mode, a coarse group in the other modes).

import Body, { type Slug, type ExtendedBodyPart } from 'react-native-body-highlighter'
import { View, StyleSheet, Platform } from 'react-native'
import { BlurView } from 'expo-blur'
import { useTheme, useThemeStore, type Palette } from '@/theme'
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

// ── Locked (Pro-teaser) sample body ───────────────────────────────────────────
// A dimmed real map still leaks the whole answer: which muscles are fatigued,
// which are weak, which are under-trained — exactly what Pro is being sold for.
// So `locked` swaps in this fixed, plausible-looking SAMPLE dataset *before*
// anything is shaded, and covers the figure with a blur/scrim. Substituting
// rather than obscuring means there is no real data on screen to leak even if
// the blur fails to render (Android) or the user screenshots it.
export const SAMPLE_STATUS_BY_GROUP: Partial<Record<MuscleGroup, MuscleStatus>> = {
  chest: 'optimal', back: 'growing', shoulders: 'optimal',
  arms: 'attention', legs: 'fatigued', core: 'growing',
}
export const SAMPLE_STATUS_BY_SLUG: Partial<Record<string, MuscleStatus>> = {
  chest: 'optimal', trapezius: 'growing', deltoids: 'optimal',
  biceps: 'attention', triceps: 'attention', forearm: 'optimal',
  quadriceps: 'fatigued', hamstring: 'fatigued', gluteal: 'growing',
  calves: 'attention', adductors: 'optimal', tibialis: 'optimal',
  abs: 'growing', obliques: 'optimal',
  'upper-back': 'growing', 'lower-back': 'optimal',
}
export const SAMPLE_HEAT_BY_GROUP: Partial<Record<MuscleGroup, number>> = {
  chest: 0.8, back: 0.62, shoulders: 0.5, arms: 0.35, legs: 1, core: 0.45,
}
export const SAMPLE_RANK_BY_GROUP: Partial<Record<MuscleGroup, MuscleTier>> = {
  chest: 'advanced', back: 'intermediate', shoulders: 'intermediate',
  arms: 'novice', legs: 'elite', core: 'novice',
}

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`
}

export function MuscleMap({
  view, statusByGroup = {}, statusBySlug, heatByGroup, rankByGroup, mode = 'status',
  selected, selectedSlug, onSelect, onSelectSlug, dimmed = false, locked = false, size = 220,
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
  /**
   * Pro-locked preview. Renders the SAMPLE_* body instead of the caller's data
   * (so no real shading exists to leak), ignores selection, and covers the figure
   * with a blur + scrim. Callers may layer their own CTA on top.
   */
  locked?: boolean
  size?: number
}) {
  const C = useTheme()
  const themeMode = useThemeStore((st) => st.mode)
  const isFront = view === 'front'
  const groupMap = isFront ? GROUP_TO_SLUGS_FRONT : GROUP_TO_SLUGS_BACK
  const slugToGroup = isFront ? SLUG_TO_GROUP_FRONT : SLUG_TO_GROUP_BACK

  // Locked → every shading input becomes sample data before a single colour is
  // computed. Selection is dropped too: a highlighted muscle would still point at
  // something real. Everything below this line is identical for both states.
  const srcStatusByGroup = locked ? SAMPLE_STATUS_BY_GROUP : statusByGroup
  const srcStatusBySlug = locked ? SAMPLE_STATUS_BY_SLUG : statusBySlug
  const srcHeatByGroup = locked ? SAMPLE_HEAT_BY_GROUP : heatByGroup
  const srcRankByGroup = locked ? SAMPLE_RANK_BY_GROUP : rankByGroup
  const srcSelected = locked ? null : selected
  const srcSelectedSlug = locked ? null : selectedSlug

  const colorForGroup = (g: MuscleGroup): string => {
    if (mode === 'heatmap') {
      const heat = Math.max(0, Math.min(1, srcHeatByGroup?.[g] ?? 0))
      return hexToRgba(C.primary, 0.14 + heat * 0.86)
    }
    if (mode === 'rank') return muscleTierColor(C, srcRankByGroup?.[g])
    return muscleStatusColor(C, srcStatusByGroup[g])
  }

  // Status mode with per-muscle data → shade each muscle individually.
  const fine = mode === 'status' && !!srcStatusBySlug

  const data: ExtendedBodyPart[] = []
  if (fine) {
    const slugsForView = new Set<Slug>(Object.values(groupMap).flat())
    slugsForView.forEach((slug) => {
      const st = srcStatusBySlug![slug]
      if (!st) return // untrained muscle → defaultFill
      const color = muscleStatusColor(C, st)
      const sel = srcSelectedSlug === slug
      data.push(sel ? { slug, color, styles: { stroke: C.text, strokeWidth: 2 } } : { slug, color })
    })
  } else {
    ;(Object.keys(groupMap) as MuscleGroup[]).forEach((g) => {
      const slugs = groupMap[g]
      if (!slugs.length) return
      const color = colorForGroup(g)
      const sel = srcSelected === g
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
          onBodyPartPress={(!locked && (onSelect || onSelectSlug)) ? (p) => {
            const s = p.slug
            if (!s) return
            if (fine && onSelectSlug) { onSelectSlug(s); return }
            const g = slugToGroup[s]
            if (g && onSelect) onSelect(g)
          } : undefined}
        />
      </View>
      {locked && (
        // pointerEvents none so the caller's own CTA (or the surrounding card's
        // press target) still receives taps — this layer only obscures.
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Platform.OS === 'ios' && (
            <BlurView intensity={24} tint={themeMode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          {/* Carries the obscuring on Android, where BlurView is unreliable, and
              deepens it on iOS. Must never fail open. */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.scrimHeavy }]} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
})
