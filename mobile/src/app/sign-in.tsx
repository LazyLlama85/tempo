import { useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, Image, ActivityIndicator, Platform, Alert } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { makeRedirectUri } from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import * as AppleAuthentication from 'expo-apple-authentication'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { describeSaveError } from '@/lib/saveErrors'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, useThemeMode, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { TempoLottie } from '@/components/TempoLottie'

WebBrowser.maybeCompleteAuthSession()


export default function SignInScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { mode } = useThemeMode()
  const { session } = useAuthStore()
  const [loading, setLoading] = useState<'google' | 'apple' | 'guest' | null>(null)

  if (session) return <Redirect href="/" />

  const handleGoogleSignIn = async () => {
    if (loading) return
    setLoading('google')
    try {
      const redirectUrl = makeRedirectUri({ scheme: 'tempo' })
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true, queryParams: { access_type: 'offline', prompt: 'consent' } },
      })
      if (error || !data?.url) {
        Alert.alert('Couldn’t reach Google', describeSaveError(error, 'reach Google').message)
        return
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl)
      if (result.type !== 'success') return // user closed the browser — not an error

      const parsed = new URL(result.url)

      // PKCE flow (Supabase default): code arrives as a query param
      const code = parsed.searchParams.get('code')
      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeErr) Alert.alert('Sign-in didn’t finish', 'Something went wrong completing sign-in. Please try again.')
        return
      }

      // Implicit flow fallback: tokens arrive in the URL hash
      const hash = new URLSearchParams(parsed.hash.slice(1))
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
    } catch (err) {
      Alert.alert('Sign-in didn’t finish', describeSaveError(err, 'finish sign-in').message)
    } finally {
      setLoading(null)
    }
  }

  const handleAppleSignIn = async () => {
    try {
      setLoading('apple')
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })

      if (credential.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        })
        if (error) throw error
      }
    } catch (error: any) {
      if (error.code !== 'ERR_CANCELED') {
        Alert.alert('Apple Sign In Error', error.message)
      }
    } finally {
      setLoading(null)
    }
  }

  const handleGuest = async () => {
    if (loading) return
    setLoading('guest')
    try {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) Alert.alert('Couldn’t start guest session', describeSaveError(error, 'start a guest session').message)
    } catch (err) {
      Alert.alert('Couldn’t start guest session', describeSaveError(err, 'start a guest session').message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Logo + Tempo Coach + wordmark, grouped and vertically centered in the
          space above the buttons — was 3 separate top-level children spread
          apart by the container's own `space-between`, which read as three
          giant dead gaps (founder screenshot). Grouping them means that
          space-between only sees this group and `actions` now, and centering
          within the group brings the logo/coach down out of the empty area
          at the very top instead of pinning them there. */}
      <View style={styles.topGroup}>
        {/* Logo area — the static logo mark, untouched. */}
        <View style={styles.logoArea}>
          <Image
            source={require('@/assets/images/tempo-logo.png')}
            style={styles.logoImage}
            accessibilityLabel="Tempo logo"
          />
        </View>

        {/* Tempo Coach (the same blue runner from the app icon, traced into a
            real vector Lottie from the founder's reference sheet — see
            assets/lottie/README.md) waves hello in the gap between the logo
            and the wordmark. Purely additive: a failed/missing animation just
            leaves that gap empty, never a broken or missing logo/wordmark
            (TempoLottie's own onAnimationFailure guard). */}
        <TempoLottie source={require('@/assets/lottie/coach/wave.json')} width={68} height={100} style={styles.coachWave} />

        {/* Hero text */}
        <View style={styles.hero}>
          <View style={{ alignItems: 'center' }}>
            <TempoWordmark size={40} mark={false} />
          </View>
          {/* The one true sentence (audit §03/§22): a first-time visitor should know
              in 5 seconds why this isn't just another workout logger — Tempo fits
              training into your real week and moves it when life does. */}
          <Text style={styles.tagline}>
            Training that fits your real week{'\n'}— and moves when life does.
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {/* Apple — official button (adapts to theme; Apple logo + label built in) */}
        {Platform.OS === 'ios' && (
          loading === 'apple' ? (
            <View style={styles.appleLoading}>
              <ActivityIndicator size="small" color={mode === 'dark' ? '#000' : '#fff'} />
            </View>
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                mode === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={Radius.lg}
              style={styles.appleButton}
              onPress={handleAppleSignIn}
            />
          )
        )}

        {/* Google — custom button with the Google mark */}
        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleSignIn}
          activeOpacity={0.85}
          disabled={loading !== null}
        >
          {loading === 'google'
            ? <ActivityIndicator size="small" color={C.text} />
            : <View style={styles.googleInner}>
                <Ionicons name="logo-google" size={19} color="#4285F4" />
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
              </View>
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
          <Text style={styles.legalLink} onPress={() => router.push('/legal')}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.legalLink} onPress={() => router.push('/legal')}>Privacy Policy</Text>
          .
        </Text>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.surface,
    paddingHorizontal: Spacing.containerPadding,
    justifyContent: 'space-between',
    paddingBottom: Spacing.xl,
  },
  topGroup: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  logoArea: {
    alignItems: 'center',
    marginTop: -Spacing.xl,
    marginBottom: Spacing.md,
  },
  coachWave: {
    alignSelf: 'center',
    marginTop: Spacing.md,
  },
  logoImage: {
    width: 88,
    height: 88,
    borderRadius: Radius.lg,
    shadowColor: '#3D82F7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  wordmark: {
    fontFamily: C.fontDisplay,
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
    width: '100%',
  },
  appleLoading: {
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: C.text,
    alignItems: 'center',
    justifyContent: 'center',
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
  googleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  googleButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: C.text,
    letterSpacing: 0.2,
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
