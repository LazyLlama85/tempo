// The plan's slot filler must also build from what the user knows.
//
// Quick Workout and the plan generator are two separate selection engines, and
// wiring familiarity into one is no evidence about the other. This covers the
// plan side directly: `selectForSlots` is the function that turns a session
// template into a list of exercise ids.
//
// The tension being tested is the one that broke the first attempt at this. The
// filler rotates its scan start by `rotation` for week-to-week variety; applied
// naively that rotation steps straight past a lift the user knows onto one they
// have never done, so the variety knob silently undoes the familiarity one.

// generatePlan pulls in calendarSync -> expo-calendar, a native module ts-jest's
// Node config can't transform. Neutralised the same way generatePlan.test.ts and
// splitSchedule.test.ts already do, for the same reason.
jest.mock('@/services/calendarSync', () => ({
  removeWorkoutFromCalendar: jest.fn().mockResolvedValue(undefined),
  addWorkoutToCalendar: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/notifications', () => ({
  cancelWorkoutReminder: jest.fn().mockResolvedValue(undefined),
  scheduleWorkoutReminders: jest.fn().mockResolvedValue(undefined),
  hasReminderPermission: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/services/googleCalendar/CalendarAuthService', () => ({
  isGoogleCalendarConnected: jest.fn().mockResolvedValue(false),
  getGoogleAccessToken: jest.fn().mockResolvedValue(null),
  invalidateGoogleAccessToken: jest.fn(),
}))
jest.mock('@/services/calendarService', () => ({
  getBusyBlocks: jest.fn().mockResolvedValue([]),
  getCalendarPermissionStatus: jest.fn().mockResolvedValue('denied'),
}))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { selectForSlots, type ExRow, type SessionTemplate } from '@/lib/generatePlan'
import { buildFamiliarity, NO_HISTORY, MIN_KNOWN_FOR_NOVELTY } from '@/lib/exerciseFamiliarity'

function row(id: string, name: string, pattern: string, primary: string[]): ExRow {
  return {
    id, name, movement_pattern: pattern,
    experience_level: 'beginner', required_equipment: ['full_gym'],
    primary_muscles: primary, secondary_muscles: [], is_core: true, popularity: 50,
  }
}

// Four interchangeable squats and four hinges. Same equipment, same popularity,
// same everything — so familiarity is the only thing that can order them.
const SQUATS = ['a', 'b', 'c', 'd'].map(k => row(`squat-${k}`, `Squat ${k.toUpperCase()}`, 'squat', ['quads']))
const HINGES = ['a', 'b', 'c', 'd'].map(k => row(`hinge-${k}`, `Deadlift ${k.toUpperCase()}`, 'hinge', ['hamstrings']))

const bySlot = { squat: SQUATS, hinge: HINGES }

// A four-slot session, which is the shortest that can spare a slot for novelty.
// One known and one unknown option per pool, across four different patterns, so
// families never collide and each slot has a real choice.
const FOUR_POOLS = {
  squat: [row('sq-known', 'Barbell Back Squat', 'squat', ['quads']), row('sq-new', 'Hack Squat Machine', 'squat', ['quads'])],
  hinge: [row('hi-known', 'Conventional Deadlift', 'hinge', ['hamstrings']), row('hi-new', 'Trap Bar Deadlift', 'hinge', ['hamstrings'])],
  h_push: [row('pu-known', 'Barbell Bench Press', 'push', ['chest']), row('pu-new', 'Machine Chest Press', 'push', ['chest'])],
  h_pull: [row('pl-known', 'Barbell Bent-Over Row', 'pull', ['lats']), row('pl-new', 'Machine Seated Row', 'pull', ['lats'])],
}
const FOUR_KNOWN = ['sq-known', 'hi-known', 'pu-known', 'pl-known']
const FOUR_SLOT_TEMPLATE: SessionTemplate = {
  focus: 'Full Body',
  slots: [
    { slots: ['squat'], tier: 'primary' },
    { slots: ['hinge'], tier: 'secondary' },
    { slots: ['h_push'], tier: 'accessory' },
    { slots: ['h_pull'], tier: 'accessory' },
  ],
}

const TEMPLATE: SessionTemplate = {
  focus: 'Legs',
  slots: [
    { slots: ['squat'], tier: 'primary' },
    { slots: ['hinge'], tier: 'secondary' },
  ],
}

/** History in which `ids` have each been trained once, plus `extra` filler lifts. */
function famWith(ids: string[], extra = 0) {
  const rows = ids.map((id, i) => ({ exercise_id: id, workout_log_id: `log-${i}` }))
  for (let i = 0; i < extra; i++) {
    rows.push({ exercise_id: `filler-${i}`, workout_log_id: `flog-${i}` })
  }
  return buildFamiliarity(rows)
}

describe('selectForSlots and familiarity', () => {
  it('picks the squat the user knows, at every rotation', () => {
    // Rotation is what previously defeated familiarity: at some rotations the
    // scan simply started on an unknown lift and took it. Every rotation must
    // now land on the one known squat.
    const fam = famWith(['squat-c', 'hinge-b'])
    for (let rotation = 0; rotation < 8; rotation++) {
      const ids = selectForSlots(bySlot, TEMPLATE, rotation, 2, fam)
      expect(ids).toContain('squat-c')
      expect(ids).toContain('hinge-b')
    }
  })

  it('still rotates among familiar lifts when several are known', () => {
    // Familiarity must not collapse the plan into the same session every week.
    const fam = famWith(['squat-a', 'squat-b', 'squat-c', 'squat-d'])
    const picked = new Set<string>()
    for (let rotation = 0; rotation < 8; rotation++) {
      picked.add(selectForSlots(bySlot, TEMPLATE, rotation, 2, fam)[0])
    }
    expect(picked.size).toBeGreaterThan(1)
    for (const id of picked) expect(id.startsWith('squat-')).toBe(true)
  })

  it('falls back to an unfamiliar lift rather than leaving a slot empty', () => {
    // The user knows exactly one squat and no hinge. The hinge slot must still
    // be filled — a half-empty session is worse than an unfamiliar exercise.
    const fam = famWith(['squat-a'])
    const ids = selectForSlots(bySlot, TEMPLATE, 0, 2, fam)
    expect(ids[0]).toBe('squat-a')
    expect(ids).toHaveLength(2)
    expect(ids[1].startsWith('hinge-')).toBe(true)
  })

  it('is a pure no-op for a user with no history', () => {
    // Whatever the old engine picked, it still picks — familiarity ties every
    // candidate, so the original popularity/equipment ordering decides.
    for (let rotation = 0; rotation < 6; rotation++) {
      const withFam = selectForSlots(bySlot, TEMPLATE, rotation, 2, NO_HISTORY)
      const withoutArg = selectForSlots(bySlot, TEMPLATE, rotation, 2)
      expect(withFam).toEqual(withoutArg)
    }
  })

  it('spends the last slot on something new for an experienced user', () => {
    // The novelty slot only exists in a session long enough to spare one
    // (MIN_PICKS_FOR_NOVELTY), so this uses a four-slot template. The user knows
    // the first option in every pool, and enough distinct lifts overall to clear
    // MIN_KNOWN_FOR_NOVELTY.
    const fam = famWith(FOUR_KNOWN, MIN_KNOWN_FOR_NOVELTY)
    const ids = selectForSlots(FOUR_POOLS, FOUR_SLOT_TEMPLATE, 0, 4, fam)

    expect(ids).toHaveLength(4)
    // Everything up to the last slot is a movement they have trained.
    for (const id of ids.slice(0, 3)) expect(FOUR_KNOWN).toContain(id)
    // The last one is deliberately something they have not.
    expect(FOUR_KNOWN).not.toContain(ids[3])
  })

  it('does not spend a novelty slot on a user still building a base', () => {
    const fam = famWith(FOUR_KNOWN) // 4 distinct — below MIN_KNOWN_FOR_NOVELTY
    const ids = selectForSlots(FOUR_POOLS, FOUR_SLOT_TEMPLATE, 0, 4, fam)
    for (const id of ids) expect(FOUR_KNOWN).toContain(id)
  })

  it('does not spend a novelty slot on a session too short to spare one', () => {
    const fam = famWith(FOUR_KNOWN, MIN_KNOWN_FOR_NOVELTY)
    const ids = selectForSlots(bySlot, TEMPLATE, 0, 2, famWith(['squat-a', 'hinge-a'], MIN_KNOWN_FOR_NOVELTY))
    expect(ids).toEqual(['squat-a', 'hinge-a'])
    expect(fam.known).toBeGreaterThanOrEqual(MIN_KNOWN_FOR_NOVELTY)
  })
})
