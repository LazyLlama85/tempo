// Tempo — tutorial store (reactive layer over lib/tutorial).
//
// Durable state (armed/completed/skipped/first-*) is persisted to localStorage per
// user via lib/tutorial. Ephemeral state (the measured target registry + which
// tour/step is active) lives only in memory — it drives the spotlight overlay.

import { create } from 'zustand'
import {
  T, TOUR_STEPS, readTutorialData, writeTutorialData, emptyTutorialData, resumeStepIndex,
  type TutorialData, type TutorialId,
} from '@/lib/tutorial'
import { track } from '@/lib/analytics'

export interface TargetRect { x: number; y: number; width: number; height: number }

// A screen's main ScrollView, registered by useTutorialScrollContainer — a plain
// {scrollTo, getScrollY} shape rather than the raw ScrollView instance, so this
// never depends on RN-version-specific native-method names (getScrollableNode,
// getInnerViewNode, etc. have shifted across RN releases).
export interface TutorialScrollContainer {
  scrollTo: (y: number) => void
  getScrollY: () => number
}

interface TutorialStoreState {
  userId: string | null
  data: TutorialData
  // Registry: element id → a function that re-measures it into window coords.
  measurers: Record<string, () => void>
  targets: Record<string, TargetRect>
  // Active overlay tour.
  activeTour: TutorialId | null
  stepIndex: number
  // The current screen's main scroll container — lets a step whose target is
  // below the fold scroll it into view before measuring, instead of spotlighting
  // empty space. Only one tour runs at a time, on one screen, so an un-keyed
  // single slot is enough; each screen clears it on unmount so a stale container
  // never leaks into a different screen's tour.
  scrollContainer: TutorialScrollContainer | null
  setScrollContainer: (c: TutorialScrollContainer | null) => void

  init: (userId: string) => void
  // Durable ops (persist).
  arm: (id: TutorialId) => void
  isArmed: (id: TutorialId) => boolean
  isStepDone: (stepId: string) => boolean
  completeStep: (stepId: string) => void
  skip: (id: TutorialId) => void
  replay: (id: TutorialId) => void
  setFirstPlanCreated: () => void
  setFirstWorkoutCompleted: () => void
  resetAll: () => void
  // Target registry (ephemeral).
  registerTarget: (id: string, measure: () => void) => void
  unregisterTarget: (id: string) => void
  setTargetRect: (id: string, rect: TargetRect) => void
  // Tour control (ephemeral).
  startTour: (id: TutorialId) => void
  nextStep: () => void
  endTour: (opts?: { skipped?: boolean }) => void
}

export const useTutorialStore = create<TutorialStoreState>((set, get) => {
  const persist = (mut: (d: TutorialData) => TutorialData) => {
    const { userId, data } = get()
    const next = mut({ ...data })
    set({ data: next })
    if (userId) writeTutorialData(userId, next)
  }

  return {
    userId: null,
    data: emptyTutorialData(),
    measurers: {},
    targets: {},
    activeTour: null,
    stepIndex: 0,
    scrollContainer: null,
    setScrollContainer: (c) => set({ scrollContainer: c }),

    init: (userId) => {
      // Reload the durable slice for this user (sign-in swaps users on a device).
      set({ userId, data: readTutorialData(userId), activeTour: null, stepIndex: 0 })
    },

    arm: (id) => persist(d => ({ ...d, armed: { ...d.armed, [id]: true } })),
    isArmed: (id) => !!get().data.armed[id] && !get().data.skipped[id],
    isStepDone: (stepId) => !!get().data.completedSteps[stepId],
    completeStep: (stepId) => persist(d => ({ ...d, completedSteps: { ...d.completedSteps, [stepId]: true }, lastSeenAt: 0 })),
    skip: (id) => persist(d => {
      // Skipping a tutorial completes its steps so it can't re-fire.
      const completedSteps = { ...d.completedSteps }
      for (const s of TOUR_STEPS[id]) completedSteps[s.id] = true
      return { ...d, skipped: { ...d.skipped, [id]: true }, completedSteps }
    }),
    replay: (id) => {
      persist(d => {
        const completedSteps = { ...d.completedSteps }
        for (const s of TOUR_STEPS[id]) delete completedSteps[s.id]
        const skipped = { ...d.skipped }; delete skipped[id]
        // Special step ids the welcome/first-workout screens track outside STEPS.
        if (id === T.welcome) delete completedSteps['welcome_done']
        if (id === T.firstWorkout) delete completedSteps['first_workout_intro']
        return { ...d, completedSteps, skipped, armed: { ...d.armed, [id]: true } }
      })
      track('tutorial_replayed', { tutorial: id })
    },
    setFirstPlanCreated: () => persist(d => ({ ...d, firstPlanCreated: true })),
    setFirstWorkoutCompleted: () => persist(d => ({ ...d, firstWorkoutCompleted: true })),
    resetAll: () => {
      const { userId } = get()
      const fresh = emptyTutorialData()
      set({ data: fresh })
      if (userId) writeTutorialData(userId, fresh)
    },

    registerTarget: (id, measure) => set(s => ({ measurers: { ...s.measurers, [id]: measure } })),
    unregisterTarget: (id) => set(s => {
      const measurers = { ...s.measurers }; delete measurers[id]
      const targets = { ...s.targets }; delete targets[id]
      return { measurers, targets }
    }),
    setTargetRect: (id, rect) => set(s => ({ targets: { ...s.targets, [id]: rect } })),

    startTour: (id) => {
      const { data } = get()
      set({ activeTour: id, stepIndex: resumeStepIndex(TOUR_STEPS[id], data.completedSteps) })
      track('tutorial_started', { tutorial: id })
    },
    nextStep: () => {
      const { activeTour, stepIndex } = get()
      if (!activeTour) return
      const steps = TOUR_STEPS[activeTour]
      const step = steps[stepIndex]
      if (step) { get().completeStep(step.id); track('tutorial_step_completed', { tutorial: activeTour, step: step.id }) }
      if (stepIndex + 1 >= steps.length) {
        get().endTour()
        track('tutorial_completed', { tutorial: activeTour })
      } else {
        set({ stepIndex: stepIndex + 1 })
      }
    },
    endTour: (opts) => {
      const { activeTour } = get()
      if (activeTour && opts?.skipped) { get().skip(activeTour); track('tutorial_skipped', { tutorial: activeTour }) }
      set({ activeTour: null, stepIndex: 0 })
    },
  }
})
