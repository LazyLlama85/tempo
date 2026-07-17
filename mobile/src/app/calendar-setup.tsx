// Tempo — Calendar Setup (modal).
//
// Previously "connect a calendar" was an Alert.alert with a list of options (a
// system checklist that reads generic and caps at ~3 buttons on Android) and
// "disconnect" was a second, separate Alert. This is the same connect/disconnect
// logic (services/googleCalendar + services/calendarService), just given a real,
// branded screen — one clear place to see what's connected, connect something
// else, or disconnect. Reached from Profile → Settings → Calendar.

import { useCallback, useState } from 'react'
import { StyleSheet, TouchableOpacity, View, Text, Alert, ActivityIndicator, Linking } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { PressableScale } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import {
  connectGoogleCalendar, disconnectGoogleCalendar, isGoogleCalendarConnected,
  googleCalendarNeedsReconnect,
} from '@/services/googleCalendar/CalendarAuthService'
import { requestCalendarPermissions, getCalendarPermissionStatus } from '@/services/calendarService'
import { syncUpcomingWorkouts, purgeSyncedWorkouts } from '@/lib/calendarAutoSync'
import { trackCalendarConnected } from '@/lib/activation'
import { ProGate } from '@/components/ProGate'

function friendlyConnectError(code?: string): string {
  switch (code) {
    case 'cancelled': return 'Sign-in was cancelled.'
    case 'no_refresh_token': return 'Google didn’t grant offline access — allow Calendar permission and try again.'
    case 'store_failed': return 'Couldn’t reach the scheduling service. Please try again.'
    case 'not_signed_in': return 'Please sign in first, then connect your calendar.'
    case 'identity_taken': return 'That Google account already has its own Tempo login. To use it, sign out and sign back in with Google — or connect your Device Calendar instead.'
    case 'link_unavailable': return 'Google Calendar can’t be attached to this account yet — the device calendar works today.'
    case 'session_switched': return 'That Google account doesn’t match your Tempo account. Try again with the same account.'
    default: return code ? `Connection failed — ${code}` : 'Something went wrong connecting. Please try again.'
  }
}

export default function CalendarSetupScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const queryClient = useQueryClient()

  // Every path below writes calendar_event_id/calendar_provider or the whole
  // schedule out from under Home's already-mounted queries — without this,
  // the workout Home is showing keeps reading stale (empty) events until a
  // fresh query mount (force-quit), which looked like a broken/faded button.
  const invalidateCalendarData = () => {
    queryClient.invalidateQueries({ queryKey: ['range_events', userId] })
    queryClient.invalidateQueries({ queryKey: ['scheduled_workouts', userId] })
    queryClient.invalidateQueries({ queryKey: ['plan_cal_workouts', userId] })
  }

  const [googleConnected, setGoogleConnected] = useState(false)
  const [deviceStatus, setDeviceStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [busy, setBusy] = useState<null | 'google' | 'device' | 'disconnect-google' | 'disconnect-device'>(null)

  const refresh = useCallback(() => {
    getCalendarPermissionStatus().then(setDeviceStatus)
    isGoogleCalendarConnected().then(setGoogleConnected).catch(() => setGoogleConnected(false))
    setNeedsReconnect(googleCalendarNeedsReconnect())
  }, [])
  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  const setPreferredCalendar = async (provider: 'google' | 'device') => {
    if (!userId) return
    try {
      await supabase.from('user_profiles').update({ preferred_calendar: provider }).eq('user_id', userId)
      await refreshProfile()
    } catch { /* best-effort — the connection still works without the default set */ }
  }

  const handleConnectGoogle = async () => {
    if (busy) return
    setBusy('google')
    const r = await connectGoogleCalendar()
    setBusy(null)
    if (r.ok) {
      setGoogleConnected(true)
      setNeedsReconnect(false)
      trackCalendarConnected(userId, 'google')
      await setPreferredCalendar('google')
      invalidateCalendarData()
      syncUpcomingWorkouts(supabase, userId, { ...(profile as any), preferred_calendar: 'google' })
        .then(invalidateCalendarData)
        .catch(() => {})
      Alert.alert('Google Calendar connected', 'Tempo will schedule around it. Turn on “Add workouts to calendar” in Settings to also add your workouts to it.')
    } else {
      Alert.alert('Couldn’t connect', friendlyConnectError(r.error))
    }
  }

  const handleConnectDevice = async () => {
    if (busy) return
    if (deviceStatus === 'granted') { await setPreferredCalendar('device'); invalidateCalendarData(); return }
    setBusy('device')
    const granted = await requestCalendarPermissions()
    setBusy(null)
    setDeviceStatus(granted ? 'granted' : 'denied')
    if (granted) {
      trackCalendarConnected(userId, 'device')
      await setPreferredCalendar('device')
      invalidateCalendarData()
      syncUpcomingWorkouts(supabase, userId, { ...(profile as any), preferred_calendar: 'device' })
        .then(invalidateCalendarData)
        .catch(() => {})
      Alert.alert('Device Calendar connected', 'Tempo will schedule around it. Turn on “Add workouts to calendar” in Settings to also add your workouts to it.')
    } else {
      Alert.alert('Permission needed', 'Allow calendar access in Settings to use your device calendar.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    }
  }

  const handleDisconnectGoogle = () => {
    Alert.alert('Disconnect Google Calendar?', 'Tempo will stop reading it and adding your workouts to it. Events already added stay in Google.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive',
        onPress: async () => {
          setBusy('disconnect-google')
          try {
            await supabase.from('scheduled_workouts')
              .update({ calendar_event_id: null, calendar_provider: null })
              .eq('user_id', userId).eq('calendar_provider', 'google')
          } catch { /* best-effort */ }
          await disconnectGoogleCalendar()
          setGoogleConnected(false)
          setNeedsReconnect(false)
          if (profile?.preferred_calendar === 'google') {
            try {
              await supabase.from('user_profiles')
                .update({ preferred_calendar: deviceStatus === 'granted' ? 'device' : null })
                .eq('user_id', userId)
              await refreshProfile()
            } catch { /* best-effort */ }
          }
          setBusy(null)
          invalidateCalendarData()
          Alert.alert('Google Calendar disconnected', 'Tempo will no longer read your Google Calendar or add workouts to it.')
        },
      },
    ])
  }

  const handleStopDevice = () => {
    Alert.alert('Stop using Device Calendar?', 'Tempo will stop adding workouts to it. To fully revoke access, turn it off for Tempo in system Settings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop using it', style: 'destructive',
        onPress: async () => {
          setBusy('disconnect-device')
          try {
            await supabase.from('scheduled_workouts')
              .update({ calendar_event_id: null, calendar_provider: null })
              .eq('user_id', userId).eq('calendar_provider', 'device')
          } catch { /* best-effort */ }
          try {
            const patch: Record<string, unknown> = { calendar_autosync: false }
            if (profile?.preferred_calendar === 'device') patch.preferred_calendar = googleConnected ? 'google' : null
            await supabase.from('user_profiles').update(patch).eq('user_id', userId)
            await refreshProfile()
          } catch { /* best-effort */ }
          purgeSyncedWorkouts(supabase, userId).then(invalidateCalendarData).catch(() => {})
          setBusy(null)
          invalidateCalendarData()
          Alert.alert('Stopped', 'Tempo will no longer add workouts to your device calendar.', [
            { text: 'Done', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ])
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Calendar"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      <View style={styles.scroll}>
        <Text style={styles.subtitle}>
          Pick the calendar you actually use. Tempo reads it to schedule around your real life, and
          (when you turn it on in Settings) can add your workouts to it too.
        </Text>

        {needsReconnect && (
          <View style={styles.reconnectBanner}>
            <Ionicons name="warning" size={18} color={C.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reconnectTitle}>Google Calendar needs reconnecting</Text>
              <Text style={styles.reconnectBody}>Access expired, so your events stopped showing. Reconnect below to fix it.</Text>
            </View>
          </View>
        )}

        {/* Google Calendar */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIcon}><Ionicons name="calendar-outline" size={20} color="#EA4335" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Google Calendar</Text>
              <Text style={styles.cardSub}>{googleConnected ? 'Connected' : 'Not connected'}</Text>
            </View>
            {busy === 'google' || busy === 'disconnect-google' ? (
              <ActivityIndicator color={C.primary} />
            ) : googleConnected ? (
              <TouchableOpacity onPress={handleDisconnectGoogle} hitSlop={8}>
                <Text style={styles.disconnectText}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <PressableScale style={styles.connectBtn} onPress={handleConnectGoogle} disabled={!!busy}>
                <Text style={styles.connectBtnText}>Connect</Text>
              </PressableScale>
            )}
          </View>
          {googleConnected && (
            <>
              <View style={styles.divider} />
              <ProGate feature="multi_calendar" compact>
                <TouchableOpacity style={styles.subRow} onPress={() => router.push('/calendar-picker' as never)}>
                  <Text style={styles.subRowText}>Choose calendars</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
                </TouchableOpacity>
              </ProGate>
            </>
          )}
        </View>

        {/* Device Calendar */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIcon}><Ionicons name="calendar" size={20} color={C.text} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Device Calendar</Text>
              <Text style={styles.cardSub}>{deviceStatus === 'granted' ? 'Connected' : 'Not connected'}</Text>
            </View>
            {busy === 'device' || busy === 'disconnect-device' ? (
              <ActivityIndicator color={C.primary} />
            ) : deviceStatus === 'granted' ? (
              <TouchableOpacity onPress={handleStopDevice} hitSlop={8}>
                <Text style={styles.disconnectText}>Stop using</Text>
              </TouchableOpacity>
            ) : (
              <PressableScale style={styles.connectBtn} onPress={handleConnectDevice} disabled={!!busy}>
                <Text style={styles.connectBtnText}>Connect</Text>
              </PressableScale>
            )}
          </View>
        </View>

        <Text style={styles.hint}>
          Both work the same way — connect whichever you actually check. Tempo only reads busy
          times to plan around; your event details are never stored on our servers.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  headerTitle: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.md },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  reconnectBanner: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: C.dangerSoft, borderRadius: Radius.lg, padding: Spacing.md,
  },
  reconnectTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.error },
  reconnectBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.error, lineHeight: 18, marginTop: 1 },
  card: {
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    ...CardShadow, overflow: 'hidden',
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.outlineVariant },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  subRowText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  cardIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  connectBtn: { backgroundColor: C.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2 },
  connectBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.onPrimary },
  disconnectText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.error },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, lineHeight: 17 },
})
