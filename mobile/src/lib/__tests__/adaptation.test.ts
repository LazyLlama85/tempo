// Regression coverage for MASTER_FIX_PLAN.md F6a — evaluateAdaptationMode used
// to count only source='plan' missed sessions, but checkMissedWorkouts
// (missedWorkouts.ts) marks BOTH plan rows (user_plan_id set) AND active-split
// rows (source='split') as missed. A user running their own custom split who
// missed every session for weeks never triggered recovery/deload at all —
// "the app adapts to you" silently didn't hold for split users.

import { createFakeSupabase } from './fakeSupabase'
import { evaluateAdaptationMode } from '@/lib/adaptation'

jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn() }))

const USER = 'user-1'

function missedRow(id: string, source: string, daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return {
    id, user_id: USER, status: 'missed', source,
    planned_date: `${d.getFullYear()}-${m}-${day}`,
  }
}

describe('evaluateAdaptationMode — split misses count too (F6a)', () => {
  it('a split-only user with 3+ recent misses triggers deload, not "normal"', async () => {
    const tables: Record<string, any[]> = {
      adaptation_events: [],
      scheduled_workouts: [
        missedRow('s1', 'split', 1),
        missedRow('s2', 'split', 3),
        missedRow('s3', 'split', 5),
      ],
    }
    const client = createFakeSupabase(tables)

    const mode = await evaluateAdaptationMode(client, USER)

    expect(mode).toBe('deload')
  })

  it('a split-only user with exactly 2 recent misses triggers recovery', async () => {
    const tables: Record<string, any[]> = {
      adaptation_events: [],
      scheduled_workouts: [
        missedRow('s1', 'split', 1),
        missedRow('s2', 'split', 4),
      ],
    }
    const client = createFakeSupabase(tables)

    expect(await evaluateAdaptationMode(client, USER)).toBe('recovery')
  })

  it('plan and split misses both contribute to the same count', async () => {
    const tables: Record<string, any[]> = {
      adaptation_events: [],
      scheduled_workouts: [
        missedRow('p1', 'plan', 1),
        missedRow('s1', 'split', 2),
        missedRow('p2', 'plan', 3),
      ],
    }
    const client = createFakeSupabase(tables)

    expect(await evaluateAdaptationMode(client, USER)).toBe('deload') // 3 combined
  })

  it('a quick/ad-hoc source never counts, even if somehow marked missed', async () => {
    const tables: Record<string, any[]> = {
      adaptation_events: [],
      scheduled_workouts: [
        missedRow('q1', 'quick', 1),
        missedRow('q2', 'quick', 2),
        missedRow('q3', 'quick', 3),
      ],
    }
    const client = createFakeSupabase(tables)

    expect(await evaluateAdaptationMode(client, USER)).toBe('normal')
  })
})
