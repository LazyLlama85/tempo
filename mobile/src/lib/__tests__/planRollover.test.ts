import {
  PLAN_RUNWAY_DAYS, formatLocalDate, planNeedsExtension, planExtensionWeeks,
} from '@/lib/planRollover'
import { weekProgression, BLOCK_WEEKS } from '@/lib/periodization'

// Regression coverage for the "4-week plan cliff": a generated plan once ran out
// with no regeneration, silently leaving a user with an empty schedule. These lock
// the exact decision logic `extendActivePlan` relies on (audit §4.2 / §11.2).

describe('planRollover — formatting & runway', () => {
  it('formats a local calendar day, never UTC-shifted', () => {
    expect(formatLocalDate(new Date(2026, 6, 3))).toBe('2026-07-03') // month is 0-based
    expect(formatLocalDate(new Date(2026, 11, 25))).toBe('2026-12-25')
  })

  it('rolls over when the last session is within the runway (incl. already past)', () => {
    const today = new Date('2026-07-26T12:00:00')
    // Day ~25 of a 28-day block: the last session is 2 days out → refill now.
    expect(planNeedsExtension('2026-07-28', today)).toBe(true)
    // A past-due last session (user was away) also needs a refill.
    expect(planNeedsExtension('2026-07-20', today)).toBe(true)
    // Plenty of runway left → no-op.
    expect(planNeedsExtension('2026-08-20', today)).toBe(false)
  })

  it('exposes a 7-day runway constant', () => {
    expect(PLAN_RUNWAY_DAYS).toBe(7)
  })
})

describe('planRollover — the three cliff-bug assertions', () => {
  it('(a) horizon never drops below 7 days after an app-open late in a block', () => {
    // Simulated app-open at day ~25 of the first (4-week) block.
    const today = new Date('2026-07-26T12:00:00')
    expect(planNeedsExtension('2026-07-28', today)).toBe(true) // rollover fires

    const { weekCount } = planExtensionWeeks({ lastWeek: BLOCK_WEEKS - 1, weeksSinceStart: 3 })
    // A full block is generated → at least 28 days of runway, comfortably > 7.
    expect(weekCount).toBeGreaterThanOrEqual(BLOCK_WEEKS)
    expect(weekCount * 7).toBeGreaterThanOrEqual(PLAN_RUNWAY_DAYS)
  })

  it('(b) the mesocycle wave produces exactly one deload every 4 weeks', () => {
    const { weekFrom, weekCount } = planExtensionWeeks({ lastWeek: BLOCK_WEEKS - 1, weeksSinceStart: 3 })
    const generated = Array.from({ length: weekCount }, (_, i) =>
      weekProgression(weekFrom + i, 'intermediate', 'normal'),
    )
    // Over the newly generated 4-week block, exactly one deload.
    expect(generated.filter(w => w.isDeload)).toHaveLength(1)
  })

  it('(c) rollover never duplicates or drops a week_index', () => {
    const lastWeek = BLOCK_WEEKS - 1 // 3 — end of the first block
    const { weekFrom, weekCount } = planExtensionWeeks({ lastWeek, weeksSinceStart: 3 })
    const indices = Array.from({ length: weekCount }, (_, i) => weekFrom + i)

    // Continues immediately after the last week — no re-emitted or skipped index.
    expect(weekFrom).toBe(lastWeek + 1)
    expect(Math.min(...indices)).toBeGreaterThan(lastWeek)
    // Strictly contiguous and unique.
    expect(new Set(indices).size).toBe(indices.length)
    indices.forEach((w, i) => { if (i > 0) expect(w).toBe(indices[i - 1] + 1) })
  })
})

describe('planRollover — long absence', () => {
  it('generates enough weeks to bridge a multi-week gap and still land a fresh block', () => {
    const lastWeek = BLOCK_WEEKS - 1
    const weeksSinceStart = 20 // user away for months
    const { weekFrom, weekCount } = planExtensionWeeks({ lastWeek, weeksSinceStart })
    const lastGenerated = weekFrom + weekCount - 1
    // Reaches past "now" (weeksSinceStart) plus most of a block ahead of it.
    expect(lastGenerated).toBeGreaterThanOrEqual(weeksSinceStart + BLOCK_WEEKS - 1)
    expect(weekCount).toBeGreaterThan(BLOCK_WEEKS)
  })

  it('a fresh block at a block boundary still generates a full block, not zero', () => {
    const { weekCount } = planExtensionWeeks({ lastWeek: BLOCK_WEEKS - 1, weeksSinceStart: 3 })
    expect(weekCount).toBe(BLOCK_WEEKS)
  })
})
