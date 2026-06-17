import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, ActivityIndicator, Platform, Alert } from 'react-native'
import { Redirect } from 'expo-router'
import { makeRedirectUri } from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { Colors, Spacing, Radius } from '@/constants/theme'

WebBrowser.maybeCompleteAuthSession()

const C = Colors.light

export default function SignInScreen() {
  const { session } = useAuthStore()
  const [loading, setLoading] = useState<'google' | 'guest' | null>(null)

  if (session) return <Redirect href="/" />

  const handleGoogleSignIn = async () => {
    setLoading('google')
    const redirectUrl = makeRedirectUri({ scheme: 'tempo' })
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl, skipBrowserRedirect: true, queryParams: { access_type: 'offline', prompt: 'consent' } },
    })
    if (error || !data?.url) { setLoading(null); return }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl)

    if (result.type === 'success') {
      const parsed = new URL(result.url)

      // PKCE flow (Supabase default): code arrives as a query param
      const code = parsed.searchParams.get('code')
      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
        setLoading(null)
        return
      }

      // Implicit flow fallback: tokens arrive in the URL hash
      const hash = new URLSearchParams(parsed.hash.slice(1))
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
    }

    setLoading(null)
  }

  const handleGuest = async () => {
    setLoading('guest')
    await supabase.auth.signInAnonymously()
    setLoading(null)
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Logo area */}
      <View style={styles.logoArea}>
        <View style={styles.logoBox}>
          <Text style={styles.logoLetter}>T</Text>
          <View style={styles.pulseDot} />
        </View>
      </View>

      {/* Hero text */}
      <View style={styles.hero}>
        <Text style={styles.wordmark}>Tempo</Text>
        <Text style={styles.tagline}>
          Precision fitness scheduling for{'\n'}your peak performance.
        </Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {/* Apple button */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
          style={styles.appleButton}
          activeOpacity={0.85}
          disabled={loading !== null}
          onPress={() => Alert.alert('Apple Sign In', 'Apple Sign In is coming soon.')}
        >
            <Text style={styles.appleIcon}>  </Text>
            <Text style={styles.appleButtonText}>SIGN IN WITH APPLE</Text>
          </TouchableOpacity>
        )}

        {/* Google button */}
        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleSignIn}
          activeOpacity={0.85}
          disabled={loading !== null}
        >
          {loading === 'google'
            ? <ActivityIndicator size="small" color={C.text} />
            : <Text style={styles.googleButtonText}>G  SIGN IN WITH GOOGLE</Text>
          }
        </TouchableOpacity>

        {/* Guest */}
        <TouchableOpacity onPress={handleGuest} disabled={loading !== null} activeOpacity={0.6}>
          <Text style={styles.guestText}>
            {loading === 'guest' ? 'Loading...' : 'Continue as guest'}
          </Text>
        </TouchableOpacity>

        {/* Legal */}
        <Text style={styles.legal}>
          By continuing, you agree to Tempo's{' '}
          <Text style={styles.legalLink}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.legalLink}>Privacy Policy</Text>
          .
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.surface,
    paddingHorizontal: Spacing.containerPadding,
    justifyContent: 'space-between',
    paddingBottom: Spacing.xl,
  },
  logoArea: {
    alignItems: 'center',
    paddingTop: Spacing['2xl'],
  },
  logoBox: {
    width: 72,
    height: 72,
    backgroundColor: C.primary,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0058BC',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 8,
  },
  pulseDot: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 9,
    height: 9,
    borderRadius: 9,
    backgroundColor: '#22C55E',
  },
  logoLetter: {
    fontSize: 40,
    fontFamily: 'Inter_800ExtraBold',
    color: '#FFFFFF',
    lineHeight: 48,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  wordmark: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 40,
    lineHeight: 48,
    color: C.text,
    letterSpacing: -0.8,
  },
  tagline: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    color: C.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.sm,
  },
  appleButton: {
    height: 56,
    backgroundColor: C.text,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  appleIcon: {
    color: C.surface,
    fontSize: 18,
  },
  appleButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.surface,
    letterSpacing: 0.5,
  },
  googleButton: {
    height: 56,
    backgroundColor: C.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: C.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: C.text,
    letterSpacing: 0.5,
  },
  guestText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: Spacing.xs,
  },
  legal: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.outline,
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: {
    color: C.primary,
    textDecorationLine: 'underline',
  },
})
