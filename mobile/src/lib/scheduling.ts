// Tempo — social scheduling data layer (Stage 4).
//
// Fetches coarse availability (mine + a friend's) via the privacy-gated
// friend_availability RPC, runs the shared-availability engine (lib/availability)
// to suggest common times, and sends/answers "train together" invites (accepting
// schedules the workout for both people). Backend: supabase/add_social_scheduling.sql.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  freeWindows, overlapWindows, suggestSharedSlots, upcomingDates, localNow,
  type AvailabilityInputs, type BusySlot, type SharedSlot,
} from './availability'

export interface WorkoutInvite {
  id: string
  direction: 'incoming' | 'outgoing'
  other_id: string
  display_name: string | null
  avatar_url: string | null
  username: string | null
  focus: string
  proposed_date: string
  proposed_start: string
  duration_min: number
  status: 'pending' | 'countered'
  counter_date: string | null
  counter_start: string | null
  created_at: string
}

interface Availability {
  av: AvailabilityInputs
  busy: BusySlot[]
  preferredTimeOfDay: string | null
}

/** Coarse availability for a user (self or a mutual friend). null if not permitted. */
export async function fetchAvailability(client: SupabaseClient, targetUserId: string, days = 14): Promise<Availability | null> {
  const { data } = await client.rpc('friend_availability', { target: targetUserId, p_days: days })
  if (!data) return null
  const d = data as Record<string, any>
  return {
    av: {
      wake_time: d.wake_time, bedtime: d.bedtime,
      work_start: d.work_start, work_end: d.work_end,
      school_start: d.school_start, school_end: d.school_end,
      training_days: d.training_days, unavailable_blocks: d.unavailable_blocks,
    },
    busy: ((d.busy ?? []) as Record<string, any>[]).map((b) => ({ date: b.date, start: b.start, duration_min: Number(b.duration_min) || 45 })),
    preferredTimeOfDay: d.preferred_time_of_day ?? null,
  }
}

/** Suggested times two friends could train together over the next `days`. */
export async function suggestSlotsWith(
  client: SupabaseClient,
  myUserId: string,
  friendId: string,
  durationMin: number,
  days = 14,
): Promise<{ slots: SharedSlot[]; availabilityShared: boolean }> {
  const [mine, theirs] = await Promise.all([
    fetchAvailability(client, myUserId, days),
    fetchAvailability(client, friendId, days),
  ])
  // theirs === null means they haven't shared availability with us.
  if (!theirs) return { slots: [], availabilityShared: false }
  if (!mine) return { slots: [], availabilityShared: true }
  const { todayStr, nowMin } = localNow(new Date())
  const dates = upcomingDates(todayStr, days)
  const opts = { todayStr, nowMin }
  const myFree = freeWindows(mine.av, mine.busy, dates, opts)
  const theirFree = freeWindows(theirs.av, theirs.busy, dates, opts)
  const overlaps = overlapWindows(myFree, theirFree, durationMin)
  const slots = suggestSharedSlots(overlaps, durationMin, { preferredTimeOfDay: mine.preferredTimeOfDay, maxTotal: 6 })
  return { slots, availabilityShared: true }
}

export async function sendWorkoutInvite(
  client: SupabaseClient,
  toUserId: string,
  focus: string,
  date: string,
  startTime: string,
  durationMin: number,
): Promise<boolean> {
  const { data, error } = await client.rpc('send_workout_invite', {
    p_to: toUserId, p_focus: focus, p_date: date, p_start: startTime, p_duration: durationMin,
  })
  return !error && !!data
}

export async function respondWorkoutInvite(
  client: SupabaseClient,
  inviteId: string,
  action: 'accept' | 'decline' | 'counter',
  counterDate?: string,
  counterStart?: string,
): Promise<boolean> {
  const { data } = await client.rpc('respond_workout_invite', {
    p_invite: inviteId, p_action: action, p_counter_date: counterDate ?? null, p_counter_start: counterStart ?? null,
  })
  return !!data
}

export async function listWorkoutInvites(client: SupabaseClient): Promise<WorkoutInvite[]> {
  const { data } = await client.rpc('list_workout_invites')
  return (data ?? []) as WorkoutInvite[]
}
