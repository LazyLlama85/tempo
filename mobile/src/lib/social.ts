// Tempo — social data layer: friends, privacy, friend workouts, sharing.
//
// Backend contract lives in supabase/add_social.sql (applied). Discovery and
// friend stats go through SECURITY DEFINER RPCs so user_profiles RLS stays
// owner-only; friend template browsing rides an RLS policy gated on the owner's
// privacy_workouts. Shares are snapshots under a short code — the link is the
// capability.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkoutExerciseConfig, WorkoutTemplate } from '@/types'
import { sessionStreak } from './streak'

export type PrivacyLevel = 'public' | 'friends' | 'private'

export interface SocialProfile {
  user_id: string
  display_name: string | null
  avatar_url: string | null
}

export interface FriendEntry extends SocialProfile {
  friendshipId: string
  /** 'friend' = accepted; 'incoming' / 'outgoing' = pending request. */
  state: 'friend' | 'incoming' | 'outgoing'
}

export interface FriendOverview {
  display_name: string | null
  avatar_url: string | null
  stats_visible: boolean
  activity_visible: boolean
  total_workouts?: number
  total_sets?: number
  streak?: number
  recent?: { focus: string; date: string }[]
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export async function searchProfiles(client: SupabaseClient, query: string): Promise<SocialProfile[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const { data } = await client.rpc('search_profiles', { q })
  return (data ?? []) as SocialProfile[]
}

// ── Friendships ───────────────────────────────────────────────────────────────

export async function fetchFriends(client: SupabaseClient, userId: string): Promise<FriendEntry[]> {
  const { data } = await client
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
  const rows = (data ?? []) as { id: string; requester_id: string; addressee_id: string; status: string }[]
  if (!rows.length) return []

  const otherIds = rows.map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id))
  const { data: profiles } = await client.rpc('get_public_profiles', { ids: otherIds })
  const byId = new Map(((profiles ?? []) as SocialProfile[]).map((p) => [p.user_id, p]))

  return rows.map((r) => {
    const otherId = r.requester_id === userId ? r.addressee_id : r.requester_id
    const p = byId.get(otherId)
    return {
      friendshipId: r.id,
      user_id: otherId,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      state: r.status === 'accepted' ? 'friend' : r.requester_id === userId ? 'outgoing' : 'incoming',
    }
  })
}

export async function sendFriendRequest(client: SupabaseClient, userId: string, toUserId: string): Promise<boolean> {
  const { error } = await client.from('friendships').insert({ requester_id: userId, addressee_id: toUserId })
  return !error
}

export async function acceptFriendRequest(client: SupabaseClient, friendshipId: string): Promise<boolean> {
  const { error } = await client
    .from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId)
  return !error
}

/** Decline an incoming request, cancel an outgoing one, or unfriend. */
export async function removeFriendship(client: SupabaseClient, friendshipId: string): Promise<boolean> {
  const { error } = await client.from('friendships').delete().eq('id', friendshipId)
  return !error
}

// ── Friend profile + workouts ─────────────────────────────────────────────────

export async function fetchFriendOverview(client: SupabaseClient, targetUserId: string): Promise<FriendOverview | null> {
  const { data } = await client.rpc('friend_overview', { target: targetUserId })
  if (!data) return null
  const raw = data as FriendOverview & { sessions?: { planned_date: string; status: string }[] }
  const todayStr = new Date().toISOString().slice(0, 10)
  return {
    ...raw,
    streak: raw.sessions ? sessionStreak(raw.sessions, todayStr) : undefined,
  }
}

/** Templates the viewer is allowed to see (RLS enforces the owner's privacy). */
export async function fetchFriendTemplates(client: SupabaseClient, ownerId: string): Promise<WorkoutTemplate[]> {
  const { data } = await client
    .from('workout_templates')
    .select('*')
    .eq('user_id', ownerId)
    .order('updated_at', { ascending: false })
  return (data ?? []) as WorkoutTemplate[]
}

/**
 * Copy someone else's template into the viewer's library with attribution —
 * "Push (Jacob's)". The copy is fully owned by the viewer; edits never touch
 * the original. Custom exercises the viewer can't read are dropped.
 */
export async function copyTemplateToLibrary(
  client: SupabaseClient,
  userId: string,
  template: WorkoutTemplate,
  ownerName: string | null,
): Promise<string | null> {
  const readable = await readableExerciseIds(client, template.exercise_ids)
  const ids = template.exercise_ids.filter((id) => readable.has(id))
  if (!ids.length) return null
  const config = (template.config ?? []).filter((c) => readable.has(c.exercise_id))
  const name = ownerName ? `${template.name} (${possessive(ownerName)})` : template.name
  const { data, error } = await client
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: name.slice(0, 60),
      exercise_ids: ids,
      config,
      notes: ownerName ? `Shared by ${ownerName}` : null,
      est_duration_min: template.est_duration_min,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  return error ? null : (data?.id ?? null)
}

// ── Privacy ───────────────────────────────────────────────────────────────────

export interface PrivacyPrefs {
  privacy_workouts: PrivacyLevel
  privacy_stats: PrivacyLevel
  privacy_activity: PrivacyLevel
}

export async function fetchPrivacy(client: SupabaseClient, userId: string): Promise<PrivacyPrefs> {
  const { data } = await client
    .from('user_profiles')
    .select('privacy_workouts, privacy_stats, privacy_activity')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    privacy_workouts: (data?.privacy_workouts as PrivacyLevel) ?? 'friends',
    privacy_stats: (data?.privacy_stats as PrivacyLevel) ?? 'friends',
    privacy_activity: (data?.privacy_activity as PrivacyLevel) ?? 'friends',
  }
}

export async function updatePrivacy(client: SupabaseClient, userId: string, patch: Partial<PrivacyPrefs>): Promise<boolean> {
  const { error } = await client.from('user_profiles').update(patch).eq('user_id', userId)
  return !error
}

// ── Sharing ───────────────────────────────────────────────────────────────────

export interface WorkoutShare {
  id: string
  code: string
  owner_id: string
  owner_name: string | null
  name: string
  exercises: { id: string; name: string }[]
  config: WorkoutExerciseConfig[]
  est_duration_min: number
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no 0/O/1/l/i lookalikes

function makeShareCode(): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return out
}

export function shareUrl(code: string): string {
  return `https://tempo.app/w/${code}`
}

/** Snapshot a template into a share row; returns the share (with code). */
export async function createWorkoutShare(
  client: SupabaseClient,
  userId: string,
  ownerName: string | null,
  template: WorkoutTemplate,
): Promise<WorkoutShare | null> {
  // Snapshot names so the preview renders even for exercises the viewer can't read.
  const { data: exRows } = template.exercise_ids.length
    ? await client.from('exercises').select('id, name').in('id', template.exercise_ids)
    : { data: [] }
  const byId = new Map(((exRows ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]))
  const exercises = template.exercise_ids.map((id) => ({ id, name: byId.get(id) ?? 'Exercise' }))

  // Retry once on the (astronomically unlikely) code collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await client
      .from('workout_shares')
      .insert({
        code: makeShareCode(),
        owner_id: userId,
        owner_name: ownerName,
        name: template.name,
        exercises,
        config: template.config ?? [],
        est_duration_min: template.est_duration_min,
      })
      .select('*')
      .single()
    if (!error && data) return data as WorkoutShare
    if (error && !`${error.message}`.includes('duplicate')) return null
  }
  return null
}

export async function fetchWorkoutShare(client: SupabaseClient, code: string): Promise<WorkoutShare | null> {
  const { data } = await client
    .from('workout_shares')
    .select('*')
    .eq('code', code.trim().toLowerCase())
    .maybeSingle()
  return (data as WorkoutShare) ?? null
}

/** Import a shared workout into the viewer's library, with attribution. */
export async function importWorkoutShare(
  client: SupabaseClient,
  userId: string,
  share: WorkoutShare,
): Promise<{ id: string | null; dropped: number }> {
  const allIds = share.exercises.map((e) => e.id)
  const readable = await readableExerciseIds(client, allIds)
  const ids = allIds.filter((id) => readable.has(id))
  if (!ids.length) return { id: null, dropped: allIds.length }
  const config = (share.config ?? []).filter((c) => readable.has(c.exercise_id))
  const name = share.owner_name ? `${share.name} (${possessive(share.owner_name)})` : share.name
  const { data, error } = await client
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: name.slice(0, 60),
      exercise_ids: ids,
      config,
      notes: share.owner_name ? `Shared by ${share.owner_name}` : null,
      est_duration_min: share.est_duration_min,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  return { id: error ? null : (data?.id ?? null), dropped: allIds.length - ids.length }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readableExerciseIds(client: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data } = await client.from('exercises').select('id').in('id', ids)
  return new Set(((data ?? []) as { id: string }[]).map((e) => e.id))
}

/** "Jacob" → "Jacob's", "Chris" → "Chris'". First name only, keeps labels short. */
export function possessive(name: string): string {
  const first = name.trim().split(/\s+/)[0] || name.trim()
  return first.endsWith('s') || first.endsWith('S') ? `${first}'` : `${first}'s`
}
