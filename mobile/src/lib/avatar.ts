// Tempo — profile avatar + header accent.
// We don't have image-upload storage yet, so the "profile picture" is a chosen
// icon + accent colour. It's stored in the existing user_profiles.avatar_url
// text column as a sentinel ("tempo:<icon>:<hex>") so no migration is needed —
// and if a real photo URL is ever stored there instead, we render it as an image.

export interface AvatarPreset {
  id: string
  icon: string // Ionicons name
  color: string
}

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
