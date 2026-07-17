// Tempo — Choose Calendars (modal, B1.5 multi-calendar).
//
// Lets a user pick which Google calendars (beyond primary) Tempo also reads
// busy-time from. Dormant until the calendar.calendarlist.readonly OAuth scope
// is granted (services/googleCalendar/config.ts) — fetchCalendarList() will
// honestly fail with an insufficient-scope error until then, and this screen
// shows that as a plain "not available yet" state rather than faking success.
// Reached from Calendar Setup → Google card → "Choose calendars" (Pro-gated).

import { useEffect, useState } from 'react'
import { StyleSheet, View, Text, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { PressableScale } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { fetchCalendarList, getLastCalendarReadError, type GoogleCalendarListEntry } from '@/services/googleCalendar/CalendarApiService'
import { GCAL_PRIMARY } from '@/services/googleCalendar/config'

function friendlyListError(reason?: string): string {
  if (reason && /scope|insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) {
    return 'Multi-calendar isn’t turned on for your account yet — Tempo currently only reads your primary Google Calendar. Check back in a future update.'
  }
  return 'Couldn’t load your calendars right now. Pull to retry, or check back later.'
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
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(
    new Set(profile?.selected_google_calendar_ids ?? [])
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchCalendarList()
      .then(list => { if (!cancelled) { setCalendars(list); setLoading(false) } })
      .catch(() => {
        if (cancelled) return
        setError(friendlyListError(getLastCalendarReadError()?.reason))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

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
    <View style={styles.container}>
      <ScreenHeader
        title="Choose Calendars"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close" />}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.subtitle}>
          Tempo reads these calendars to avoid double-booking you. Your primary calendar is always
          included.
        </Text>

        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: Spacing.xl }} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Ionicons name="information-circle-outline" size={20} color={C.textSecondary} />
            <Text style={styles.errorText}>{error}</Text>
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
    </View>
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
  errorText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },
  footer: { padding: Spacing.containerPadding, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.outlineVariant },
  saveBtn: { backgroundColor: C.primary, borderRadius: Radius.full, paddingVertical: Spacing.sm + 2, alignItems: 'center' },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
