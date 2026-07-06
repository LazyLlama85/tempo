// Tempo — profile avatar.
//
// Single source of truth for the header "profile picture": the user's chosen
// icon + accent colour (or a real photo URL, if ever stored). Reads the live
// profile from the auth store so every header shows the same thing — no more
// default person icon on some screens.

import { View, Image, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '@/stores/auth'
import { parseAvatar } from '@/lib/avatar'

export function Avatar({ size = 32, iconSize }: { size?: number; iconSize?: number }) {
  const profile = useAuthStore((s) => s.profile)
  const a = parseAvatar(profile?.avatar_url)
  const radius = size / 2
  const icon = iconSize ?? Math.round(size * 0.52)

  if (a.imageUri) {
    return <Image source={{ uri: a.imageUri }} style={{ width: size, height: size, borderRadius: radius }} />
  }
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: radius, backgroundColor: a.color }]}>
      <Ionicons name={a.icon as any} size={icon} color="#FFFFFF" />
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
})
