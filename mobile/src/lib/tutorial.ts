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
} as const
export type TutorialId = (typeof T)[keyof typeof T]

// A spotlight step in an overlay-driven tour (currently the Home tour). `target`
// is a registered element id (see useTutorialTarget); a missing/unmeasured target
// falls back to a centered card so the tour never breaks.
export interface TutorialStep {
  id: string
  target?: string
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

// Target ids screens register via useTutorialTarget, referenced by steps above.
export const TARGET = {
  homeToday: 'home.today',
  tabGo: 'tab.go',
  tabProgress: 'tab.progress',
  tabProfile: 'tab.profile',
  planCalendar: 'plan.calendar',
  planSplit: 'plan.split',
  planLibrary: 'plan.library',
} as const

// Every tour's step array, keyed by id — the one lookup the overlay and the
// store both read, so adding a tour is "add an id + a step array" (see
// stores/tutorial.ts's STEPS and TutorialOverlay's `steps` derivation).
export const TOUR_STEPS: Record<TutorialId, TutorialStep[]> = {
  [T.welcome]: [],
  [T.homeTour]: HOME_TOUR_STEPS,
  [T.firstWorkout]: [],
  [T.planTour]: PLAN_TOUR_STEPS,
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
