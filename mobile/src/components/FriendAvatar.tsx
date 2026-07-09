// Tempo — avatar for OTHER users (friends, search results, share owners).
// Same rendering rules as the own-profile Avatar, but fed by an arbitrary
// avatar_url instead of the auth store.

import { View, Image, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { parseAvatar } from '@/lib/avatar'

export function FriendAvatar({ avatarUrl, size = 40 }: { avatarUrl: string | null | undefined; size?: number }) {
  const a = parseAvatar(avatarUrl)
  const radius = size / 2
  if (a.imageUri) {
    return <Image source={{ uri: a.imageUri }} style={{ width: size, height: size, borderRadius: radius }} />
  }
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: radius, backgroundColor: a.color }]}>
      <Ionicons name={a.icon as any} size={Math.round(size * 0.52)} color="#FFFFFF" />
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
})
