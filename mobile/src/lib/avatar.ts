// Tempo — profile avatar + header accent.
// The "profile picture" defaults to a chosen icon + accent colour, stored in
// user_profiles.avatar_url as a sentinel ("tempo:<icon>:<hex>") — but a real photo
// can replace it: uploadAvatar() puts the file in the public `avatars` Storage
// bucket (see supabase/add_avatar_storage.sql) and stores its public URL in that
// same column. parseAvatar() already renders any http(s) URL found there as an
// image, so no schema change was needed for real photos either.

import * as ImagePicker from 'expo-image-picker'
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureApiError } from '@/lib/crashReporting'

const AVATAR_BUCKET = 'avatars'

export interface AvatarPreset {
  id: string
  icon: string // Ionicons name
  color: string
}

// Sentinel id for "the uploaded photo is the active avatar" in any screen's avatar
// picker grid (onboarding, Edit Profile) — never a real preset id, so `avatarId ===
// CUSTOM_AVATAR_ID` is an unambiguous check for which tile should show selected.
export const CUSTOM_AVATAR_ID = 'custom'

// Curated set — distinct, athletic, all legible on white text.
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'bolt', icon: 'flash', color: '#0058BC' },
  { id: 'barbell', icon: 'barbell', color: '#1F6F3D' },
  { id: 'flame', icon: 'flame', color: '#C2410C' },
  { id: 'bolt2', icon: 'thunderstorm', color: '#6D28D9' },
  { id: 'rocket', icon: 'rocket', color: '#B91C1C' },
  { id: 'trophy', icon: 'trophy', color: '#B8860B' },
  { id: 'pulse', icon: 'pulse', color: '#0E7490' },
  { id: 'paw', icon: 'paw', color: '#374151' },
]

export interface AvatarStyle {
  icon: string
  color: string
  imageUri: string | null
}

const DEFAULT: AvatarStyle = { icon: 'person', color: '#0058BC', imageUri: null }

export function parseAvatar(avatarUrl: string | null | undefined): AvatarStyle {
  if (!avatarUrl) return DEFAULT
  if (avatarUrl.startsWith('http')) return { ...DEFAULT, imageUri: avatarUrl }
  if (avatarUrl.startsWith('tempo:')) {
    const [, icon, color] = avatarUrl.split(':')
    if (icon && color) return { icon, color, imageUri: null }
  }
  return DEFAULT
}

export function buildAvatarValue(icon: string, color: string): string {
  return `tempo:${icon}:${color}`
}

export type AvatarUploadResult =
  | { status: 'ok'; url: string }
  | { status: 'cancelled' | 'denied' | 'error' }

/**
 * Let the user pick a photo, upload it to their public avatar folder, and return
 * its public URL — ready to store directly in user_profiles.avatar_url.
 * `denied` when library permission is refused, `cancelled` when they back out.
 */
export async function uploadAvatar(client: SupabaseClient, userId: string): Promise<AvatarUploadResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return { status: 'denied' }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1],
    })
    if (res.canceled || !res.assets?.length) return { status: 'cancelled' }

    const asset = res.assets[0]
    const ext = (asset.uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase()
    const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`
    // Fixed filename per user (not timestamped) — a re-upload just overwrites the
    // old photo rather than accumulating orphaned files in the bucket forever.
    const path = `${userId}/avatar.${ext}`

    const bytes = await fetch(asset.uri).then((r) => r.arrayBuffer())
    const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType, upsert: true })
    if (error) throw error

    const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path)
    // Cache-bust: same path, so an updated photo won't be served stale from the
    // image cache (expo-image keys on the URL string).
    return { status: 'ok', url: `${data.publicUrl}?v=${Date.now()}` }
  } catch (e) {
    captureApiError('uploadAvatar', e)
    return { status: 'error' }
  }
}
