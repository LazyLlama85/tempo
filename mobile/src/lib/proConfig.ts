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
//                    value (jsonb) = {
//                      "enabled": false,           // Pro system LIVE for everyone
//                      "test_user_ids": ["<uuid>"],// system live for just these (paywall testing)
//                      "pro_user_ids":  ["<uuid>"],// GRANTED Pro (unlocked, no purchase) — comps
//                      "tester_tools": false       // show the in-app Pro on/off switch (Profile →
//                                                  // Tester Tools) to beta testers; flip false at
//                                                  // public launch so the public never sees it
//                    }
//
// `pro_user_ids` is the comp/grant list: a way to hand a tester or reviewer the full
// unlocked experience without a real purchase — no App Store fee, works over-the-air.
// See supabase/add_app_config.sql.

import type { SupabaseClient } from '@supabase/supabase-js'

interface ProFlagValue {
  enabled?: boolean
  test_user_ids?: string[]
  pro_user_ids?: string[]
  tester_tools?: boolean
}

export interface ProConfigState {
  /** The Pro system is live for this user (they see the paywall + gates). */
  proEnabled: boolean
  /** This user is comped Pro (unlocked without paying). */
  proGranted: boolean
  /** This user may use the in-app Pro on/off switch (Profile → Tester Tools). */
  isTester: boolean
}

function inList(list: unknown, userId: string): boolean {
  return !!userId && Array.isArray(list) && (list as string[]).includes(userId)
}

/**
 * Resolve the remote Pro state for THIS user in one read. Global `enabled` flips the
 * system on for everyone; `test_user_ids` flips it on for just those accounts; a
 * granted account (`pro_user_ids`) is both live AND unlocked. Fails closed → dormant.
 */
export async function fetchProState(client: SupabaseClient, userId: string): Promise<ProConfigState> {
  try {
    const { data } = await client
      .from('app_config')
      .select('value')
      .eq('key', 'pro_enabled')
      .maybeSingle()
    const v = (data?.value ?? {}) as ProFlagValue
    const granted = inList(v.pro_user_ids, userId)
    const enabled = v.enabled === true || inList(v.test_user_ids, userId) || granted
    // Tester tools show for an explicit test/comp account, or for everyone while the
    // remote `tester_tools` flag is on (beta). NOT tied to the global `enabled` flag,
    // so turning Pro live for the public at launch does NOT expose the switch.
    const isTester = v.tester_tools === true || inList(v.test_user_ids, userId) || granted
    return { proEnabled: enabled, proGranted: granted, isTester }
  } catch {
    return { proEnabled: false, proGranted: false, isTester: false }
  }
}

/** Back-compat thin wrapper (still used where only the live flag matters). */
export async function fetchProEnabled(client: SupabaseClient, userId: string): Promise<boolean> {
  return (await fetchProState(client, userId)).proEnabled
}
