// Tempo — the Pro "remote flag" (dormant-launch control, audit §10).
//
// Pro ships code-complete but INERT: this reads one row from the `app_config` table
// on app open and decides whether the whole Pro system is live. Defaults hard to
// OFF — a missing table, missing row, or any error means dormant, so the public v1
// can ship free-only and Pro is turned on later with a single SQL update (no new
// build, no store resubmission). A per-account allow-list lets you (or a few beta
// testers) exercise the real paywall privately while it stays off for everyone else.
//
//   app_config row:  key = 'pro_enabled'
//                    value (jsonb) = { "enabled": false, "test_user_ids": ["<uuid>"] }
//
// See supabase/add_app_config.sql.

import type { SupabaseClient } from '@supabase/supabase-js'

interface ProFlagValue {
  enabled?: boolean
  test_user_ids?: string[]
}

/**
 * Whether the Pro system should be live for THIS user right now. Global `enabled`
 * flips it on for everyone; otherwise an allow-listed user id turns it on just for
 * them (private paywall testing). Fails closed → dormant.
 */
export async function fetchProEnabled(client: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data } = await client
      .from('app_config')
      .select('value')
      .eq('key', 'pro_enabled')
      .maybeSingle()
    const v = (data?.value ?? {}) as ProFlagValue
    if (v.enabled === true) return true
    if (userId && Array.isArray(v.test_user_ids) && v.test_user_ids.includes(userId)) return true
    return false
  } catch {
    return false
  }
}
