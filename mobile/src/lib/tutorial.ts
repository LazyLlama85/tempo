// Tempo — first-time experience framework (definitions + device-local persistence).
//
// A reusable tutorial engine, NOT a pile of ad-hoc booleans. State is device-local
// (SQLite-backed localStorage, keyed by user) so steps complete offline and a
// failed API call can never mark a tutorial done. Tutorials are OPT-IN: a first-run
// tutorial only shows if it was explicitly ARMED at the deterministic new-user
// moment (onboarding success) — so existing users, re-planners, and reinstalls
// never see it. A `version` lets steps be retired without wiping real progress; an
// app update never resets tutorials (localStorage survives upgrades).

import { BRAND_NAME } from '@/constants/brand'

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

// ONE first-run tour, four steps (2026-08-31).
//
// It used to be three tours totalling 14 cards on first launch: the Plan tour
// (3), the Concepts tour (7) and the Home tour (4). That is a lot of modal
// interruption before the user has done anything, and most of it taught things
// the UI already says. Each step was judged on one question — does this teach
// something the interface cannot make self-evident?
//
// CUT, because the UI already says it:
//   home_progress   a tab labelled "Progress" that shows progress
//   home_profile    a tab labelled "You" that holds your settings
//   plan_calendar   a calendar with a Week/Month toggle on it
//   plan_library    a nav row labelled with exactly what is behind it
//   concept_workout defining "a workout" to someone who downloaded a gym app
//   concept_add     a + button that adds things
//   concept_equipment  goals and equipment, findable under You
//
// KEPT, because they are genuinely not discoverable:
//   home_today       the wedge. The one thing this app does that others do not
//   home_go          GO is prominent but its purpose (a session sized to the
//                    time you have) is not readable off the button
//   concept_split    "split" is jargon, and the UI uses the word
//   concept_schedule generate-vs-schedule is the single most-confused concept
//                    in the product (see PRODUCT_AUDIT §08) — and the two old
//                    steps that split that distinction across separate cards
//                    are merged into the one card that draws it
//
// Step ids are deliberately reused from the old tours: completion is stored per
// step id, so anyone who already saw the old walkthrough keeps those steps
// marked done and is not shown it again.
//
// Ordered Home, Home, Plan, Plan — one navigation for the whole tour, where the
// old Concepts tour made two, each of which is a chance for a cross-screen
// target to mismeasure.
export const FIRST_RUN_TOUR_STEPS: TutorialStep[] = [
  { id: 'home_today', screen: '/(tabs)', target: 'home.today', title: 'Your day, in real time', body: `${BRAND_NAME} slots training into the gaps your week actually has, and moves it when life moves. Connect a calendar in Settings and it plans around your real commitments.`, placement: 'bottom' },
  { id: 'home_go', screen: '/(tabs)', target: 'tab.go', title: 'Only got a few minutes?', body: `Tap GO and ${BRAND_NAME} builds a session that fits the time you have, down to about fifteen minutes.`, placement: 'top' },
  { id: 'concept_split', screen: '/(tabs)/plan', target: 'plan.split', title: 'Your split', body: `The weekly pattern of which workout lands on which day — Push, Pull, Legs, Rest. ${BRAND_NAME} builds one for you, or you can make your own.`, placement: 'bottom' },
  { id: 'concept_schedule', screen: '/(tabs)/plan', target: 'plan.calendar', title: 'Generating and scheduling are separate', body: `Generating picks the exercises. Scheduling picks the day and time. So you can bring your own workout and still let ${BRAND_NAME} place it in your week.`, placement: 'bottom' },
]

// The old tours keep their ids so persisted progress, Settings' replay and the
// skip/replay bookkeeping all still resolve — they simply have no steps now.
// Everything worth keeping from them lives in FIRST_RUN_TOUR_STEPS above.
export const HOME_TOUR_STEPS: TutorialStep[] = []
export const PLAN_TOUR_STEPS: TutorialStep[] = []

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
  [T.conceptsTour]: FIRST_RUN_TOUR_STEPS,
}

// Where a (re)start of `steps` should resume, given which step ids are already
// completed. Every auto-start call site (Home/Plan `useFocusEffect`s) only gates
// on "is the LAST step done" — a tour interrupted after step 1 of 4
// (backgrounded, a tab switch, a force-quit mid-tour) still reads as
// armed+incomplete on the next visit. Resuming past whatever's already
// individually marked done (via completeStep in nextStep) is what stops the
// whole tour replaying from its first card every time — the root cause of "the
// tutorial reappears randomly" (T3.4). Returns 0 if nothing's done yet (or the
// tour has no steps), same as before this existed.
export function resumeStepIndex(steps: TutorialStep[], completedSteps: Record<string, true>): number {
  const i = steps.findIndex(s => !completedSteps[s.id])
  return i === -1 ? 0 : i
}

// ── Spotlight layout ───────────────────────────────────────────────────────────
// Where the tooltip card goes for a given target rect. Pure, so the awkward
// cases are unit-testable instead of only discoverable on a device.
//
// This exists because of a real first-run bug (founder screen recording,
// 2026-08-31): the overlay clamped the card against the TOP of the screen but
// never against the BOTTOM. A target that is both tall and starts high — Home's
// `home.today`, which is most of the screen — produced roomAbove < MIN_TOOLTIP_H,
// so the card was placed below the target at `hole.y + hole.h + 12`, i.e. off the
// bottom edge, taking the Next button with it. The tour looked frozen on step 1.
// The user then tapped repeatedly at a spotlight hole that does not advance,
// and several taps eventually landed at once, which is what read as "it jumps
// from 1 of 7 to 4 of 7".

// A realistic rendered height for the card: step row + title + up to ~5 lines of
// body + the 46pt Next button + padding. The old value (180) was an underestimate,
// which is how a "there is room here" check could still clip the Next button off
// the bottom of the card.
export const MIN_TOOLTIP_H = 280

// A hole taller than this fraction of the screen is not a spotlight, it is a
// box around half the UI. Better to show the plain centred card.
export const MAX_HOLE_FRACTION = 0.55

export interface SpotlightLayout {
  /** Null when there is no usable rect: caller renders a centred card. */
  hole: { x: number; y: number; w: number; h: number } | null
  top?: number
  bottom?: number
}

// Deliberately returns no maxHeight. Clamping the card's height is what clips
// the Next button, and an un-clamped card that slightly overlaps the spotlight
// is strictly better than a card you cannot press. Placement only ever picks a
// side that has been checked to have room for a full card; when neither side
// does, the card is pinned to the bottom safe area, where it always fits.
export function spotlightLayout(opts: {
  rect?: { x: number; y: number; width: number; height: number }
  screenH: number
  insetTop: number
  insetBottom: number
  placement?: 'top' | 'bottom' | 'auto'
  pad?: number
}): SpotlightLayout {
  const { rect, screenH: sh, insetTop, insetBottom, placement } = opts
  const pad = opts.pad ?? 8

  const tooBig = !!rect && rect.height + pad * 2 > sh * MAX_HOLE_FRACTION
  const hole = rect && !tooBig
    ? { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null

  if (!hole) return { hole: null, top: Math.max(insetTop + 12, sh / 2 - 140) }

  const roomAbove = hole.y - 12 - insetTop - 8
  const roomBelow = sh - (hole.y + hole.h) - 12 - insetBottom
  const prefersBelow = placement !== 'top' && hole.y + hole.h < sh * 0.6

  if (prefersBelow && roomBelow >= MIN_TOOLTIP_H) return { hole, top: hole.y + hole.h + 12 }
  if (roomAbove >= MIN_TOOLTIP_H) return { hole, bottom: sh - hole.y + 12 }
  if (roomBelow >= MIN_TOOLTIP_H) return { hole, top: hole.y + hole.h + 12 }
  // Neither side fits a full card: pin to the bottom safe area, where it does.
  return { hole, bottom: insetBottom + 12 }
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
