import { T, TOUR_STEPS, TARGET, FIRST_RUN_TOUR_STEPS, HOME_TOUR_STEPS, PLAN_TOUR_STEPS, resumeStepIndex, spotlightLayout, MIN_TOOLTIP_H, type TutorialStep } from '@/lib/tutorial'

const steps: TutorialStep[] = [
  { id: 'a', title: '', body: '' },
  { id: 'b', title: '', body: '' },
  { id: 'c', title: '', body: '' },
  { id: 'd', title: '', body: '' },
]

describe('resumeStepIndex — tour resume point (T3.4)', () => {
  it('starts at 0 when nothing is completed', () => {
    expect(resumeStepIndex(steps, {})).toBe(0)
  })

  it('resumes after an interrupted tour instead of replaying from the start', () => {
    // Steps a/b were completed (the user advanced through them) before the tour
    // was interrupted — a restart must not re-show a/b.
    expect(resumeStepIndex(steps, { a: true, b: true })).toBe(2)
  })

  it('resumes at the last step if every step but it is done', () => {
    expect(resumeStepIndex(steps, { a: true, b: true, c: true })).toBe(3)
  })

  it('falls back to 0 if every step is already done (defensive — callers gate on this)', () => {
    expect(resumeStepIndex(steps, { a: true, b: true, c: true, d: true })).toBe(0)
  })

  it('an empty tour (T.firstWorkout-style) resumes at 0', () => {
    expect(resumeStepIndex([], {})).toBe(0)
  })
})

// ── spotlightLayout ────────────────────────────────────────────────────────────
// Regression tests for the first-run bug in the founder's 2026-08-31 recording:
// the card (and its Next button) was placed off the bottom of the screen, so the
// tour looked frozen on step 1 and repeated taps then advanced several steps at
// once. The guarantee these tests pin: whatever the target rect, the whole card
// is on screen and pressable.
describe('spotlightLayout', () => {
  // A few real device shapes, in points.
  const DEVICES = [
    { name: 'iPhone SE', screenH: 667, insetTop: 20, insetBottom: 0 },
    { name: 'iPhone 15', screenH: 852, insetTop: 59, insetBottom: 34 },
    { name: 'iPhone 15 Pro Max', screenH: 932, insetTop: 62, insetBottom: 34 },
    { name: 'Pixel 8', screenH: 800, insetTop: 24, insetBottom: 24 },
  ]

  /** The card is fully within the safe area, so Next can always be pressed. */
  function assertCardFullyVisible(l: ReturnType<typeof spotlightLayout>, d: typeof DEVICES[number]) {
    const usableTop = d.insetTop
    const usableBottom = d.screenH - d.insetBottom
    if (l.top !== undefined) {
      expect(l.top).toBeGreaterThanOrEqual(0)
      expect(l.top + MIN_TOOLTIP_H).toBeLessThanOrEqual(usableBottom)
    } else if (l.bottom !== undefined) {
      expect(l.bottom).toBeGreaterThanOrEqual(0)
      expect(d.screenH - l.bottom - MIN_TOOLTIP_H).toBeGreaterThanOrEqual(usableTop)
    } else {
      throw new Error('layout placed the card with neither top nor bottom')
    }
  }

  it('never places the card off screen, for any target on any device', () => {
    for (const d of DEVICES) {
      for (const placement of ['top', 'bottom', 'auto', undefined] as const) {
        // Sweep the target down the screen at several heights, including the
        // tall-and-high shape that caused the bug.
        for (let y = 0; y < d.screenH; y += 40) {
          for (const h of [40, 90, 160, 280, Math.round(d.screenH * 0.5)]) {
            const l = spotlightLayout({
              rect: { x: 16, y, width: 340, height: h },
              screenH: d.screenH, insetTop: d.insetTop, insetBottom: d.insetBottom, placement,
            })
            assertCardFullyVisible(l, d)
          }
        }
      }
    }
  })

  it('handles a missing rect with a centred, on-screen card', () => {
    for (const d of DEVICES) {
      const l = spotlightLayout({ screenH: d.screenH, insetTop: d.insetTop, insetBottom: d.insetBottom })
      expect(l.hole).toBeNull()
      assertCardFullyVisible(l, d)
    }
  })

  it('drops the spotlight when the target is more than half the screen', () => {
    // `home.today` is most of Home: a ring around it is not a spotlight, and it
    // was the target that produced the off-screen card.
    const l = spotlightLayout({ rect: { x: 16, y: 120, width: 350, height: 600 }, screenH: 852, insetTop: 59, insetBottom: 34 })
    expect(l.hole).toBeNull()
  })

  it('the exact shape from the recording keeps Next on screen', () => {
    // Tall-ish, starts high: no room above, little room below.
    const d = DEVICES[1]
    const l = spotlightLayout({
      rect: { x: 16, y: 90, width: 350, height: 420 },
      screenH: d.screenH, insetTop: d.insetTop, insetBottom: d.insetBottom, placement: 'bottom',
    })
    assertCardFullyVisible(l, d)
  })

  it('puts the card above a target pinned to the bottom, like the tab bar', () => {
    const d = DEVICES[1]
    const l = spotlightLayout({
      rect: { x: 150, y: d.screenH - 90, width: 60, height: 50 },
      screenH: d.screenH, insetTop: d.insetTop, insetBottom: d.insetBottom, placement: 'top',
    })
    expect(l.hole).not.toBeNull()
    expect(l.top).toBeUndefined()
    assertCardFullyVisible(l, d)
  })

  it('never returns a maxHeight, which is what used to clip the Next button', () => {
    const l = spotlightLayout({ rect: { x: 16, y: 200, width: 340, height: 90 }, screenH: 852, insetTop: 59, insetBottom: 34 })
    expect((l as Record<string, unknown>).maxHeight).toBeUndefined()
  })
})

// ── The first-run tour's shape ─────────────────────────────────────────────────
// Pins the 2026-08-31 cut from 14 cards across three tours to 4 in one, so the
// walkthrough cannot quietly grow back.
describe('FIRST_RUN_TOUR_STEPS', () => {
  it('is short enough to actually get through', () => {
    expect(FIRST_RUN_TOUR_STEPS.length).toBeLessThanOrEqual(4)
  })

  it('is the only tour with steps', () => {
    expect(HOME_TOUR_STEPS).toHaveLength(0)
    expect(PLAN_TOUR_STEPS).toHaveLength(0)
    expect(TOUR_STEPS[T.conceptsTour]).toBe(FIRST_RUN_TOUR_STEPS)
  })

  it('crosses screens exactly once', () => {
    const screens = FIRST_RUN_TOUR_STEPS.map(s => s.screen)
    const hops = screens.filter((s, i) => i > 0 && s !== screens[i - 1]).length
    expect(hops).toBe(1)
  })

  it('reuses step ids so anyone who saw the old tour is not shown it again', () => {
    // Completion is stored per step id. A user who finished the old walkthrough
    // has these marked done, so resumeStepIndex lands past them.
    const done = Object.fromEntries(FIRST_RUN_TOUR_STEPS.map(s => [s.id, true as const]))
    expect(resumeStepIndex(FIRST_RUN_TOUR_STEPS, done)).toBe(0)
    const lastId = FIRST_RUN_TOUR_STEPS[FIRST_RUN_TOUR_STEPS.length - 1].id
    expect(['concept_schedule', 'concept_split', 'home_today', 'home_go']).toContain(lastId)
  })

  it('every step points at a target a screen actually registers', () => {
    const known = new Set(Object.values(TARGET))
    for (const s of FIRST_RUN_TOUR_STEPS) {
      expect(s.target).toBeDefined()
      expect(known.has(s.target as never)).toBe(true)
    }
  })

  it('keeps every step to at most two sentences', () => {
    for (const s of FIRST_RUN_TOUR_STEPS) {
      const sentences = s.body.split(/[.?!]\s/).filter(Boolean)
      expect(sentences.length).toBeLessThanOrEqual(3)
    }
  })
})
