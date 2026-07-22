// Tempo — "Save your progress" sheet (§1.1).
//
// The single upgrade surface for guests, shared by the Profile card and the
// post-3rd-workout modal. Attaches Apple/Google onto the existing anonymous
// account (see lib/accountLinking) so weeks of history survive a reinstall or a
// new phone. Worded as account protection, not a feature upsell — and never a hard
// gate: the guest can dismiss and keep training.

import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Platform, ActivityIndicator, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TempoSheet } from '@/components/TempoSheet'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius } from '@/constants/theme'
import { useThemedStyles, useTheme, type Palette } from '@/theme'
import { linkGuestAccount, type LinkProvider, type LinkResult } from '@/lib/accountLinking'
import { track } from '@/lib/analytics'
import * as haptics from '@/lib/haptics'

type Context = 'profile' | 'post_workout'

interface SaveProgressSheetProps {
  visible: boolean
  onClose: () => void
  /** Where this was opened from — for analytics + copy tuning. */
  context: Context
  /** Fired once the guest is successfully upgraded to a permanent account. */
  onLinked?: () => void
}

// Friendly, actionable copy per failure reason. `cancelled` is silent (the user
// backed out of the browser on purpose — not an error to shout about).
const ERROR_COPY: Record<NonNullable<LinkResult['error']>, { title: string; message: string } | null> = {
  cancelled: null,
  already_permanent: null,
  not_signed_in: { title: 'Something went wrong', message: 'Please try again in a moment.' },
  link_unavailable: {
    title: 'Can’t save right now',
    message: 'Saving your progress to an account isn’t available at the moment. Your history is safe on this device — please try again later.',
  },
  identity_taken: {
    title: 'That account is already in use',
    message: 'This Apple or Google account is already linked to a different Tempo profile. Try the other sign-in option, or sign in with that account from the start screen (note: that starts fresh and won’t carry this guest history over).',
  },
  session_switched: { title: 'Couldn’t save safely', message: 'Sign-in switched accounts, so we stopped to protect your data. Please try again.' },
  exchange_failed: { title: 'Sign-in didn’t finish', message: 'Something went wrong completing sign-in. Please try again.' },
  oauth_failed: { title: 'Sign-in didn’t finish', message: 'Something went wrong completing sign-in. Please try again.' },
}

export function SaveProgressSheet({ visible, onClose, context, onLinked }: SaveProgressSheetProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [loading, setLoading] = useState<LinkProvider | null>(null)
  const [done, setDone] = useState(false)

  // Clear transient state once dismissed so a reopen never flashes a stale
  // success view or a spinner from a previous attempt.
  useEffect(() => {
    if (!visible) { setLoading(null); setDone(false) }
  }, [visible])

  const handleLink = async (provider: LinkProvider) => {
    if (loading) return
    setLoading(provider)
    track('guest_save_started', { method: provider, context })
    try {
      const res = await linkGuestAccount(provider)
      if (res.ok) {
        haptics.success()
        track('guest_upgraded', { method: provider, context })
        setDone(true)
        onLinked?.()
        // Let the success state land for a beat, then dismiss.
        setTimeout(onClose, 1400)
        return
      }
      const copy = res.error ? ERROR_COPY[res.error] : null
      if (copy) Alert.alert(copy.title, copy.message)
    } catch {
      Alert.alert('Sign-in didn’t finish', 'Something went wrong. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <TempoSheet visible={visible} onClose={onClose} scroll>
      <View style={styles.container}>
        {done ? (
          <View style={styles.doneBox}>
            <View style={styles.doneBadge}>
              <Ionicons name="checkmark" size={30} color={C.onPrimary} />
            </View>
            <Text style={styles.title}>Progress saved</Text>
            <Text style={styles.body}>Your history is now tied to your account — safe on any device you sign in on.</Text>
          </View>
        ) : (
          <>
            <View style={styles.iconWrap}>
              <Ionicons name="shield-checkmark" size={26} color={C.primary} />
            </View>
            <Text style={styles.title}>Save your progress</Text>
            <Text style={styles.body}>
              You’re training as a guest. Sign in so this history is never lost — even on a new phone.
            </Text>

            <View style={styles.actions}>
              {Platform.OS === 'ios' && (
                <PressableScale
                  style={[styles.btn, styles.appleBtn]}
                  onPress={() => handleLink('apple')}
                  disabled={loading !== null}
                  scaleTo={0.97}
                >
                  {loading === 'apple'
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <View style={styles.btnInner}>
                        <Ionicons name="logo-apple" size={20} color="#fff" style={{ marginTop: -1 }} />
                        <Text style={styles.appleBtnText}>Continue with Apple</Text>
                      </View>}
                </PressableScale>
              )}

              <PressableScale
                style={[styles.btn, styles.googleBtn]}
                onPress={() => handleLink('google')}
                disabled={loading !== null}
                scaleTo={0.97}
              >
                {loading === 'google'
                  ? <ActivityIndicator size="small" color={C.text} />
                  : <View style={styles.btnInner}>
                      <Ionicons name="logo-google" size={19} color="#4285F4" />
                      <Text style={styles.googleBtnText}>Continue with Google</Text>
                    </View>}
              </PressableScale>
            </View>

            <Text style={styles.reassure}>Keep training as a guest — you can save anytime from your profile.</Text>
          </>
        )}
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, alignItems: 'center' },
  iconWrap: {
    width: 56, height: 56, borderRadius: Radius.full, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
  title: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.4, textAlign: 'center' },
  body: {
    fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, textAlign: 'center',
    lineHeight: 22, marginTop: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.sm,
  },
  actions: { alignSelf: 'stretch', gap: Spacing.sm },
  btn: { height: 54, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appleBtn: { backgroundColor: '#000' },
  appleBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff', letterSpacing: 0.2 },
  googleBtn: { backgroundColor: C.background, borderWidth: 1, borderColor: C.outlineVariant },
  googleBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, letterSpacing: 0.2 },
  reassure: {
    fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.outline,
    textAlign: 'center', marginTop: Spacing.md,
  },
  doneBox: { alignItems: 'center', paddingVertical: Spacing.lg },
  doneBadge: {
    width: 64, height: 64, borderRadius: Radius.full, backgroundColor: C.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
})
