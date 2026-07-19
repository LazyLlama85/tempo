// Tempo — first-time experience framework (definitions + device-local persistence).
//
// A reusable tutorial engine, NOT a pile of ad-hoc booleans. State is device-local
// (SQLite-backed localStorage, keyed by user) so steps complete offline and a
// failed API call can never mark a tutorial done. Tutorials are OPT-IN: a first-run
// tutorial only shows if it was explicitly ARMED at the deterministic new-user
// moment (onboarding success) — so existing users, re-planners, and reinstalls
// never see it. A `version` lets steps be retired without wiping real progress; an
// app update never resets tutorials (localStorage survives upgrades).

export const TUTORIAL_STORE_VERSION = 1

// Tutorial ids.
export const T = {
  welcome: 'welcome',
  homeTour: 'home_tour',
  firstWorkout: 'first_workout',
  planTour: 'plan_tour',
  conceptsTour: 'concepts_tour',
} as const
export type TutorialId = (typeof T)[keyof typeof T]

// A spotlight step in an overlay-driven tour. `target` is a registered element id
// (see useTutorialTarget); a missing/unmeasured target falls back to a centered
// card so the tour never breaks. `screen` is an optional router href — when a
// step's screen differs from wherever the user currently is, the overlay
// navigates there before spotlighting (see TutorialOverlay's cross-screen
// effect), which is what lets one tour span multiple tabs (T.conceptsTour).
export interface TutorialStep {
  id: string
  target?: string
  screen?: string
  title: string
  body: string
  placement?: 'top' | 'bottom' | 'auto'
}

// The Home tour — one concept per step, ≤2 sentences, never blocks the UI.
// `home_calendar` + `home_today` used to be two separate steps (the multi-day
// calendar strip, then the day's card below it) — collapsed into one now that
// Home itself IS today's timeline (the IA redesign, 2026-07-16): there's no
// separate calendar strip left on Home to spotlight on its own.
export const HOME_TOUR_STEPS: TutorialStep[] = [
  { id: 'home_today', target: 'home.today', title: 'Your day, in real time', body: 'Tempo slots your training into your real calendar — and moves it when life moves.', placement: 'bottom' },
  { id: 'home_go', target: 'tab.go', title: 'Only a few minutes?', body: 'Tap GO and Tempo builds a focused workout that fits the time you have.', placement: 'top' },
  { id: 'home_progress', target: 'tab.progress', title: 'Your progress story', body: 'Every session you finish becomes your history, PRs, and strength trends.', placement: 'top' },
  { id: 'home_profile', target: 'tab.profile', title: 'Make it yours', body: 'Change goals, equipment, and availability anytime — your plan adapts.', placement: 'top' },
]

// The Plan tour — introduces the 3 things new to the redesigned hub: the
// calendar (now owns all multi-day scheduling), the current split, and the
// library doors. One concept per step, same tone/length as the Home tour.
export const PLAN_TOUR_STEPS: TutorialStep[] = [
  { id: 'plan_calendar', target: 'plan.calendar', title: 'Your whole week, at a glance', body: 'Switch between Week and Month, tap any day, or reschedule your whole week around a busy stretch.', placement: 'bottom' },
  { id: 'plan_split', target: 'plan.split', title: 'Your training pattern', body: 'This is the split Tempo — or you — built. Edit it anytime; every upcoming day updates to match.', placement: 'bottom' },
  { id: 'plan_library', target: 'plan.library', title: 'Everything else lives here', body: 'Browse the exercise library or manage your saved workouts, without cluttering the hub above.', placement: 'top' },
]

// The Concepts tour — replaces the old how-tempo-works.tsx slideshow (deleted
// 2026-07-18). Same 7 concepts, same copy, but taught IN PLACE on the real
// screens they describe instead of a separate swipe deck, and replayable like
// any other tour. Ordered to minimize screen hops (Home x3, then Plan x3, then
// Profile x1 — 2 navigations total) rather than the slideshow's original
// linear order, since hopping tabs back-and-forth per step would feel janky.
// `concept_generate` deliberately reuses the `plan.split` target rather than
// spotlighting an in-progress workout runner — starting a real session just to
// teach a definition would be a genuine side effect, not a demo.
export const CONCEPTS_TOUR_STEPS: TutorialStep[] = [
  { id: 'concept_workout', screen: '/(tabs)', target: 'home.today', title: 'A workout', body: 'One training session — a list of exercises with sets, reps, and weight. You do one workout per training day.', placement: 'bottom' },
  { id: 'concept_add', screen: '/(tabs)', target: 'home.add_fab', title: 'Adding & editing workouts', body: 'Tap the + to build a workout from the Exercise Library. Tap any scheduled workout to move it, edit it, or mark it done.', placement: 'top' },
  { id: 'concept_calendar', screen: '/(tabs)', target: 'home.today', title: 'Your calendar', body: 'Shows what’s scheduled each day — a missed workout just gets marked MISSED, no shame, reschedule it anytime. Connect your real calendar in Settings so Tempo can plan around your actual free time.', placement: 'bottom' },
  { id: 'concept_split', screen: '/(tabs)/plan', target: 'plan.split', title: 'A split', body: 'Your recurring weekly pattern — which workout you do on which day (Push / Pull / Legs / Rest). Tempo can build one for you, or you can create your own in My Splits.', placement: 'bottom' },
  { id: 'concept_generate', screen: '/(tabs)/plan', target: 'plan.split', title: '“Tempo generates” = the exercises', body: 'Generating picks what to actually do — exercises, sets, reps, and how hard — based on your goal, experience, and recent performance.', placement: 'bottom' },
  { id: 'concept_schedule', screen: '/(tabs)/plan', target: 'plan.calendar', title: '“Tempo schedules” = the day & time', body: 'Scheduling places it on your calendar around your real life. Generating and scheduling are separate — build your own workout and still let Tempo schedule it, or vice versa.', placement: 'bottom' },
  { id: 'concept_equipment', screen: '/(tabs)/profile', target: 'profile.training', title: 'Equipment & goals', body: 'Change your goal, experience, equipment, or days per week anytime from Profile — Tempo re-tunes every future workout automatically.', placement: 'bottom' },
]

// Target ids screens register via useTutorialTarget, referenced by steps above.
export const TARGET = {
  homeToday: 'home.today',
  tabGo: 'tab.go',
  tabProgress: 'tab.progress',
  tabProfile: 'tab.profile',
  planCalendar: 'plan.calendar',
  planSplit: 'plan.split',
  planLibrary: 'plan.library',
  homeAddFab: 'home.add_fab',
  profileTraining: 'profile.training',
} as const

// Every tour's step array, keyed by id — the one lookup the overlay and the
// store both read, so adding a tour is "add an id + a step array" (see
// stores/tutorial.ts's STEPS and TutorialOverlay's `steps` derivation).
export const TOUR_STEPS: Record<TutorialId, TutorialStep[]> = {
  [T.welcome]: [],
  [T.homeTour]: HOME_TOUR_STEPS,
  [T.firstWorkout]: [],
  [T.planTour]: PLAN_TOUR_STEPS,
  [T.conceptsTour]: CONCEPTS_TOUR_STEPS,
}

// ── Persisted state ────────────────────────────────────────────────────────────

export interface TutorialData {
  version: number
  completedSteps: Record<string, true>
  skipped: Record<string, true>
  armed: Record<string, true>
  firstPlanCreated: boolean
  firstWorkoutCompleted: boolean
  lastSeenAt: number
}

export function emptyTutorialData(): TutorialData {
  return {
    version: TUTORIAL_STORE_VERSION,
    completedSteps: {},
    skipped: {},
    armed: {},
    firstPlanCreated: false,
    firstWorkoutCompleted: false,
    lastSeenAt: 0,
  }
}

const key = (userId: string) => `tempo.tutorial.${userId}`

export function readTutorialData(userId: string): TutorialData {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(key(userId))
    if (!raw) return emptyTutorialData()
    const parsed = JSON.parse(raw) as Partial<TutorialData>
    // Merge onto the empty shape so a store-version bump can add fields safely.
    return { ...emptyTutorialData(), ...parsed }
  } catch {
    return emptyTutorialData()
  }
}

export function writeTutorialData(userId: string, data: TutorialData): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(key(userId), JSON.stringify(data))
  } catch { /* best-effort; UX-only state */ }
}

// ── One-off contextual tips (localStorage booleans, keyed globally per device) ──
// Lighter than the tour system — for single "did you know" moments (first edit,
// first Progress visit, first equipment change). Returns true the first time only.
const tipKey = (id: string) => `tempo.tip.${id}`

export function shouldShowTip(id: string): boolean {
  try {
    return !(globalThis as { localStorage?: Storage }).localStorage?.getItem(tipKey(id))
  } catch {
    return false
  }
}

export function markTipSeen(id: string): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(tipKey(id), '1')
  } catch { /* best-effort */ }
}
