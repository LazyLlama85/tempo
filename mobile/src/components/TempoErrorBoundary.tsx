// Tempo — the app's last line of defense against a render crash.
//
// Before this existed, `Sentry.wrap` (crashReporting.ts) was the ONLY crash
// handling in the app — it REPORTS a render error to Sentry, but reporting is
// not catching: a thrown error during render still unmounts the whole tree,
// leaving a blank white screen with no way back short of force-quitting.
// This is a real React error boundary (getDerivedStateFromError/
// componentDidCatch are class-only, hence a class component here, not a
// hook) that catches exactly that case and shows a real screen instead.
//
// Deliberately minimal dependencies: the fallback must render even if
// something ELSE in the app is what broke, so it doesn't read from any
// query/store that could itself be the crash's cause. Theming is the one
// exception — it's foundational enough to trust, and a hardcoded-color
// crash screen would look broken even when the crash itself is handled fine.

import { Component, type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { captureException } from '@/lib/crashReporting'

interface FallbackProps {
  onReset: () => void
}

function ErrorFallback({ onReset }: FallbackProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  // This boundary sits inside expo-router's own root (which provides routing
  // context for the whole app, not just inside <Stack>), so useRouter is safe
  // to call unconditionally here — hooks must never be called inside a
  // try/catch (React's rules of hooks), so this is deliberately NOT guarded.
  const router = useRouter()
  const goHome = () => router.replace('/(tabs)')

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="alert-circle-outline" size={40} color={C.error} />
        </View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          Tempo hit a snag and couldn't show this screen. Your workouts and progress are safe —
          try again, or head back to Home.
        </Text>
        <View style={styles.actions}>
          <Text
            style={styles.primaryBtn}
            onPress={onReset}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            Try Again
          </Text>
          <Text
            style={styles.secondaryBtn}
            onPress={() => { onReset(); goHome() }}
            accessibilityRole="button"
            accessibilityLabel="Go to Home"
          >
            Go to Home
          </Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class TempoErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    captureException(error, { componentStack: info.componentStack ?? undefined, boundary: 'root' })
  }

  reset = () => this.setState({ hasError: false })

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.reset} />
    }
    return this.props.children
  }
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.dangerSoft, marginBottom: Spacing.sm,
  },
  title: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, textAlign: 'center', letterSpacing: -0.3 },
  body: {
    fontFamily: 'Inter_400Regular', fontSize: 14.5, color: C.textSecondary,
    textAlign: 'center', lineHeight: 21, maxWidth: 320,
  },
  actions: { marginTop: Spacing.md, alignItems: 'center', gap: Spacing.md },
  primaryBtn: {
    fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary,
    backgroundColor: C.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, overflow: 'hidden',
  },
  secondaryBtn: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary, padding: Spacing.xs },
})
