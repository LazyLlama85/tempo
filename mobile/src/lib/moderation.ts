// Arclo — blocking and reporting (App Store Guideline 1.2).
//
// The app declares user-generated content in its age rating, correctly: both
// usernames and group names are free text authored by one person and shown to
// others. Guideline 1.2 requires an app with UGC to give users a way to report
// offensive content and a way to block abusive users. This module is the client
// half of that; the enforcing half is in the database
// (`supabase/add_moderation_block_report.sql`).
//
// Everything here goes through an RPC rather than a table write, because the
// filtering that makes a block real lives inside SECURITY DEFINER functions —
// filtering in the client would hide the content without actually withholding
// it. `block_user` also tears down any existing friendship server-side, so the
// two can never drift apart.
//
// The pure data (reason list, label helper, detail normalisation) lives in
// lib/moderationReasons.ts so it can be unit-tested; this file is the I/O and is
// re-exported from there so call sites only ever import '@/lib/moderation'.

import type { SupabaseClient } from '@supabase/supabase-js'
import { captureApiError } from '@/lib/crashReporting'
import { normalizeReportDetails, type ReportContext, type ReportReason, type BlockedUser } from '@/lib/moderationReasons'

export {
  REPORT_REASONS,
  REPORT_CONTEXTS,
  describeUser,
  normalizeReportDetails,
} from '@/lib/moderationReasons'
export type { ReportContext, ReportReason, BlockedUser } from '@/lib/moderationReasons'

/**
 * Block someone. Hiding is symmetric — neither party sees the other afterwards —
 * and any friendship or pending request between them is removed, so the block
 * cannot be walked around by re-requesting.
 */
export async function blockUser(client: SupabaseClient, targetUserId: string): Promise<boolean> {
  const { data, error } = await client.rpc('block_user', { target: targetUserId })
  if (error) {
    captureApiError('moderation.blockUser', error)
    return false
  }
  return data === true
}

export async function unblockUser(client: SupabaseClient, targetUserId: string): Promise<boolean> {
  const { data, error } = await client.rpc('unblock_user', { target: targetUserId })
  if (error) {
    captureApiError('moderation.unblockUser', error)
    return false
  }
  return data === true
}

/** Everyone the signed-in user has blocked, newest first. Powers the unblock UI. */
export async function listBlockedUsers(client: SupabaseClient): Promise<BlockedUser[]> {
  const { data, error } = await client.rpc('list_blocked_users')
  if (error) {
    captureApiError('moderation.listBlockedUsers', error)
    return []
  }
  return (data ?? []) as BlockedUser[]
}

/**
 * File a report. A failure surfaces to the caller as `false` so it can offer a
 * retry rather than dropping it silently — "I reported this and nothing
 * happened" is the exact complaint Guideline 1.2 exists to prevent.
 */
export async function reportUser(
  client: SupabaseClient,
  targetUserId: string,
  context: ReportContext,
  reason: ReportReason,
  details?: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('report_content', {
    target: targetUserId,
    p_context: context,
    p_reason: reason,
    p_details: normalizeReportDetails(details),
  })
  if (error) {
    captureApiError('moderation.reportUser', error)
    return false
  }
  return data === true
}
