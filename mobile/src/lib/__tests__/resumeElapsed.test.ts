// A paused workout must not keep counting time.
//
// Founder, 2026-09-07: "when pausing workout, time should pause too."
//
// The session timer is wall-clock based on purpose — locking the phone between
// sets must not stop the clock. That is correct while training and wrong the
// moment you pause. Resuming an open log recomputed elapsed as
// (now - started_at), so every minute spent paused was counted as training. It
// was not only cosmetic: the completion path writes `actual_duration_min` from
// the same number, so a session paused overnight recorded hours of training.

import { resumeElapsedSeconds } from '@/lib/durationEstimate'

const startedAt = new Date('2026-09-07T10:00:00Z')
const twoHoursLater = new Date('2026-09-07T12:00:00Z')

describe('resumeElapsedSeconds', () => {
  it('resumes the banked ACTIVE time, ignoring how long the pause lasted', () => {
    // 18 minutes trained, then paused for the rest of two hours.
    expect(resumeElapsedSeconds(1080, startedAt, twoHoursLater)).toBe(1080)
  })

  it('does not count a pause even when it dwarfs the training', () => {
    const nextDay = new Date('2026-09-08T10:00:00Z')
    expect(resumeElapsedSeconds(300, startedAt, nextDay)).toBe(300)
  })

  it('falls back to wall clock for logs written before active_seconds existed', () => {
    // Null means "we genuinely do not know", so the old derivation stands rather
    // than resuming from a number that was never recorded.
    expect(resumeElapsedSeconds(null, startedAt, twoHoursLater)).toBe(7200)
    expect(resumeElapsedSeconds(undefined, startedAt, twoHoursLater)).toBe(7200)
  })

  it('treats a banked zero as a real value, not as missing', () => {
    // Paused within the first second. 0 is not null; resuming at two hours here
    // would be the exact bug this exists to prevent.
    expect(resumeElapsedSeconds(0, startedAt, twoHoursLater)).toBe(0)
  })

  it('never returns a negative or fractional number of seconds', () => {
    expect(resumeElapsedSeconds(-50, startedAt, twoHoursLater)).toBe(0)
    expect(resumeElapsedSeconds(90.7, startedAt, twoHoursLater)).toBe(90)
    // A clock that moved backwards must not produce negative elapsed.
    const earlier = new Date('2026-09-07T09:00:00Z')
    expect(resumeElapsedSeconds(null, startedAt, earlier)).toBe(0)
  })

  it('ignores a corrupt stored value rather than showing NaN', () => {
    expect(resumeElapsedSeconds(NaN, startedAt, twoHoursLater)).toBe(7200)
    expect(resumeElapsedSeconds(Infinity, startedAt, twoHoursLater)).toBe(7200)
  })
})
