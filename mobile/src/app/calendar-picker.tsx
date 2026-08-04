// Tempo — Choose Calendars (modal, B1.5 multi-calendar).
//
// Lets a user pick which Google calendars (beyond primary) Tempo also reads
// busy-time from. The calendar.calendarlist.readonly OAuth scope
// (services/googleCalendar/config.ts) was added 2026-07-18, but a Google
// refresh token's granted scopes are fixed at consent time — nothing server-side
// can broaden an already-connected user's token. So fetchCalendarList() 403s
// with an insufficient-scope error for EVERY user who connected Google before
// that date, which in practice is everyone (verified against prod: 0 of 3
// connected tokens carry the new scope as of 2026-08-04). Rather than dead-end
// on that error, this screen offers a one-tap reconnect (connectGoogleCalendar()
// forces prompt=consent, which re-grants the full current scope list) and
// retries automatically on success.
// Reached from Calendar Setup → Google card → "Choose calendars" (Pro-gated).

import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, View, Text, ActivityIndicator, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles } from '@/theme'
import { PressableScale } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { fetchCalendarList, getLastCalendarReadError, type GoogleCalendarListEntry } from '@/services/googleCalendar/CalendarApiService'
import { GCAL_PRIMARY } from '@/services/googleCalendar/config'
import { connectGoogleCalendar } from '@/services/googleCalendar/CalendarAuthService'
import { friendlyConnectError } from '@/services/googleCalendar/connectErrors'

function isScopeError(reason?: string): boolean {
  return !!reason && /scope|insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)
}

function friendlyListError(reason?: string): string {
  if (isScopeError(reason)) {
    return `${BRAND_NAME} needs you to reconnect Google Calendar once to turn on multi-calendar — it only reads your primary calendar until then.`
  }
  return 'Couldn’t load your calendars right now.'
}

export default function CalendarPickerScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session, profile, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const queryClient = useQueryClient()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(
    new Set(profile?.selected_google_calendar_ids ?? [])
  )
  const [saving, setSaving] = useState(false)

  // Guards every setState in load() below — shared by the mount-time fetch AND
  // the reconnect retry, so neither can write state after the screen unmounts
  // (e.g. the user backs out mid-OAuth-flow).
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchCalendarList()
      .then(list => {
        if (!mountedRef.current) return
        setCalendars(list); setError(null); setNeedsReconnect(false)
      })
      .catch(() => {
        if (!mountedRef.current) return
        const reason = getLastCalendarReadError()?.reason
        setError(friendlyListError(reason))
        setNeedsReconnect(isScopeError(reason))
      })
      .finally(() => { if (mountedRef.current) setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const handleReconnect = async () => {
    if (reconnecting) return
    setReconnecting(true)
    const r = await connectGoogleCalendar()
    if (!mountedRef.current) return
    if (r.ok) {
      await load()
    } else {
      Alert.alert('Couldn’t reconnect', friendlyConnectError(r.error))
    }
    if (mountedRef.current) setReconnecting(false)
  }

  const toggle = (id: string) => {
    if (id === GCAL_PRIMARY) return // primary is always included
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    if (!userId || saving) return
    setSaving(true)
    try {
      await supabase.from('user_profiles')
        .update({ selected_google_calendar_ids: Array.from(selected) })
        .eq('user_id', userId)
      await refreshProfile()
      queryClient.invalidateQueries({ queryKey: ['range_events', userId] })
      router.back()
    } catch {
      setError('Couldn’t save your selection. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    // Safe-area root, matching every other `presentation: 'modal'` screen (this
    // was the only one of 28 rooted at a plain View). iOS insets a modal itself so
    // it looked fine there, but on ANDROID a modal is full-screen: the header and
    // its Close button rendered under the status bar / camera cutout, and the
    // fixed Save footer below sat in the gesture area. 'bottom' is included
    // because the Save button lives outside the ScrollView — same as
    // calendar-setup.tsx, which has the identical header + footer structure.
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Choose Calendars"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.subtitle}>
          {BRAND_NAME} reads these calendars to avoid double-booking you. Your primary calendar is always
          included.
        </Text>

        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: Spacing.xl }} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Ionicons name="information-circle-outline" size={20} color={C.textSecondary} />
            <View style={{ flex: 1, gap: Spacing.sm }}>
              <Text style={styles.errorText}>{error}</Text>
              <PressableScale
                style={styles.retryBtn}
                onPress={needsReconnect ? handleReconnect : load}
                disabled={reconnecting}
              >
                {reconnecting ? (
                  <ActivityIndicator color={C.onPrimary} size="small" />
                ) : (
                  <Text style={styles.retryBtnText}>{needsReconnect ? 'Reconnect Google Calendar' : 'Try again'}</Text>
                )}
              </PressableScale>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {calendars.map((cal, i) => {
              const isPrimary = cal.primary || cal.id === GCAL_PRIMARY
              const checked = isPrimary || selected.has(cal.id)
              return (
                <View key={cal.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => toggle(cal.id)}
                    disabled={isPrimary}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.dot, cal.backgroundColor ? { backgroundColor: cal.backgroundColor } : null]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{cal.summary}</Text>
                      {isPrimary && <Text style={styles.rowSub}>Primary — always included</Text>}
                    </View>
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isPrimary ? C.textSecondary : C.primary}
                    />
                  </TouchableOpacity>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>

      {!loading && !error && (
        <View style={styles.footer}>
          <PressableScale style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={C.onPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  card: {
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    ...CardShadow, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.outlineVariant },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.primary },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  errorCard: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },
  retryBtn: {
    alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: Radius.full,
    paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.md,
  },
  retryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.onPrimary },
  footer: { padding: Spacing.containerPadding, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.outlineVariant },
  saveBtn: { backgroundColor: C.primary, borderRadius: Radius.full, paddingVertical: Spacing.sm + 2, alignItems: 'center' },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
