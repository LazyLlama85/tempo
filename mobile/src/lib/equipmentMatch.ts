// Tempo — what the user's equipment selection actually implies.
//
// Exercises store the MINIMUM gear they need ('barbell', 'dumbbells', …), but the
// onboarding selection is coarser: someone who picks "Full gym" obviously has
// barbells, dumbbells, cables and bands — yet a raw `required_equipment ∋ selection`
// match denies them every barbell and dumbbell lift. That single mismatch is how a
// full-gym beginner's "Pull" day ended up with zero pulls (and got padded with
// planks). Every equipment match in the app must expand through here.

export function expandEquipment(selected: readonly string[] | null | undefined): Set<string> {
  const have = new Set<string>(selected ?? [])
  have.add('bodyweight')
  if (have.has('full_gym')) {
    have.add('barbell')
    have.add('dumbbells')
    have.add('kettlebell')
    have.add('resistance_bands')
    // A gym always has pull-up bars and dip stations.
    have.add('pull_up_bar')
  }
  return have
}

// ── "Bodyweight" moves that actually need an apparatus ────────────────────────
//
// The library tags pull-ups, chin-ups, dips, muscle-ups, hanging leg raises,
// inverted rows and suspension work as `bodyweight` — they use no free weights —
// but you can't do any of them with truly NO equipment: they need a bar, dip
// station, parallel bars, rings, or a TRX. Someone who selects "No equipment" in
// onboarding / travel mode shouldn't be handed dips they can't perform. We detect
// these by name (the required_equipment column can't distinguish them) and gate
// them behind the `pull_up_bar` selection (which a full gym implies).
const APPARATUS_PATTERNS: RegExp[] = [
  /\bpull[\s-]?ups?\b/i,       // pull-up, pullup, pull ups
  /\bchin[\s-]?ups?\b/i,       // chin-up
  /\bchins?\b/i,              // "Gorilla Chin", "Sternum Chin" (chin tuck excluded below)
  /\bmuscle[\s-]?ups?\b/i,     // muscle-up
  /\bdips?\b/i,               // dip / dips (floor variants excluded below)
  /\bhang/i,                  // dead hang, hanging leg raise
  /\binverted\s+rows?\b/i,     // inverted row
  /\bparallel\s+bars?\b/i,     // work on parallel bars
  /\bcaptain'?s?\s+chair\b/i,  // captain's chair leg raise
  /\bskin\s+the\s+cat\b/i,
  /\b(front|back)\s+lever\b/i,
  /\bscapular?\s+(pull|dip)/i,
  /\bsuspended\b/i,           // TRX / suspension trainer
  /\bwith\s+straps?\b/i,      // "Inverted Row with Straps"
]

// True for a bodyweight movement that needs something to hang from / dip on. The
// caller decides what to do with it (gate on `pull_up_bar`). Conservative by
// design: it only flags clear apparatus moves, so a floor exercise is never
// wrongly stripped from a no-equipment plan.
export function needsApparatus(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return false
  if (/chin\s*tuck/i.test(n)) return false                       // neck drill, not a chin-up
  if (/\bdips?\b/i.test(n) && /\bfloor\b/i.test(n)) return false  // hands-on-floor triceps dips
  return APPARATUS_PATTERNS.some(re => re.test(n))
}

// Can the user do this exercise with the equipment they have? Combines the coarse
// required_equipment match with the apparatus gate above, so every consumer (plan
// generation, quick workouts, travel remap, substitutions) treats "no equipment"
// the same way. `have` must be an expanded set (see expandEquipment).
export function canPerform(
  ex: { name: string; required_equipment: readonly string[] },
  have: Set<string>,
): boolean {
  if (!ex.required_equipment.some(eq => have.has(eq))) return false
  // Bar/dip/ring/TRX moves (tagged `bodyweight`) need the apparatus.
  if (ex.required_equipment.includes('bodyweight') && needsApparatus(ex.name) && !have.has('pull_up_bar')) {
    return false
  }
  return true
}
