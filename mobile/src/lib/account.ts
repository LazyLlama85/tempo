// Tempo — account lifecycle (App Store-required deletion).
//
// Apple Guideline 5.1.1(v): an app that lets users create an account must let them
// delete it — and all associated data — from within the app. This calls the
// `delete-account` Edge Function (service role), which removes the auth user and
// cascade-deletes every owned row server-side. The caller is responsible for
// clearing the local session afterwards (see stores/auth signOut).

import type { SupabaseClient } from '@supabase/supabase-js'

export type DeleteAccountResult = { ok: true } | { ok: false; error: string }

// Permanently delete the signed-in user's account. Returns a typed result rather
// than throwing so the UI can show a clear message and keep the user signed in on
// failure (so nothing is half-deleted from their perspective).
export async function deleteAccount(client: SupabaseClient): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await client.functions.invoke('delete-account', { body: {} })
    if (error) return { ok: false, error: error.message }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      return { ok: false, error: String((data as { error: unknown }).error) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown_error' }
  }
}
