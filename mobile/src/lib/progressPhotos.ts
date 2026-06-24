// Progress photos for body measurements.
//
// Optional metadata on a measurement entry: a private photo stored in the
// `progress-photos` Supabase Storage bucket (per-user RLS — see
// supabase/add_progress_photos_storage.sql). We store only the object path on the
// measurement row; the image bytes live in Storage and are fetched via short-lived
// signed URLs so nothing is ever public.

import * as ImagePicker from 'expo-image-picker'
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureApiError } from '@/lib/crashReporting'

const BUCKET = 'progress-photos'

export type PhotoResult =
  | { status: 'ok'; path: string }
  | { status: 'cancelled' | 'denied' | 'error' }

/**
 * Let the user pick a photo and upload it to their private folder. Returns the
 * stored object path on success. `denied` when library permission is refused,
 * `cancelled` when they back out — both are non-errors the caller can ignore.
 */
export async function pickAndUploadProgressPhoto(
  client: SupabaseClient,
  userId: string,
): Promise<PhotoResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return { status: 'denied' }

    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 })
    if (res.canceled || !res.assets?.length) return { status: 'cancelled' }

    const asset = res.assets[0]
    const ext = (asset.uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase()
    const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`
    const path = `${userId}/${Date.now()}.${ext}`

    // Expo's fetch can read a file:// uri into an ArrayBuffer for the upload.
    const bytes = await fetch(asset.uri).then((r) => r.arrayBuffer())
    const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
    if (error) throw error

    return { status: 'ok', path }
  } catch (e) {
    captureApiError('pickAndUploadProgressPhoto', e)
    return { status: 'error' }
  }
}

/** A short-lived signed URL for displaying a stored progress photo. */
export async function progressPhotoUrl(
  client: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null
  try {
    const { data } = await client.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
