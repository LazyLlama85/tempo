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
import { ActivityIndicator, Animated, Easing, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { BlurView } from 'expo-blur'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme, useThemedStyles, useThemeStore, type Palette } from '@/theme'
import { useReducedMotion } from '@/components/motion'
import { useTutorialTarget } from '@/components/TutorialOverlay'
import { TARGET } from '@/lib/tutorial'
import { useSessionActiveStore } from '@/stores/sessionActive'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { GoChooserSheet } from '@/components/GoChooserSheet'
import type { ScheduledWorkout } from '@/lib/notifications'

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  // Register Progress / Profile as tutorial spotlight targets (others: null = no-op).
  const targetRef = useTutorialTarget(
    routeName === 'progress' ? TARGET.tabProgress : routeName === 'profile' ? TARGET.tabProfile : null,
  )

  return (
    <Pressable
      ref={targetRef}
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
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''

  // Today's schedule, just enough to decide where GO goes. A dedicated key (not
  // shared with Home's fuller query) so this stays correct even when Home isn't
  // mounted — e.g. GO tapped straight from Plan/Progress/Profile.
  const todayStr = toDateStr(new Date())
  const { data: todayRows, isLoading: todayLoading } = useQuery({
    queryKey: ['go_today_workouts', userId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_workouts')
        .select('id, status, planned_start_time, focus')
        .eq('user_id', userId)
        .eq('planned_date', todayStr)
        .order('planned_start_time')
      if (error) throw error
      return (data ?? []) as { id: string; status: string; planned_start_time: string; focus: string }[]
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  })

  // GO always offers a real choice now (see handlePress) — this holds today's
  // resolved state (due session's info, or just which empty state to show)
  // while the chooser sheet is open.
  const [chooser, setChooser] = useState<{ state: 'due' | 'complete' | 'none'; id: string | null; focus: string; time: string } | null>(null)

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

  const goRef = useTutorialTarget(TARGET.tabGo)

  // GO always opens the chooser now: continue today's session, or a Quick
  // Workout instead — with today's-plan shown greyed (and why) when there's
  // nothing to continue, rather than silently guessing a Quick Workout on the
  // user's behalf. (Previously fell straight into an auto-generated Quick
  // Workout with no picker when nothing was due — replaced per explicit
  // product direction: always show the real state, never silent magic.)
  const handlePress = () => {
    // An eager tap in the first instant after mount (or after switching users)
    // used to read todayRows as undefined -> [] -> "nothing due" before the
    // query resolved. Wait for the real answer instead of guessing wrong.
    if (todayLoading) return
    if (!userId) { router.push('/quick-workout'); return }
    const due = (todayRows ?? []).find(w => w.status === 'scheduled')
    if (due) {
      setChooser({ state: 'due', id: due.id, focus: due.focus, time: due.planned_start_time })
      return
    }
    const completed = (todayRows ?? []).some(w => w.status === 'completed')
    setChooser({ state: completed ? 'complete' : 'none', id: null, focus: '', time: '' })
  }

  return (
    <View ref={goRef} style={styles.goWrap}>
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
        onPress={handlePress}
        onPressIn={() => to(0.9)}
        onPressOut={() => to(1)}
        disabled={todayLoading}
        accessibilityRole="button"
        accessibilityLabel="Train now"
      >
        <Animated.View style={[styles.goBtn, { transform: [{ scale }] }, todayLoading && { opacity: 0.7 }]}>
          {todayLoading ? (
            <ActivityIndicator color={C.onPrimary} size="small" />
          ) : (
            <>
              <Ionicons name="flash" size={22} color={C.onPrimary} />
              <Text style={styles.goText} maxFontSizeMultiplier={1}>GO</Text>
            </>
          )}
        </Animated.View>
      </Pressable>

      <GoChooserSheet
        visible={!!chooser}
        todayState={chooser?.state ?? 'none'}
        focus={chooser?.focus ?? ''}
        time={chooser?.time ?? ''}
        onClose={() => setChooser(null)}
        onContinue={() => {
          const c = chooser
          setChooser(null)
          if (c?.id) router.push({ pathname: '/(tabs)/plan', params: { workoutId: c.id } })
        }}
        onQuick={() => {
          setChooser(null)
          router.push('/quick-workout')
        }}
      />
    </View>
  )
}

// ── Dock ──────────────────────────────────────────────────────────────────────

export function TempoTabBar({ state, descriptors, navigation }: TabBarProps) {
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const mode = useThemeStore(s => s.mode)
  const [keyboardUp, setKeyboardUp] = useState(false)
  // Quick Workout is a "only have a few minutes?" escape hatch, not an
  // alternative to the session you're already in the middle of — showing GO
  // mid-workout read as the app not knowing what you're doing.
  const sessionActive = useSessionActiveStore(s => s.active)
  const reduceMotion = useReducedMotion()
  // The center gap used to stay reserved at full width even with no button
  // sitting in it — a dead empty notch in the middle of the bar, which read
  // as broken rather than "no jump." Animating it closed instead means the
  // four tabs settle into an even bar with nothing left un-explained.
  const goSpacerWidth = useRef(new Animated.Value(sessionActive ? 0 : 68)).current
  useEffect(() => {
    const target = sessionActive ? 0 : 68
    if (reduceMotion) { goSpacerWidth.setValue(target); return }
    Animated.timing(goSpacerWidth, {
      toValue: target, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start()
  }, [sessionActive, reduceMotion, goSpacerWidth])

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
      <View style={styles.dockShadow}>
        <View style={styles.dockClip}>
          {/* iOS-only glass treatment: expo-blur's BlurView over a translucent
              tint, real UIVisualEffectView blur — not Apple's iOS-26-only
              UIGlassEffect API, but a genuine glass LOOK. Android keeps the
              existing opaque background: expo-blur's Android path needs a
              BlurTargetView + blurMethod wired to a specific host view, which
              can't be verified without a device on hand — scoped to the
              platform this was actually asked for and proven to just work. */}
          {Platform.OS === 'ios' && (
            <BlurView intensity={78} tint={mode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.dock}>
            {items.slice(0, 2)}
            <Animated.View style={[styles.goSpacer, { width: goSpacerWidth }]} />
            {items.slice(2)}
          </View>
        </View>
      </View>
      <View style={styles.goOverlay} pointerEvents={sessionActive ? 'none' : 'box-none'}>
        {!sessionActive && <GoButton />}
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
  // Shadow lives on its own outer view — RN clips box-shadow to nothing on a
  // sibling view that also has `overflow: 'hidden'` (needed below so the
  // blur/border respect the rounded corners), so the two can't be the same view.
  dockShadow: {
    alignSelf: 'stretch',
    borderRadius: 30,
    shadowColor: '#0B0D12',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  // Clips the BlurView + border to the pill shape. Opaque background on
  // Android (unchanged look); a translucent tint on iOS so the blur underneath
  // actually shows through.
  dockClip: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'ios' ? `${C.background}A6` : C.background,
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.xs,
    paddingTop: 10,
    paddingBottom: 8,
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
