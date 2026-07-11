// Tempo — exercise library search.
//
// One shared, client-side search used by the exercise picker and the library
// browser. The whole library (~1300 built-ins + the user's customs) is fetched
// once and cached, then every keystroke filters and RANKS locally — instant, no
// debounce lag, works mid-set in a basement gym.
//
// Ranking rules (why "push" never returns pull-ups):
//   * every query token must match the exercise somewhere (AND semantics) — an
//     exercise that matches "push" only because of a stray substring in a muscle
//     name is excluded, not down-ranked;
//   * name matches beat muscle matches beat pattern/equipment matches;
//   * ties break by popularity (staples first), then name.
// Aliases fold gym shorthand into canonical tokens: "rdl" finds Romanian
// Deadlifts, "ohp" the overhead press, "pushup" the hyphenated Push-Up.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { needsApparatus } from '@/lib/equipmentMatch'
import type { Exercise, MovementPattern, MuscleGroup } from '@/types'

// Everything list surfaces need. Imported rows carry empty instructions (their
// steps are fetched remotely on demand — see lib/exerciseDb.ts), so including
// the column costs almost nothing and keeps the original seed's steps available.
export const LIBRARY_COLUMNS =
  'id, name, movement_pattern, primary_muscles, secondary_muscles, required_equipment, ' +
  'experience_level, video_url, instructions, substitute_ids, user_id, is_custom, category, ' +
  'notes, tracking_metrics, is_core, popularity, muscle_group'

// ── Library fetch (shared cache) ──────────────────────────────────────────────

export async function fetchLibrary(): Promise<Exercise[]> {
  // RLS scopes rows to "built-in OR mine", so a plain select returns exactly
  // the right library for the signed-in user.
  const { data, error } = await supabase
    .from('exercises')
    .select(LIBRARY_COLUMNS)
    .order('popularity', { ascending: false })
    .order('name')
  if (error) throw error
  return (data ?? []) as unknown as Exercise[]
}

export function useExerciseLibrary(enabled = true) {
  return useQuery({
    queryKey: ['exercise-library'],
    queryFn: fetchLibrary,
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}

// ── Muscle groups (filter buckets) ────────────────────────────────────────────

export const MUSCLE_GROUPS: { id: MuscleGroup; label: string }[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'arms', label: 'Arms' },
  { id: 'legs', label: 'Legs' },
  { id: 'glutes', label: 'Glutes' },
  { id: 'core', label: 'Core' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'mobility', label: 'Mobility' },
]

// Customs (and rows predating the v2 migration) have no muscle_group — derive one.
export function muscleGroupOf(ex: Pick<Exercise, 'muscle_group' | 'movement_pattern' | 'primary_muscles'>): MuscleGroup {
  if (ex.muscle_group) return ex.muscle_group
  const m = ex.primary_muscles?.[0] ?? ''
  if (['chest', 'upper_chest', 'serratus'].includes(m)) return 'chest'
  if (['lats', 'rhomboids', 'upper_back', 'traps', 'mid_traps', 'upper_traps', 'teres_major', 'lower_back', 'erectors', 'back'].includes(m)) return 'back'
  if (['shoulders', 'lateral_deltoids', 'rear_delts', 'rotator_cuff'].includes(m)) return 'shoulders'
  if (['biceps', 'triceps', 'forearms', 'brachialis'].includes(m)) return 'arms'
  if (['glutes'].includes(m)) return 'glutes'
  if (['quads', 'hamstrings', 'calves', 'legs', 'inner_thighs', 'adductors', 'abductors', 'hip_flexors'].includes(m)) return 'legs'
  switch (ex.movement_pattern) {
    case 'push': return 'chest'
    case 'pull': return 'back'
    case 'squat':
    case 'hinge': return 'legs'
    case 'cardio': return 'cardio'
    case 'mobility': return 'mobility'
    case 'carry': return 'core'
    default: return 'core'
  }
}

// ── Query normalization + aliases ─────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Gym shorthand → canonical search text. Applied to whole normalized queries and
// single tokens, so "rdl", "db rdl" and "romanian" all reach the same rows.
const ALIASES: Record<string, string> = {
  'rdl': 'romanian deadlift',
  'sldl': 'stiff leg deadlift',
  'ohp': 'overhead press',
  'bp': 'bench press',
  'db': 'dumbbell',
  'bb': 'barbell',
  'kb': 'kettlebell',
  'bw': 'bodyweight',
  'lat raise': 'lateral raise',
  'lat raises': 'lateral raise',
  'skullcrusher': 'skull crusher',
  'skullcrushers': 'skull crusher',
  'pushup': 'push up',
  'pushups': 'push up',
  'pullup': 'pull up',
  'pullups': 'pull up',
  'chinup': 'chin up',
  'chinups': 'chin up',
  'situp': 'sit up',
  'situps': 'sit up',
  'stepup': 'step up',
  'tricep': 'triceps',
  'bicep': 'biceps',
  'pec dec': 'pec deck',
  'hip thrusts': 'hip thrust',
  'ghd': 'back extension',
  'tgu': 'turkish get up',
  'bss': 'split squat',
  'quad': 'quads',
  'ham': 'hamstrings',
  'hams': 'hamstrings',
  'hammies': 'hamstrings',
  'delt': 'shoulders',
  'delts': 'shoulders',
  'abs': 'abs core',
  'glute': 'glutes',
}

function expandAliases(normalized: string): string {
  if (ALIASES[normalized]) return ALIASES[normalized]
  return normalized
    .split(' ')
    .map(t => ALIASES[t] ?? t)
    .join(' ')
}

// ── Search index ──────────────────────────────────────────────────────────────

interface IndexedExercise {
  ex: Exercise
  nameNorm: string        // normalized display name
  nameTokens: string[]
  muscles: string         // normalized primary + secondary muscles
  meta: string            // pattern + muscle group + equipment + level (+ CUSTOM)
}

const EQUIP_WORDS: Record<string, string> = {
  full_gym: 'machine cable gym',
  dumbbells: 'dumbbell',
  barbell: 'barbell',
  kettlebell: 'kettlebell',
  resistance_bands: 'band bands resistance band',
  bodyweight: 'bodyweight no equipment',
}

function indexExercise(ex: Exercise): IndexedExercise {
  const nameNorm = normalize(ex.name)
  const muscles = normalize([...(ex.primary_muscles ?? []), ...(ex.secondary_muscles ?? [])].join(' ').replace(/_/g, ' '))
  const meta = [
    ex.movement_pattern,
    muscleGroupOf(ex),
    ...(ex.required_equipment ?? []).map(e => EQUIP_WORDS[e] ?? e),
    ex.experience_level,
    ex.is_custom ? 'custom my' : '',
  ].join(' ')
  return { ex, nameNorm, nameTokens: nameNorm.split(' '), muscles, meta: normalize(meta) }
}

// Module-level index cache keyed by the exact array identity React Query hands
// out, so re-renders don't re-index 1300 rows.
let indexCacheSource: Exercise[] | null = null
let indexCache: IndexedExercise[] = []

function indexOf(rows: Exercise[]): IndexedExercise[] {
  if (rows !== indexCacheSource) {
    indexCacheSource = rows
    indexCache = rows.map(indexExercise)
  }
  return indexCache
}

// ── Ranking ───────────────────────────────────────────────────────────────────

function scoreToken(item: IndexedExercise, token: string): number {
  // Name hits — strongest signal.
  if (item.nameNorm === token) return 1000
  if (item.nameNorm.startsWith(token + ' ') || item.nameNorm.startsWith(token)) return 600
  let best = 0
  for (const w of item.nameTokens) {
    if (w === token) { best = Math.max(best, 500); break }
    if (w.startsWith(token)) best = Math.max(best, 380)
  }
  if (best) return best
  if (token.length >= 4 && item.nameNorm.includes(token)) return 220
  // Muscle hits.
  if (item.muscles.split(' ').some(w => w === token || w.startsWith(token))) return 120
  // Pattern / group / equipment / level hits.
  if (item.meta.split(' ').some(w => w === token || (token.length >= 4 && w.startsWith(token)))) return 80
  return 0
}

export interface LibraryFilters {
  muscleGroup?: MuscleGroup | null
  pattern?: MovementPattern | null
  equipment?: string | null      // one of the Equipment ids
  coreOnly?: boolean
}

// Whether an exercise passes the equipment filter. Two ids are virtual — the
// library tags pull-ups/dips/etc. as `bodyweight`, so we split that bucket by
// lib/equipmentMatch.needsApparatus: "Pull-up bar" surfaces the bar/dip/ring
// moves, and "Bodyweight" is the floor-only remainder. Everything else is a plain
// required_equipment membership test.
function matchesEquipmentFilter(ex: Exercise, equipment: string): boolean {
  const eq = ex.required_equipment ?? []
  if (equipment === 'pull_up_bar') return eq.includes('bodyweight') && needsApparatus(ex.name)
  if (equipment === 'bodyweight') return eq.includes('bodyweight') && !needsApparatus(ex.name)
  return eq.includes(equipment as Exercise['required_equipment'][number])
}

// Filter + rank the library for a query. Empty query = browse mode (filters +
// popularity order). Every query token must match (AND) — this is what keeps
// unrelated movements out of the results entirely.
export function searchLibrary(rows: Exercise[], query: string, filters?: LibraryFilters): Exercise[] {
  const idx = indexOf(rows)
  const q = expandAliases(normalize(query))
  const tokens = q ? q.split(' ') : []

  const scored: { item: IndexedExercise; score: number }[] = []
  for (const item of idx) {
    const { ex } = item
    if (filters?.muscleGroup && muscleGroupOf(ex) !== filters.muscleGroup) continue
    if (filters?.pattern && ex.movement_pattern !== filters.pattern) continue
    if (filters?.coreOnly && !ex.is_core && !ex.is_custom) continue
    if (filters?.equipment && !matchesEquipmentFilter(ex, filters.equipment)) continue

    let score = 0
    let miss = false
    for (const t of tokens) {
      const s = scoreToken(item, t)
      if (s === 0) { miss = true; break }
      score += s
    }
    if (miss) continue

    // Popularity settles ties; user customs surface above equally-good built-ins.
    score += (ex.popularity ?? 30) / 2
    if (ex.is_custom) score += 90
    scored.push({ item, score })
  }

  // On a real relevance tie (notably: no search query at all, pure browsing),
  // prefer the shorter/plainer name as the tie-break — "Bench Press" reads as
  // the representative before "Incline Dumbbell Bench Press" rather than
  // whichever happened to sort alphabetically first. A genuine search match
  // (e.g. "dumbbell bench") already differentiates scores via scoreToken, so
  // this never overrides an intentional relevance match.
  scored.sort((a, b) =>
    b.score - a.score ||
    a.item.ex.name.length - b.item.ex.name.length ||
    a.item.ex.name.localeCompare(b.item.ex.name))
  return scored.map(s => s.item.ex)
}

// ── Variant families (collapse the long tail) ─────────────────────────────────
//
// The library has, say, a dozen "bench press" rows (barbell / dumbbell / cable /
// smith / incline-of-each …). Showing all of them on every "bench" search is the
// endless-scroll problem. We group rows that are the SAME movement done with
// different gear (or a trivial stance/grip tweak) into one family, show the best
// match as the representative, and tuck the rest behind a "+N variations" tap.
// Meaningful modifiers (incline, decline, close-grip, sumo, romanian, single-leg
// on a squat …) are kept in the key, so those stay separate families.

// Equipment / accessory / stance words stripped when computing a family key.
const FAMILY_STRIP = new RegExp(
  '\\b(' + [
    'barbell', 'dumbbell', 'dumbbells', 'cable', 'machine', 'smith', 'kettlebell',
    'ez[- ]?bar', 'ez', 'band', 'resistance', 'lever', 'sled', 'weighted', 'bodyweight',
    'olympic', 'trap', 'medicine', 'exercise', 'stability', 'bosu', 'roller', 'landmine',
    'seated', 'standing', 'kneeling', 'lying', 'prone', 'supine', 'bench',
    'alternate', 'alternating', 'one', 'two', 'single', 'arm', 'arms',
    'with', 'rope', 'towel', 'ball', 'on', 'floor', 'the', 'a', 'of', 'to',
    'version', 'v', 'grip', 'neutral', 'palm', 'palms', 'reverse',
  ].join('|') + ')\\b',
  'gi',
)

function familyKey(ex: Exercise): string {
  let base = normalize(ex.name)
  base = base.replace(FAMILY_STRIP, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim()
  // Fall back to the raw name if stripping emptied it (e.g. "Dead Hang" → "dead hang").
  if (!base) base = normalize(ex.name)
  // Scope by pattern so a "row" pull and a "row" machine-cardio never merge.
  return `${ex.movement_pattern}:${base}`
}

export interface ExerciseFamily {
  key: string
  representative: Exercise
  members: Exercise[]     // representative first, then the rest (ranked)
}

// Group an already-ranked list into families, preserving the ranked order (a
// family sits where its best-matching member first appears). The representative
// is that best member, so searching "dumbbell bench" surfaces the dumbbell row.
export function groupFamilies(ranked: Exercise[]): ExerciseFamily[] {
  const families = new Map<string, ExerciseFamily>()
  const order: string[] = []
  for (const ex of ranked) {
    const key = familyKey(ex)
    const fam = families.get(key)
    if (fam) {
      fam.members.push(ex)
    } else {
      families.set(key, { key, representative: ex, members: [ex] })
      order.push(key)
    }
  }
  return order.map(k => families.get(k)!)
}
