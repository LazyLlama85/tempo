// Guards the client/database drift that would make "Report" fail at the moment
// a user needs it. REPORT_REASONS and REPORT_CONTEXTS mirror CHECK constraints
// in supabase/add_moderation_block_report.sql; if someone adds a reason to the
// picker without adding it to the constraint, report_content throws and the
// report is lost. These lists are copied from the applied migration.

import {
  REPORT_REASONS,
  REPORT_CONTEXTS,
  describeUser,
  normalizeReportDetails,
} from '@/lib/moderationReasons'

// Verbatim from the applied migration's CHECK constraints.
const DB_REASONS = ['harassment', 'hate_speech', 'sexual_content', 'spam', 'impersonation', 'other']
const DB_CONTEXTS = ['profile', 'feed', 'group', 'leaderboard']

describe('report reasons stay in step with the database', () => {
  it('every reason the picker offers is accepted by the DB constraint', () => {
    for (const r of REPORT_REASONS) expect(DB_REASONS).toContain(r.key)
  })

  it('covers every reason the DB allows, so none is unreachable', () => {
    expect(REPORT_REASONS.map((r) => r.key).sort()).toEqual([...DB_REASONS].sort())
  })

  it('every context is accepted by the DB constraint', () => {
    expect([...REPORT_CONTEXTS].sort()).toEqual([...DB_CONTEXTS].sort())
  })

  it('gives every reason a human label and no duplicate keys', () => {
    const keys = REPORT_REASONS.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of REPORT_REASONS) expect(r.label.trim().length).toBeGreaterThan(0)
  })
})

describe('describeUser', () => {
  it('prefers the display name', () => {
    expect(describeUser({ display_name: 'Sam Ray', username: 'samr' })).toBe('Sam Ray')
  })

  it('falls back to an @handle', () => {
    expect(describeUser({ display_name: null, username: 'samr' })).toBe('@samr')
  })

  it('never renders a blank or whitespace name', () => {
    expect(describeUser({ display_name: '   ', username: '  ' })).toBe('This person')
    expect(describeUser({ display_name: null, username: null })).toBe('This person')
  })
})

describe('normalizeReportDetails', () => {
  it('returns null for nothing, so a blank box is not stored as an empty string', () => {
    expect(normalizeReportDetails(undefined)).toBeNull()
    expect(normalizeReportDetails(null)).toBeNull()
    expect(normalizeReportDetails('   ')).toBeNull()
  })

  it('trims', () => {
    expect(normalizeReportDetails('  they keep messaging me  ')).toBe('they keep messaging me')
  })

  it('caps at the 1000 chars the column accepts', () => {
    const long = 'x'.repeat(5000)
    expect(normalizeReportDetails(long)!.length).toBe(1000)
  })
})
