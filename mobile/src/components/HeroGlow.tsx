// Tempo — HeroGlow.
//
// The "one rich moment per screen" glow: a soft, low-opacity accent blob that sits
// BEHIND a hero ring/metric to read premium without a native blur module (which we
// can't add — no spare build credits). It's just a big translucent circle over the
// dark ink surface, which reads as a glow. Static by design (calm, battery-friendly).
//
// Usage: make the parent `position: relative` (and usually `overflow: 'hidden'` so the
// glow is contained), drop <HeroGlow color={C.primaryGlow} /> as the FIRST child, then
// render the ring/number on top.

import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'

export function HeroGlow({
  color,
  size = 200,
  align = 'center',
  style,
}: {
  /** A `*Glow` palette token (low-opacity rgba), e.g. `C.primaryGlow`. */
  color: string
  /** Diameter of the soft blob. */
  size?: number
  /** Where the blob centers within the parent. */
  align?: 'center' | 'top' | 'topRight'
  style?: StyleProp<ViewStyle>
}) {
  const justify = align === 'top' || align === 'topRight' ? 'flex-start' : 'center'
  const items = align === 'topRight' ? 'flex-end' : 'center'
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: items, justifyContent: justify }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          marginTop: align === 'center' ? 0 : -size * 0.28,
          marginRight: align === 'topRight' ? -size * 0.22 : 0,
        }}
      />
    </View>
  )
}
