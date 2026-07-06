// Tempo — the floating tab dock.
//
// Replaces the stock bottom bar with a piece of the brand: a floating,
// warm-surfaced dock with four tabs and a raised amber GO button in the
// center — the "train now" action, always one thumb away. Active tabs get a
// springy icon pop and an amber tick; the Progress tab's icon is the Tempo
// pulse mark itself. Hides while the keyboard is up so it never covers inputs.
//
// Implementation notes: driven entirely by JS Animated on focus changes (no
// entering animations, nothing can strand hidden), and typed structurally so it
// doesn't depend on @react-navigation packages that expo-router vendors.

import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { useReducedMotion } from '@/components/motion'

type IoniconsName = keyof typeof Ionicons.glyphMap

// Structural subset of React Navigation's BottomTabBarProps — just what we use.
export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] }
  descriptors: Record<string, { options: { title?: string; tabBarAccessibilityLabel?: string } }>
  navigation: {
    navigate: (name: string, params?: object) => void
    emit: (e: { type: string; target?: string; canPreventDefault?: boolean }) => { defaultPrevented: boolean }
  }
}

const TAB_META: Record<string, { icon: IoniconsName; iconActive: IoniconsName }> = {
  index: { icon: 'calendar-outline', iconActive: 'calendar' },
  plan: { icon: 'barbell-outline', iconActive: 'barbell' },
  progress: { icon: 'pulse-outline', iconActive: 'pulse' },
  profile: { icon: 'person-outline', iconActive: 'person' },
}

// ── Single tab item ───────────────────────────────────────────────────────────

function TabItem({
  label, routeName, focused, onPress,
}: { label: string; routeName: string; focused: boolean; onPress: () => void }) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const reduce = useReducedMotion()
  const scale = useRef(new Animated.Value(1)).current
  const tick = useRef(new Animated.Value(focused ? 1 : 0)).current

  useEffect(() => {
    if (reduce) {
      scale.setValue(1)
      tick.setValue(focused ? 1 : 0)
      return
    }
    const anims: Animated.CompositeAnimation[] = [
      Animated.spring(tick, { toValue: focused ? 1 : 0, friction: 6, tension: 160, useNativeDriver: true }),
    ]
    if (focused) {
      anims.push(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
        ]),
      )
    }
    const anim = Animated.parallel(anims)
    anim.start()
    return () => anim.stop()
  }, [focused, reduce, scale, tick])

  const meta = TAB_META[routeName] ?? TAB_META.index
  const color = focused ? C.primary : C.outline

  return (
    <Pressable
      onPress={onPress}
      style={styles.item}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      hitSlop={6}
    >
      {/* Custom pulse-bar icon for Progress; Ionicons elsewhere */}
      <Animated.View style={{ transform: [{ scale }] }}>
        {routeName === 'progress' ? (
          <View style={styles.pulseIcon}>
            {[0.5, 1, 0.68, 0.85].map((h, i) => (
              <View key={i} style={[styles.pulseIconBar, { height: 16 * h, backgroundColor: color }]} />
            ))}
          </View>
        ) : (
          <Ionicons name={focused ? meta.iconActive : meta.icon} size={23} color={color} />
        )}
      </Animated.View>
      <Text style={[styles.itemLabel, { color }]} maxFontSizeMultiplier={1.2}>{label}</Text>
      <Animated.View
        style={[
          styles.itemTick,
          { backgroundColor: C.primary, opacity: tick, transform: [{ scale: tick }] },
        ]}
      />
    </Pressable>
  )
}

// ── GO button ─────────────────────────────────────────────────────────────────

function GoButton() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const reduce = useReducedMotion()
  const scale = useRef(new Animated.Value(1)).current
  const halo = useRef(new Animated.Value(0)).current

  // A slow breathing halo — the dock keeps time even at rest.
  useEffect(() => {
    if (reduce) { halo.setValue(0); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduce, halo])

  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start()

  return (
    <View style={styles.goWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.goHalo,
          {
            opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.25] }) }],
          },
        ]}
      />
      <Pressable
        onPress={() => router.push('/quick-workout')}
        onPressIn={() => to(0.9)}
        onPressOut={() => to(1)}
        accessibilityRole="button"
        accessibilityLabel="Train now — start a quick workout"
      >
        <Animated.View style={[styles.goBtn, { transform: [{ scale }] }]}>
          <Ionicons name="flash" size={22} color={C.onPrimary} />
          <Text style={styles.goText} maxFontSizeMultiplier={1}>GO</Text>
        </Animated.View>
      </Pressable>
    </View>
  )
}

// ── Dock ──────────────────────────────────────────────────────────────────────

export function TempoTabBar({ state, descriptors, navigation }: TabBarProps) {
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const [keyboardUp, setKeyboardUp] = useState(false)

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const s = Keyboard.addListener(showEvt, () => setKeyboardUp(true))
    const h = Keyboard.addListener(hideEvt, () => setKeyboardUp(false))
    return () => { s.remove(); h.remove() }
  }, [])

  if (keyboardUp) return null

  const items = state.routes.map((route, index) => {
    const { options } = descriptors[route.key]
    const label = options.title ?? route.name
    const focused = state.index === index
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name)
      }
    }
    return <TabItem key={route.key} label={label} routeName={route.name} focused={focused} onPress={onPress} />
  })

  return (
    // The wrap is padded above the dock so the raised GO button stays inside
    // every ancestor's bounds — RN drops touches outside them, and a half-dead
    // button is exactly the kind of jank this bar exists to kill.
    <View style={[styles.dockWrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={styles.dock}>
        {items.slice(0, 2)}
        <View style={styles.goSpacer} />
        {items.slice(2)}
      </View>
      <View style={styles.goOverlay} pointerEvents="box-none">
        <GoButton />
      </View>
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  dockWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: 30,           // headroom for the raised GO button (touch bounds)
    alignItems: 'center',
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: C.background,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.xs,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: '#0B0D12',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  item: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  itemLabel: { fontFamily: 'Inter_700Bold', fontSize: 10.5, letterSpacing: 0.2 },
  itemTick: { width: 4, height: 4, borderRadius: 2 },
  pulseIcon: { height: 23, flexDirection: 'row', alignItems: 'center', gap: 2.5 },
  pulseIconBar: { width: 3.2, borderRadius: 1.6 },

  goSpacer: { width: 68 },
  goOverlay: {
    position: 'absolute',
    left: 0, right: 0, top: 6,
    alignItems: 'center',
  },
  goWrap: { alignItems: 'center', justifyContent: 'center' },
  goHalo: {
    position: 'absolute',
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: C.primary,
  },
  goBtn: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3,
    borderColor: C.surface,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  goText: { fontFamily: C.fontDisplay, fontSize: 10, color: C.onPrimary, letterSpacing: 1, marginTop: -2 },
})
