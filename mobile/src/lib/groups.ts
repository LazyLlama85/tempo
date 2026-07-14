// Tempo — private groups data layer (social upgrade Stage 3).
//
// A group is a named circle you join by invite code; each has the same three
// leaderboards as friends, scoped to its members (group_leaderboard RPC reuses the
// friends_leaderboard_v2 shape). Backend: supabase/add_social_groups.sql.

import type { SupabaseClient } from '@supabase/supabase-js'
import { mapLeaderboardV2Rows, type LeaderboardV2Row } from './social'

export interface GroupSummary {
  id: string
  name: string
  invite_code: string
  owner_id: string
  member_count: number
}

export async function listMyGroups(client: SupabaseClient): Promise<GroupSummary[]> {
  const { data } = await client.rpc('list_my_groups')
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    invite_code: String(r.invite_code ?? ''),
    owner_id: String(r.owner_id ?? ''),
    member_count: Number(r.member_count) || 0,
  }))
}

/** Create a group (caller becomes owner + first member). Returns it, or null. */
export async function createGroup(client: SupabaseClient, name: string): Promise<GroupSummary | null> {
  const { data, error } = await client.rpc('create_group', { p_name: name.trim() })
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row?.id) return null
  return { id: String(row.id), name: String(row.name ?? name), invite_code: String(row.invite_code ?? ''), owner_id: '', member_count: 1 }
}

/** Join by invite code. Returns the group id (idempotent) or null if not found. */
export async function joinGroup(client: SupabaseClient, code: string): Promise<string | null> {
  const { data } = await client.rpc('join_group', { p_code: code.trim() })
  return (data as string | null) ?? null
}

/** Leave a group. If you're the owner, the group is deleted for everyone. */
export async function leaveGroup(client: SupabaseClient, groupId: string): Promise<boolean> {
  const { error } = await client.rpc('leave_group', { p_group: groupId })
  return !error
}

export async function fetchGroupLeaderboard(client: SupabaseClient, groupId: string): Promise<LeaderboardV2Row[]> {
  const { data } = await client.rpc('group_leaderboard', { p_group: groupId })
  return mapLeaderboardV2Rows((data ?? []) as Record<string, unknown>[])
}
