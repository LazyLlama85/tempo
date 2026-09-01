import { resumeStepIndex, type TutorialStep, spotlightLayout, MIN_TOOLTIP_H } from '@/lib/tutorial'

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
// a tall target that starts high pushed the tooltip (and its Next button) off
// the bottom of the screen, so the tour looked frozen on step 1.
describe('spotlightLayout', () => {
  const SH = 2556 / 3 // ~852pt, an iPhone 15 Pro in points
  const base = { screenH: SH, insetTop: 59, insetBottom: 34 }

  it('centres the card when there is no rect', () => {
    const l = spotlightLayout({ ...base })
    expect(l.hole).toBeNull()
    expect(l.top).toBeCloseTo(SH / 2 - 90)
  })

  it('drops the hole when the target is more than half the screen', () => {
    // home.today is most of Home: a ring around it is not a spotlight.
    const l = spotlightLayout({ ...base, rect: { x: 16, y: 120, width: 350, height: SH * 0.7 } })
    expect(l.hole).toBeNull()
  })

  it('never places the card off the bottom of the screen', () => {
    // The exact shape that broke: tall-ish, starts high, so there is no room
    // above (card would hit the status bar) and little room below.
    const l = spotlightLayout({ ...base, rect: { x: 16, y: 90, width: 350, height: SH * 0.5 }, placement: 'bottom' })
    if (l.top !== undefined) {
      expect(l.top + MIN_TOOLTIP_H).toBeLessThanOrEqual(SH)
    } else {
      expect(l.bottom).toBeGreaterThanOrEqual(base.insetBottom)
    }
  })

  it('puts the card below a target sitting high on the screen', () => {
    const l = spotlightLayout({ ...base, rect: { x: 16, y: 100, width: 350, height: 90 }, placement: 'bottom' })
    expect(l.hole).not.toBeNull()
    expect(l.top).toBeGreaterThan(190)
  })

  it('puts the card above a target pinned to the bottom (the tab bar)', () => {
    const l = spotlightLayout({ ...base, rect: { x: 150, y: SH - 90, width: 60, height: 50 }, placement: 'top' })
    expect(l.hole).not.toBeNull()
    expect(l.bottom).toBeGreaterThan(0)
    expect(l.top).toBeUndefined()
  })

  it('always leaves at least MIN_TOOLTIP_H of room', () => {
    for (const y of [0, 60, 200, 400, 600, SH - 120]) {
      for (const h of [40, 120, 300]) {
        const l = spotlightLayout({ ...base, rect: { x: 16, y, width: 350, height: h } })
        if (l.maxHeight !== undefined) expect(l.maxHeight).toBeGreaterThanOrEqual(MIN_TOOLTIP_H)
      }
    }
  })
})
