import { resumeStepIndex, type TutorialStep } from '@/lib/tutorial'

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
