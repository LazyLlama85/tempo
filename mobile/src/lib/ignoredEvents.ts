// Tempo — "ignore this event" for scheduling.
//
// Sometimes a calendar event isn't a real blocker: a tentative hold, a "FYI" invite,
// something the user knows they'll skip. This lets them cross it off so Tempo MAY
// place a workout over that time — without deleting anything from their calendar, and
// fully reversible (the event still shows, struck through, with an Undo).
//
// The tricky part: a single event has DIFFERENT ids across reads and providers
// (device vs Google), so an id is no anchor. What every read DOES agree on is the
// event's start+end. So we key an ignore on those times — a content key that the
// display layer (DayEvent) and the scheduler's busy slots (BusySlot) can both compute,
// which is what lets "ignore" in the UI actually free the slot in the scheduler.
//
// Degrades gracefully: if the ignored_events column hasn't been migrated yet
// (see supabase/add_ignored_events.sql), reads return an empty set and writes no-op.

import type { SupabaseClient } from '@supabase/supabase-js'

interface TimeSpan { start: Date; end: Date }

// Content key for an event: start+end rounded to the minute. Stable across reads and
// across calendar providers (which hand back different ids for the same meeting).
export function eventKey(start: Date, end: Date): string {
  return `${Math.round(start.getTime() / 60000)}-${Math.round(end.getTime() / 60000)}`
}

// The set of ignored event keys, or an empty set on any failure / missing column.
export async function getIgnoredEventKeys(client: SupabaseClient, userId: string): Promise<Set<string>> {
  try {
    const { data, error } = await client
      .from('user_profiles')
      .select('ignored_events')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data?.ignored_events) return new Set()
    return new Set((data.ignored_events as string[]).filter(k => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

// Toggle one event's ignored state, read-modify-writing the stored array. Returns the
// resulting set so callers can update UI without a refetch. No-ops on column-missing.
export async function setEventIgnored(
  client: SupabaseClient,
  userId: string,
  key: string,
  ignored: boolean,
): Promise<Set<string>> {
  const current = await getIgnoredEventKeys(client, userId)
  if (ignored) current.add(key)
  else current.delete(key)
  try {
    await client.from('user_profiles').update({ ignored_events: [...current] }).eq('user_id', userId)
  } catch {
    // best-effort — the column may not be migrated; UI still reflects the toggle
  }
  return current
}

// Drop any busy slots the user has marked "ignore", so the scheduler treats that time
// as free. Conservative: a slot is only removed on an EXACT start+end match, so a
// merged/overlapping busy block we can't positively identify stays blocking.
export function filterIgnoredBusy<T extends TimeSpan>(busy: T[], ignored: Set<string>): T[] {
  if (!ignored.size) return busy
  return busy.filter(b => !ignored.has(eventKey(b.start, b.end)))
}
