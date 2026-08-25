// Arclo — the pure half of moderation (App Store Guideline 1.2).
//
// Split out of lib/moderation.ts for the same reason lib/proPlans.ts was split
// out of lib/purchases.ts: moderation.ts imports crashReporting, which pulls in
// the Sentry native SDK, and the deterministic-core Jest suite (jest.config.js —
// "no React Native") cannot load that. Everything here is plain data and pure
// functions, so it is testable.
//
// These values are also a live drift risk: `ReportReason` and `ReportContext`
// mirror CHECK constraints in supabase/add_moderation_block_report.sql. If they
// fall out of step, `report_content` throws at the database and the user sees a
// failed report — which is precisely the failure Guideline 1.2 exists to
// prevent. The test file pins both lists.

/** Where the report was filed from. Mirrors the DB's `context` check constraint. */
export type ReportContext = 'profile' | 'feed' | 'group' | 'leaderboard'

/** Mirrors the DB's `reason` check constraint — keep the two in step. */
export type ReportReason =
  | 'harassment'
  | 'hate_speech'
  | 'sexual_content'
  | 'spam'
  | 'impersonation'
  | 'other'

/** Reasons in the order the picker shows them, with the label the user reads. */
export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'sexual_content', label: 'Sexual or explicit content' },
  { key: 'impersonation', label: 'Impersonation' },
  { key: 'spam', label: 'Spam or scam' },
  { key: 'other', label: 'Something else' },
]

/** Every context the DB will accept, for the same drift check. */
export const REPORT_CONTEXTS: ReportContext[] = ['profile', 'feed', 'group', 'leaderboard']

export interface BlockedUser {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  username: string | null
  created_at: string
}

/**
 * The label shown for a blocked or reported person. Falls back through the same
 * chain the social surfaces use, so a profile with no display name still reads
 * as something a human can recognise rather than a bare UUID.
 */
export function describeUser(u: Pick<BlockedUser, 'display_name' | 'username'>): string {
  if (u.display_name?.trim()) return u.display_name.trim()
  if (u.username?.trim()) return `@${u.username.trim()}`
  return 'This person'
}

/**
 * Normalise free-text report details to what the DB column accepts: trimmed,
 * capped at 1000 chars (`char_length(details) <= 1000`), and null rather than
 * empty so a blank box doesn't store a meaningless empty string.
 */
export function normalizeReportDetails(details: string | undefined | null): string | null {
  const t = (details ?? '').trim()
  if (!t) return null
  return t.slice(0, 1000)
}
