import { ScrollView, TouchableOpacity, View, Text, StyleSheet, Alert, Linking, TextInput, ActivityIndicator, Switch } from 'react-native'
import { TempoSheet } from '@/components/TempoSheet'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import Constants from 'expo-constants'
import { Colors, Spacing, Radius, CardShadow, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, useThemeMode, type Palette, type ThemeMode } from '@/theme'
import { ScreenHeader, HeaderActions, PulseLoader } from '@/components/brand'
import { ScreenTransition } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { useQuery } from '@tanstack/react-query'
import { readinessFromHistory } from '@/lib/fitnessInsights'
import { InsightsGrid, type InsightTile } from '@/components/ProfileCards'
import { getCalendarPermissionStatus } from '@/services/calendarService'
import { isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { autoSyncEnabled, syncUpcomingWorkouts, purgeSyncedWorkouts, removeAllTempoEvents } from '@/lib/calendarAutoSync'
import { autoScheduleUpcoming, autoSchedulingEnabled } from '@/lib/autoSchedule'
import { computeLevel } from '@/lib/achievements'
import { badgeStatsFromSessions, computeEarnedBadges, fetchStoredBadges, unviewedBadgeCount } from '@/lib/badges'
import { AVATAR_PRESETS, parseAvatar, buildAvatarValue, uploadAvatar } from '@/lib/avatar'
import {
  getSavedSwaps, getAlternatives, saveSubstitution, removeSubstitution,
  type SavedSwap, type AltExercise,
} from '@/lib/substitutions'
import { describeTravelEquipment, describeTravelUntil } from '@/lib/travelMode'
import { deleteAccount } from '@/lib/account'
import {
  fetchMeasurements, logMeasurement, computeWeightTrend, computeMetricTrend,
} from '@/lib/bodyMeasurements'
import {
  useUnitStore, unitLabel, displayWeight, inputToLbs, formatWeightDelta,
  type WeightUnit,
} from '@/lib/units'
import { setPushEnabled as applyPushEnabled } from '@/lib/pushTokens'
import {
  loadNotificationPrefs, setServerRuleEnabled, setPreWorkoutEnabled,
  getMasterPushEnabled, setMasterPushEnabled,
  DEFAULT_PREFS, type NotificationPrefs, type ServerRule,
} from '@/lib/notificationPrefs'
import { scheduleWorkoutReminders, cancelAllReminders, hasReminderPermission } from '@/lib/notifications'
import { useProAccess, useEntitlementStore } from '@/stores/entitlements'
import { presentCustomerCenter } from '@/lib/purchases'
import { pickAndUploadProgressPhoto, progressPhotoUrl } from '@/lib/progressPhotos'
import { updateUsername } from '@/lib/social'
import { useTutorialStore } from '@/stores/tutorial'
import { T } from '@/lib/tutorial'
import { OptionSheet } from '@/components/OptionSheet'
import { SaveProgressSheet } from '@/components/SaveProgressSheet'
import { track } from '@/lib/analytics'
import type { TravelMode, BodyMeasurement } from '@/types'


const GOAL_LABELS: Record<string, string> = {
  muscle_gain: 'Build Muscle',
  fat_loss: 'Lose Fat',
  strength: 'Gain Strength',
  general_fitness: 'General Fitness',
  athletic: 'Athletic Performance',
}

const EXP_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

const EQUIPMENT_OPTIONS: { id: string; label: string; icon: string }[] = [
  { id: 'bodyweight', label: 'No equipment', icon: 'walk-outline' },
  { id: 'pull_up_bar', label: 'Pull-up & dip bar', icon: 'body-outline' },
  { id: 'dumbbells', label: 'Dumbbells', icon: 'barbell-outline' },
  { id: 'barbell', label: 'Barbell', icon: 'barbell' },
  { id: 'kettlebell', label: 'Kettlebells', icon: 'fitness-outline' },
  { id: 'resistance_bands', label: 'Resistance Bands', icon: 'pulse-outline' },
  { id: 'full_gym', label: 'Full Gym', icon: 'business-outline' },
]

function equipmentSummary(equipment: string[] | null | undefined): string {
  if (!equipment || !equipment.length) return 'Bodyweight only'
  if (equipment.includes('full_gym')) return 'Full Gym'
  return equipment
    .map(e => EQUIPMENT_OPTIONS.find(o => o.id === e)?.label ?? e)
    .join(', ')
}

// Body areas the Quick Workout engine knows how to program around (see
// injuriesToRestrictions in lib/quickWorkout.ts — these keywords map to avoided
// muscles/patterns). The stored value is the lowercase id.
const INJURY_OPTIONS: { id: string; label: string; icon: string }[] = [
  { id: 'knee', label: 'Knees', icon: 'walk-outline' },
  { id: 'back', label: 'Lower back', icon: 'body-outline' },
  { id: 'shoulder', label: 'Shoulders', icon: 'barbell-outline' },
  { id: 'elbow', label: 'Elbows', icon: 'fitness-outline' },
  { id: 'wrist', label: 'Wrists', icon: 'hand-left-outline' },
  { id: 'hip', label: 'Hips', icon: 'accessibility-outline' },
  { id: 'hamstring', label: 'Hamstrings', icon: 'walk-outline' },
  { id: 'ankle', label: 'Ankles / calves', icon: 'footsteps-outline' },
]

function injurySummary(injuries: string[] | null | undefined): string {
  if (!injuries || !injuries.length) return 'None — train everything'
  return injuries
    .map(i => INJURY_OPTIONS.find(o => o.id === i)?.label ?? i)
    .join(', ')
}

// Travel-mode status for the settings row — "Off" when none or the end date passed.
function travelSummary(tm: TravelMode | null | undefined): string {
  if (!tm?.equipment?.length) return 'Off'
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (tm.until && tm.until < today) return 'Off'
  return `${describeTravelEquipment(tm.equipment)} · ${describeTravelUntil(tm.until)}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function availabilitySummary(tod: string | null | undefined, flex: string | null | undefined): string {
  return `${tod ? cap(tod) : 'Any time'} · ${flex ? cap(flex) : 'Balanced'}`
}

type SettingRowProps = { icon: string; label: string; value: string; onPress?: () => void }
function SettingRow({ icon, label, value, onPress }: SettingRowProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon as any} size={18} color={C.primary} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />}
    </TouchableOpacity>
  )
}

export default function ProfileScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Bottom sheets must clear the home indicator on notched devices.
  const sheetPad = { paddingBottom: Math.max(insets.bottom, Spacing.lg) }
  const { mode, setMode } = useThemeMode()
  const { profile, session, signOut, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { stats, workouts, logTimes } = useProgressStats(userId)

  // Consistency badges (lib/badges): derived from my session history + any stored
  // competitive/social badges. Stored keys refresh on focus so a just-awarded
  // Weekly Winner shows up.
  const [storedBadges, setStoredBadges] = useState<string[]>([])
  useFocusEffect(
    useCallback(() => {
      if (userId) fetchStoredBadges(supabase, userId).then(setStoredBadges).catch(() => {})
    }, [userId]),
  )
  const earnedBadges = useMemo(
    () => computeEarnedBadges(
      badgeStatsFromSessions(workouts, profile?.days_per_week ?? 3, new Date().toISOString().slice(0, 10), {
        totalWorkouts: stats.totalWorkouts, totalVolume: stats.totalVolumeNum,
      }),
      new Set(storedBadges),
    ),
    [workouts, profile?.days_per_week, storedBadges, stats.totalWorkouts, stats.totalVolumeNum],
  )
  // The header count is UNVIEWED badges (new since you last opened the trophy case).
  const newBadges = unviewedBadgeCount(earnedBadges, userId)
  const [calendarStatus, setCalendarStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)

  // Incoming friend requests — a badge on the header Friends button, so a
  // request can't sit invisible inside the Friends screen forever.
  const [pendingRequests, setPendingRequests] = useState(0)
  const [pendingInvites, setPendingInvites] = useState(0)
  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('addressee_id', userId)
        .eq('status', 'pending')
        .then(({ count }) => setPendingRequests(count ?? 0))
      // Incoming workout invites count toward the same Friends badge.
      supabase
        .from('workout_invites')
        .select('id', { count: 'exact', head: true })
        .eq('to_user', userId)
        .eq('status', 'pending')
        .then(({ count }) => setPendingInvites(count ?? 0), () => {})
    }, [userId]),
  )
  // One "social" indicator on the Friends button: requests + incoming invites.
  const socialNotifs = pendingRequests + pendingInvites

  const avatar = parseAvatar(profile?.avatar_url)
  const level = computeLevel(stats.totalWorkouts)

  // Profile insights (premium redesign) — a history-based readiness + progress stats.
  const readiness = useMemo(() => readinessFromHistory(workouts, logTimes, new Date()), [workouts, logTimes])

  const insightTiles: InsightTile[] = [
    { icon: 'checkmark-done', label: 'Workouts', value: String(stats.totalWorkouts), tint: C.primary },
    { icon: 'flame', label: 'Day streak', value: String(stats.streak), tint: C.ember },
    { icon: 'pulse', label: 'Consistency', value: `${stats.consistency_pct ?? 0}%`, tint: C.success },
    { icon: 'trophy', label: 'PRs', value: String(stats.prs?.length ?? 0), tint: C.gold },
    { icon: 'barbell', label: 'Volume', value: stats.totalVolume ?? '0', tint: C.primaryBright },
    { icon: 'heart', label: 'Readiness', value: String(readiness.score), tint: readiness.score >= 80 ? C.readyHigh : readiness.score >= 55 ? C.readyMed : C.readyLow },
  ]

  // Edit-profile modal
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [avatarId, setAvatarId] = useState(AVATAR_PRESETS[0].id)
  const [saving, setSaving] = useState(false)

  // Equipment modal
  const [equipModal, setEquipModal] = useState(false)
  const [equipSel, setEquipSel] = useState<string[]>([])
  const [equipSaving, setEquipSaving] = useState(false)

  // Saved exercise swaps + editor
  const [swaps, setSwaps] = useState<SavedSwap[]>([])
  const [swapModal, setSwapModal] = useState<SavedSwap | null>(null)
  const [alts, setAlts] = useState<AltExercise[]>([])
  const [altsLoading, setAltsLoading] = useState(false)
  const [swapBusy, setSwapBusy] = useState(false)

  // Body measurement history + log-entry modal
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])
  const [bodyModal, setBodyModal] = useState(false)
  const [weightInput, setWeightInput] = useState('')
  const [bodyFatInput, setBodyFatInput] = useState('')
  const [waistInput, setWaistInput] = useState('')
  const [bodySaving, setBodySaving] = useState(false)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Injuries / limitations modal
  const [injuryModal, setInjuryModal] = useState(false)
  const [injurySel, setInjurySel] = useState<string[]>([])
  const [injurySaving, setInjurySaving] = useState(false)

  // Server-driven push toggle for this device
  const [pushEnabled, setPushEnabled] = useState(true)

  // Per-rule notification preferences (§6.1) — finer control beneath the master
  // switch. pre_workout is device-local; the rest are account-level.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)

  // Weight display unit (lb/kg) — a device preference; storage stays lbs.
  const unit = useUnitStore((s) => s.unit)
  const setUnit = useUnitStore((s) => s.setUnit)

  // "Add workouts to my calendar" — default on; only acts once a calendar is connected.
  const [autoSync, setAutoSync] = useState(autoSyncEnabled(profile))

  // "Automatically schedule workout times" — default on. Independent of calendar
  // connection: a connected calendar is still read for busy times in manual mode.
  const [autoScheduleTimes, setAutoScheduleTimes] = useState(autoSchedulingEnabled(profile))

  const [deleting, setDeleting] = useState(false)
  const [removingEvents, setRemovingEvents] = useState(false)

  // App Store-required account deletion. Double-confirm (it's irreversible and wipes
  // all data), then call the server function and sign out on success. The two
  // confirms are modeled as sheet stages instead of nested Alert.alerts.
  const [deleteAccountStage, setDeleteAccountStage] = useState<'confirm' | 'final' | null>(null)
  // Straggler confirms migrated off native Alert.alert onto the branded OptionSheet.
  const [removeEventsSheet, setRemoveEventsSheet] = useState(false)
  const [changePlanSheet, setChangePlanSheet] = useState(false)
  const runDelete = async () => {
    setDeleting(true)
    const res = await deleteAccount(supabase)
    setDeleting(false)
    if (res.ok) {
      await signOut()
    } else {
      Alert.alert('Couldn’t delete account', `Something went wrong (${res.error}). Please try again, or contact support if it continues.`)
    }
  }
  const handleDeleteAccount = () => {
    if (deleting) return
    setDeleteAccountStage('confirm')
  }

  // Refresh both calendar connections on focus so the row reflects a connect/
  // disconnect made elsewhere (Smart Scheduler, Settings) without a reload.
  useFocusEffect(
    useCallback(() => {
      getCalendarPermissionStatus().then(setCalendarStatus)
      isGoogleCalendarConnected().then(setGoogleConnected).catch(() => setGoogleConnected(false))
    }, []),
  )

  const loadSwaps = useCallback(() => {
    if (userId) getSavedSwaps(supabase, userId).then(setSwaps)
  }, [userId])
  // Refresh on focus so a swap just made in a workout shows up here immediately.
  useFocusEffect(loadSwaps)

  const loadMeasurements = useCallback(() => {
    if (userId) fetchMeasurements(supabase, userId, 120).then(setMeasurements).catch(() => {})
  }, [userId])
  useFocusEffect(loadMeasurements)

  // Reflect the user's push on/off state when the screen gains focus. Read from the
  // user-level flag (not the device token, which may not exist) so it's accurate.
  useFocusEffect(
    useCallback(() => {
      if (userId) getMasterPushEnabled(supabase, userId).then(setPushEnabled).catch(() => {})
    }, [userId]),
  )

  // Load the per-rule notification preferences (§6.1).
  useEffect(() => {
    if (userId) loadNotificationPrefs(supabase, userId).then(setNotifPrefs).catch(() => {})
  }, [userId])

  // 4-week regression: weekly trend, smoothed current weight, and total change.
  const trend = computeWeightTrend(measurements)
  // Optional body-composition trends (only render when the user has logged them).
  const bodyFatTrend = computeMetricTrend(measurements, 'body_fat_pct')
  const waistTrend = computeMetricTrend(measurements, 'waist_in')

  const togglePush = async (next: boolean) => {
    setPushEnabled(next) // optimistic
    if (!userId) return
    // Persist at the USER level so the switch STICKS even when no device token is
    // registered (the old device_tokens-only path silently reverted on those devices).
    await setMasterPushEnabled(supabase, userId, next).catch(() => {})
    // Still flip device_tokens so the retention engine skips a disabled device (and,
    // when turning ON, prompt for permission + register a token).
    await applyPushEnabled(supabase, userId, next).catch(() => {})
    // Re-sync from the user-level flag — the source of truth for the switch.
    getMasterPushEnabled(supabase, userId).then(setPushEnabled).catch(() => {})
  }

  // Flip one account-level retention rule (§6.1). Optimistic; the edge function
  // reads the persisted value at send time.
  const toggleServerRule = (rule: ServerRule) => async (next: boolean) => {
    setNotifPrefs((p) => ({ ...p, [rule]: next })) // optimistic
    if (!userId) return
    await setServerRuleEnabled(supabase, userId, rule, next).catch(() => {})
  }

  // The pre-workout reminder is a LOCAL notification — toggling it re-plays the
  // device's schedule immediately: off cancels pending reminders, on re-schedules
  // the coming sessions (same reconciliation Home runs on focus).
  const togglePreWorkout = async (next: boolean) => {
    setNotifPrefs((p) => ({ ...p, pre_workout: next })) // optimistic
    setPreWorkoutEnabled(next)
    try {
      if (!next) {
        await cancelAllReminders()
      } else if (userId && (await hasReminderPermission())) {
        const todayStr = new Date().toISOString().slice(0, 10)
        const { data: upcoming } = await supabase
          .from('scheduled_workouts')
          .select('id, focus, planned_date, planned_start_time, planned_duration_min, status')
          .eq('user_id', userId)
          .eq('status', 'scheduled')
          .gte('planned_date', todayStr)
        await scheduleWorkoutReminders((upcoming ?? []) as any)
      }
    } catch { /* reminders are best-effort */ }
  }

  // A guest's anonymous session IS the account — there is no way to sign back in.
  // One casual tap must never be able to permanently orphan weeks of training data.
  const [signOutSheetVisible, setSignOutSheetVisible] = useState(false)
  const confirmSignOut = () => setSignOutSheetVisible(true)

  // Guests can permanently lose their history on a reinstall/new phone — give them
  // a standalone, discoverable way to attach an Apple/Google account (§1.1). The
  // card disappears the moment the session is no longer anonymous.
  const isGuest = !!session?.user.is_anonymous

  // Tempo Pro (§10). Both rows stay hidden while Pro is dormant (proEnabled false),
  // so Profile is visually unchanged until the flag is flipped on.
  const { isPro, proEnabled } = useProAccess()
  // Tester tools (remote-gated; never shown to the public). Lets a beta tester flip
  // Pro on/off on-device to preview both the free/paywall and unlocked experiences.
  const tester = useEntitlementStore((s) => s.tester)
  const devProOverride = useEntitlementStore((s) => s.devProOverride)
  const setDevProOverride = useEntitlementStore((s) => s.setDevProOverride)
  const openPaywall = () => { track('paywall_shown', { context: 'profile' }); router.push({ pathname: '/paywall', params: { context: 'profile' } } as never) }
  const [saveSheetVisible, setSaveSheetVisible] = useState(false)
  const openSaveProgress = () => { track('guest_save_prompt_shown', { context: 'profile' }); setSaveSheetVisible(true) }

  const openInjuries = () => {
    setInjurySel(profile?.injuries ?? [])
    setInjuryModal(true)
  }
  const toggleInjury = (id: string) =>
    setInjurySel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const saveInjuries = async () => {
    if (!userId || injurySaving) return
    setInjurySaving(true)
    try {
      await supabase.from('user_profiles').update({ injuries: injurySel }).eq('user_id', userId)
      await refreshProfile()
      setInjuryModal(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setInjurySaving(false)
    }
  }

  // Reset the log-entry modal (inputs + any attached photo) before opening it.
  const openBody = () => {
    setWeightInput(''); setBodyFatInput(''); setWaistInput('')
    setPhotoPath(null); setPhotoPreview(null)
    setBodyModal(true)
  }

  const handleAvatarPress = async () => {
    if (avatarUploading || !userId) return
    setAvatarUploading(true)
    const res = await uploadAvatar(supabase, userId)
    setAvatarUploading(false)
    if (res.status === 'ok') {
      try {
        await supabase.from('user_profiles').update({ avatar_url: res.url }).eq('user_id', userId)
        await refreshProfile()
      } catch {
        Alert.alert('Couldn’t save', 'Your photo uploaded but saving it to your profile failed. Please try again.')
      }
    } else if (res.status === 'denied') {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to set a profile picture.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    } else if (res.status === 'error') {
      Alert.alert('Upload failed', 'Could not upload that photo. Please try again.')
    }
  }

  const attachPhoto = async () => {
    if (photoBusy || !userId) return
    setPhotoBusy(true)
    const res = await pickAndUploadProgressPhoto(supabase, userId)
    setPhotoBusy(false)
    if (res.status === 'ok') {
      setPhotoPath(res.path)
      progressPhotoUrl(supabase, res.path).then(setPhotoPreview)
    } else if (res.status === 'denied') {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to attach a progress photo.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    } else if (res.status === 'error') {
      Alert.alert('Upload failed', 'Could not upload that photo. Please try again.')
    }
  }

  const saveBodyEntry = async () => {
    if (!userId || bodySaving) return
    const weight = parseFloat(weightInput)
    const bf = parseFloat(bodyFatInput)
    const waist = parseFloat(waistInput)
    // Allow an entry with just a photo (no numbers) too.
    if (![weight, bf, waist].some(Number.isFinite) && !photoPath) { setBodyModal(false); return }
    setBodySaving(true)
    try {
      await logMeasurement(supabase, userId, {
        // Input is in the display unit; storage is always lbs.
        weight_lbs: Number.isFinite(weight) ? inputToLbs(weightInput, unit) : null,
        body_fat_pct: Number.isFinite(bf) ? bf : null,
        waist_in: Number.isFinite(waist) ? waist : null,
        photo_url: photoPath,
      })
      setWeightInput(''); setBodyFatInput(''); setWaistInput('')
      setPhotoPath(null); setPhotoPreview(null)
      setBodyModal(false)
      loadMeasurements()
      refreshProfile()  // keep the cached profile weight current
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setBodySaving(false)
    }
  }

  const openSwap = async (swap: SavedSwap) => {
    setSwapModal(swap)
    setAltsLoading(true)
    const list = await getAlternatives(supabase, userId, swap.originalId)
    setAlts(list)
    setAltsLoading(false)
  }

  const changeSwapTo = async (altId: string) => {
    if (!swapModal || swapBusy) return
    setSwapBusy(true)
    await saveSubstitution(supabase, userId, swapModal.originalId, altId)
    setSwapBusy(false)
    setSwapModal(null)
    loadSwaps()
  }

  const resetSwap = async () => {
    if (!swapModal || swapBusy) return
    setSwapBusy(true)
    await removeSubstitution(supabase, userId, swapModal.originalId)
    setSwapBusy(false)
    setSwapModal(null)
    loadSwaps()
  }

  // Replay the guided walkthrough: re-arm the Home tour + re-show the first-session
  // coach overlay, then drop the user on Home where the tour re-fires.
  const replayTour = () => {
    const tut = useTutorialStore.getState()
    tut.completeStep('welcome_done') // ensure the welcome gate stays satisfied
    tut.replay(T.homeTour)
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage
      ls?.removeItem('tempo.coach.session')
      ls?.removeItem('tempo.tip.how_tempo_works') // re-show the concepts explainer too
    } catch { /* best-effort */ }
    Alert.alert('Tour reset', 'The guided walkthrough will play again on Home and in your next workout.', [
      { text: 'Show me', onPress: () => router.push('/(tabs)') },
    ])
  }

  const openEdit = () => {
    setNameInput(profile?.display_name ?? '')
    setUsernameInput(profile?.username ?? '')
    const match = AVATAR_PRESETS.find(p => p.icon === avatar.icon && p.color === avatar.color)
    setAvatarId(match?.id ?? AVATAR_PRESETS[0].id)
    setEditing(true)
  }

  const saveProfile = async () => {
    if (!userId || saving) return
    setSaving(true)
    const preset = AVATAR_PRESETS.find(p => p.id === avatarId) ?? AVATAR_PRESETS[0]
    try {
      // Username first — it can fail validation/uniqueness independently, and
      // the user should hear about exactly that instead of a generic error.
      const desired = usernameInput.trim().toLowerCase().replace(/^@/, '')
      if (desired && desired !== (profile?.username ?? '')) {
        const res = await updateUsername(supabase, userId, desired)
        if (res === 'invalid') {
          Alert.alert('Invalid username', '3–20 characters, lowercase letters, numbers and _ only.')
          setSaving(false)
          return
        }
        if (res === 'taken') {
          Alert.alert('Username taken', `@${desired} already belongs to someone else — try another.`)
          setSaving(false)
          return
        }
        if (res === 'failed') throw new Error('username update failed')
      }
      await supabase
        .from('user_profiles')
        .update({
          display_name: nameInput.trim() || null,
          avatar_url: buildAvatarValue(preset.icon, preset.color),
        })
        .eq('user_id', userId)
      await refreshProfile()
      setEditing(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const openEquip = () => {
    setEquipSel(profile?.equipment ?? ['bodyweight'])
    setEquipModal(true)
  }

  const toggleEquip = (id: string) => {
    setEquipSel(prev => (prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]))
  }

  const saveEquipment = async () => {
    if (!userId || equipSaving) return
    setEquipSaving(true)
    // Always keep at least bodyweight so plans/quick workouts never have nothing to pull from.
    const next = equipSel.length ? equipSel : ['bodyweight']
    try {
      await supabase.from('user_profiles').update({ equipment: next }).eq('user_id', userId)
      await refreshProfile()
      setEquipModal(false)
    } catch {
      Alert.alert('Could not save', 'Please try again.')
    } finally {
      setEquipSaving(false)
    }
  }

  // Which calendar Tempo schedules around — prefer the user's chosen provider,
  // else whichever is actually connected.
  const connectedCalendar =
    profile?.preferred_calendar === 'google' && googleConnected ? 'Google Calendar'
      : profile?.preferred_calendar === 'device' && calendarStatus === 'granted' ? 'Device Calendar'
        : googleConnected ? 'Google Calendar'
          : calendarStatus === 'granted' ? 'Device Calendar'
            : null
  const calendarConnected = !!connectedCalendar
  const calendarValue = connectedCalendar
    ? `${connectedCalendar} connected`
    : 'Connect to sync workouts'

  // Keep the auto-sync toggle in step with the stored preference.
  useEffect(() => { setAutoSync(autoSyncEnabled(profile)) }, [profile?.calendar_autosync])
  useEffect(() => { setAutoScheduleTimes(autoSchedulingEnabled(profile)) }, [profile?.scheduling_mode])

  // Toggle automatic scheduling. Switching ON immediately places upcoming workouts
  // around the calendar; switching OFF just stops Tempo from moving times.
  const toggleAutoSchedule = async (next: boolean) => {
    setAutoScheduleTimes(next) // optimistic
    if (userId) {
      try {
        await supabase.from('user_profiles').update({ scheduling_mode: next ? 'auto' : 'manual' }).eq('user_id', userId)
        await refreshProfile()
      } catch { /* keep the optimistic toggle */ }
      if (next) autoScheduleUpcoming(supabase, userId).catch(() => {})
    }
  }


  // Toggle "add workouts to my calendar". Turning it ON (with a calendar connected)
  // immediately syncs upcoming workouts; turning it OFF removes every Tempo event we
  // ever added, so the user's calendar goes back to exactly how it was.
  const toggleAutoSync = async (next: boolean) => {
    setAutoSync(next) // optimistic
    if (userId) {
      try {
        await supabase.from('user_profiles').update({ calendar_autosync: next }).eq('user_id', userId)
        await refreshProfile()
      } catch { /* keep the optimistic toggle */ }
    }
    if (next && calendarConnected) {
      syncUpcomingWorkouts(supabase, userId, { ...(profile as any), calendar_autosync: true }).catch(() => {})
    } else if (!next) {
      // Clean up after ourselves — delete all Tempo-added events from the calendar.
      purgeSyncedWorkouts(supabase, userId).catch(() => {})
    }
  }

  // "Remove all Tempo events" — wipe every "Tempo · …" / "Tempo: …" event off the
  // connected calendar(s), including orphans we no longer track, and forget the
  // pointers. Useful after lots of re-planning leaves stray events behind.
  const handleRemoveAllTempoEvents = () => {
    if (!userId || removingEvents) return
    if (!calendarConnected) {
      Alert.alert('No calendar connected', 'Connect a calendar first — then Tempo can remove its events from it.')
      return
    }
    setRemoveEventsSheet(true)
  }
  const doRemoveAllTempoEvents = async () => {
    if (!userId) return
    setRemovingEvents(true)
    let count = 0
    try { count = await removeAllTempoEvents(supabase, userId) } catch { /* best-effort */ }
    // Turn auto-add off too, so they don't immediately come back.
    try {
      await supabase.from('user_profiles').update({ calendar_autosync: false }).eq('user_id', userId)
      await refreshProfile()
    } catch { /* best-effort */ }
    setAutoSync(false)
    setRemovingEvents(false)
    Alert.alert(
      'Done',
      count > 0
        ? `Removed ${count} Tempo event${count === 1 ? '' : 's'} from your calendar.`
        : 'No Tempo events were found on your calendar.',
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
      <ScreenHeader
        right={
          <HeaderActions>
            <TouchableOpacity
              onPress={() => router.push('/badges' as any)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={newBadges > 0 ? `Badges — ${newBadges} new` : 'Badges'}
            >
              <Ionicons name="ribbon-outline" size={22} color={C.text} />
              {newBadges > 0 && (
                <View style={styles.badgeCount}>
                  <Text style={styles.friendBadgeText}>{newBadges > 9 ? '9+' : newBadges}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/social' as any)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={socialNotifs > 0 ? `Friends — ${socialNotifs} new` : 'Friends'}
            >
              <Ionicons name="people-outline" size={22} color={C.text} />
              {socialNotifs > 0 && (
                <View style={styles.friendBadge}>
                  <Text style={styles.friendBadgeText}>{socialNotifs > 9 ? '9+' : socialNotifs}</Text>
                </View>
              )}
            </TouchableOpacity>
          </HeaderActions>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Profile card — dark, modular: header · XP · stats grid ───────── */}
        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <TouchableOpacity style={styles.heroAvatarWrap} onPress={handleAvatarPress} disabled={avatarUploading} activeOpacity={0.85}>
              <View style={[styles.avatarLarge, { backgroundColor: avatar.color }]}>
                {avatarUploading ? (
                  <ActivityIndicator color="#fff" />
                ) : avatar.imageUri ? (
                  <Image source={{ uri: avatar.imageUri }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Ionicons name={avatar.icon as any} size={30} color="#fff" />
                )}
              </View>
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={12} color={avatar.color} />
              </View>
            </TouchableOpacity>

            <View style={styles.heroHeaderInfo}>
              <View style={styles.heroNameRow}>
                <Text style={styles.displayName} numberOfLines={1}>{profile?.display_name ?? 'Athlete'}</Text>
                {isPro && (
                  <View style={styles.proBadge}>
                    <Ionicons name="flash" size={10} color="#1b1400" />
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </View>
                )}
              </View>
              {!!profile?.username && <Text style={styles.username} numberOfLines={1}>@{profile.username}</Text>}
              <View style={styles.levelChip}>
                <Ionicons name="star" size={11} color={C.primary} />
                <Text style={styles.levelChipText}>LVL {level.level} · {level.title.toUpperCase()}</Text>
              </View>
            </View>

            <TouchableOpacity onPress={openEdit} style={styles.heroEditBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit profile">
              <Ionicons name="pencil" size={15} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* XP progress */}
          <View style={styles.levelBarTrack}>
            <View style={[styles.levelBarFill, { width: `${Math.round((level.intoLevel / level.perLevel) * 100)}%` as `${number}%` }]} />
          </View>
          <Text style={styles.levelHint}>
            {level.toNext} more workout{level.toNext !== 1 ? 's' : ''} to Level {level.level + 1}
            {profile?.goal ? `  ·  ${GOAL_LABELS[profile.goal]}` : ''}
          </Text>

          {/* Secondary stats grid */}
          <View style={styles.heroStatsGrid}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: C.ember }]}>{stats.streak}</Text>
              <Text style={styles.heroStatLabel}>Day streak</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{stats.totalWorkouts}</Text>
              <Text style={styles.heroStatLabel}>Workouts</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: C.success }]}>{stats.consistency_pct ?? 0}%</Text>
              <Text style={styles.heroStatLabel}>Consistency</Text>
            </View>
          </View>
        </View>

        {/* ── Tempo insights ───────────────────────────────────────────────── */}
        <View style={styles.identitySection}>
          <InsightsGrid tiles={insightTiles} delay={100} />
        </View>

        {/* ── Save your progress (guest → permanent account, §1.1) ────────────
            Standalone entry point — deliberately NOT nested in calendar settings. */}
        {isGuest && (
          <TouchableOpacity style={styles.saveCard} onPress={openSaveProgress} activeOpacity={0.85}>
            <View style={styles.saveIcon}>
              <Ionicons name="shield-checkmark" size={22} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.saveTitle}>Save your progress</Text>
              <Text style={styles.saveBody}>You’re training as a guest. Sign in so this history is never lost — even on a new phone.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.primary} />
          </TouchableOpacity>
        )}

        {/* ── Body stats (weight trend over time) ─────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Body Stats</Text>
            <View style={{ flexDirection: 'row', gap: Spacing.md }}>
              <TouchableOpacity onPress={() => router.push('/(tabs)/progress')}>
                <Text style={styles.sectionLink}>View trend</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openBody}>
                <Text style={styles.sectionLink}>Log entry</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.card}>
            {trend.currentAvg != null ? (
              <>
              <View style={styles.bodyRow}>
                <View style={styles.bodyCell}>
                  <Text style={styles.bodyCellLabel}>CURRENT (7-DAY AVG)</Text>
                  <Text style={styles.bodyCellValue}>
                    {displayWeight(trend.currentAvg, unit)} <Text style={styles.bodyCellUnit}>{unitLabel(unit)}</Text>
                  </Text>
                </View>
                <View style={styles.bodyCellDivider} />
                <View style={styles.bodyCell}>
                  <Text style={styles.bodyCellLabel}>WEEKLY TREND</Text>
                  <Text style={[styles.bodyCellValue, trend.lbsPerWeek != null && trend.lbsPerWeek < 0 && { color: C.primary }]}>
                    {trend.lbsPerWeek != null ? `${formatWeightDelta(trend.lbsPerWeek, unit)}/wk` : '—'}
                  </Text>
                  {trend.totalChange != null && (
                    <Text style={styles.bodyCellSub}>
                      {formatWeightDelta(trend.totalChange, unit)} over {trend.samples} weigh-ins
                    </Text>
                  )}
                </View>
              </View>
              {(bodyFatTrend.latest != null || waistTrend.latest != null) && (
                <View style={styles.bodyMetricRow}>
                  {bodyFatTrend.latest != null && (
                    <Text style={styles.bodyMetric}>
                      Body fat <Text style={styles.bodyMetricVal}>{bodyFatTrend.latest}%</Text>
                      {bodyFatTrend.perWeek != null ? `  ${bodyFatTrend.perWeek > 0 ? '+' : ''}${bodyFatTrend.perWeek}/wk` : ''}
                    </Text>
                  )}
                  {waistTrend.latest != null && (
                    <Text style={styles.bodyMetric}>
                      Waist <Text style={styles.bodyMetricVal}>{waistTrend.latest}"</Text>
                      {waistTrend.perWeek != null ? `  ${waistTrend.perWeek > 0 ? '+' : ''}${waistTrend.perWeek}/wk` : ''}
                    </Text>
                  )}
                </View>
              )}
              </>
            ) : (
              <Text style={styles.emptyHint}>
                Log your weight to start tracking trends. Tempo smooths daily noise and shows your real
                weekly rate — the feedback loop that tells you if your plan is working.
              </Text>
            )}
          </View>
        </View>

        {/* Saved exercise swaps — only shown once the user actually has some, so it
            isn't a prominent empty category at the top. Management stays fully intact. */}
        {swaps.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Exercise Swaps</Text>
            <Text style={styles.sectionMeta}>{swaps.length} saved</Text>
          </View>
          <View style={styles.card}>
            {swaps.map((s, i) => (
              <View key={s.originalId}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity style={styles.swapRow} onPress={() => openSwap(s)} activeOpacity={0.7}>
                  <View style={styles.swapIcon}><Ionicons name="swap-horizontal" size={18} color={C.primary} /></View>
                  <View style={styles.swapInfo}>
                    <Text style={styles.swapFrom} numberOfLines={1}>{s.originalName}</Text>
                    <Text style={styles.swapTo} numberOfLines={1}>→ {s.substituteName}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
        )}

        {/* ── Right Now (temporary / personal adjustments) ──────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Right Now</Text>
          <Text style={styles.sectionSubtitle}>Temporary adjustments Tempo applies to your upcoming workouts.</Text>
          <View style={styles.card}>
            <SettingRow
              icon="airplane-outline"
              label="TRAVEL MODE"
              value={travelSummary(profile?.travel_mode)}
              onPress={() => router.push('/travel-mode')}
            />
            <View style={styles.divider} />
            <SettingRow icon="medkit-outline" label="INJURIES & LIMITATIONS" value={injurySummary(profile?.injuries)} onPress={openInjuries} />
          </View>
        </View>

        {/* ── Training ────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training</Text>
          <View style={styles.card}>
            <SettingRow icon="construct-outline" label="MY WORKOUTS" value="Build, save & schedule" onPress={() => router.push('/my-workouts' as any)} />
            <View style={styles.divider} />
            <SettingRow icon="repeat-outline" label="MY SPLITS" value="Your weekly schedule" onPress={() => router.push('/my-splits' as any)} />
            <View style={styles.divider} />
            <SettingRow icon="journal-outline" label="WORKOUT HISTORY" value="Every logged session" onPress={() => router.push('/workout-history' as any)} />
            <View style={styles.divider} />
            <SettingRow icon="trophy-outline" label="PRIMARY GOAL" value={profile?.goal ? GOAL_LABELS[profile.goal] : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="barbell-outline" label="EXPERIENCE" value={profile?.experience ? EXP_LABELS[profile.experience] : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="calendar-outline" label="DAYS PER WEEK" value={profile?.days_per_week ? `${profile.days_per_week} days` : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="fitness-outline" label="EQUIPMENT" value={equipmentSummary(profile?.equipment)} onPress={openEquip} />
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.changePlanRow}
              onPress={() => setChangePlanSheet(true)}
            >
              <Text style={styles.changePlanText}>Change Plan</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Social ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Social</Text>
          <View style={styles.card}>
            <SettingRow icon="people-outline" label="FRIENDS" value="Find people, share workouts & privacy" onPress={() => router.push('/social' as any)} />
          </View>
        </View>

        {/* ── Calendar & Scheduling ───────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Calendar & Scheduling</Text>
          <View style={styles.card}>
            <SettingRow
              icon="time-outline"
              label="AVAILABILITY & SCHEDULE"
              value={availabilitySummary(profile?.preferred_time_of_day, profile?.schedule_flexibility)}
              onPress={() => router.push('/availability')}
            />
            <View style={styles.divider} />
            <SettingRow
              icon="calendar-outline"
              label="CALENDAR"
              value={calendarValue}
              onPress={() => router.push('/calendar-setup' as any)}
            />
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="sparkles-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>AUTOMATIC SCHEDULING</Text>
                <Text style={styles.settingValue}>
                  {autoScheduleTimes ? 'Tempo places workouts around your day' : "You schedule workouts yourself"}
                </Text>
              </View>
              <Switch
                value={autoScheduleTimes}
                onValueChange={toggleAutoSchedule}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="sync-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>ADD WORKOUTS TO CALENDAR</Text>
                <Text style={styles.settingValue}>
                  {calendarConnected ? (autoSync ? 'Auto-adding your workouts' : 'Off') : 'Connect a calendar first'}
                </Text>
              </View>
              <Switch
                value={autoSync && calendarConnected}
                onValueChange={toggleAutoSync}
                disabled={!calendarConnected}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>
            {calendarConnected && (
              <>
                <View style={styles.divider} />
                <SettingRow
                  icon="trash-outline"
                  label="REMOVE ALL TEMPO EVENTS"
                  value={removingEvents ? 'Removing…' : 'Delete Tempo events from calendar'}
                  onPress={handleRemoveAllTempoEvents}
                />
              </>
            )}
          </View>
        </View>

        {/* ── Subscription (Tempo Pro) — its own group; only while Pro is live ─ */}
        {proEnabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Subscription</Text>
            <View style={styles.card}>
              {!isPro ? (
                <TouchableOpacity style={styles.settingRow} onPress={openPaywall} activeOpacity={0.7}>
                  <View style={[styles.settingIcon, { backgroundColor: C.primarySoft }]}>
                    <Ionicons name="sparkles" size={18} color={C.primary} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>TEMPO PRO</Text>
                    <Text style={styles.settingValue}>Unlock adaptive coaching & deep analytics</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.settingRow} onPress={() => void presentCustomerCenter()} activeOpacity={0.7}>
                  <View style={[styles.settingIcon, { backgroundColor: C.primarySoft }]}>
                    <Ionicons name="star" size={18} color={C.primary} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>TEMPO PRO</Text>
                    <Text style={styles.settingValue}>Active — manage subscription</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.outlineVariant} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ── Tester Tools — remote-gated (app_config `tester_tools`); never shown to
            the public. Flips Pro on/off ON THIS DEVICE so a beta tester can preview
            both the free/paywall experience and the fully-unlocked one — without a
            real purchase and without editing the database each time. ─ */}
        {tester && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tester Tools</Text>
            <View style={styles.card}>
              <View style={styles.settingRow}>
                <View style={[styles.settingIcon, { backgroundColor: C.primarySoft }]}>
                  <Ionicons name="flask-outline" size={18} color={C.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>TEMPO PRO (TESTER)</Text>
                  <Text style={styles.settingValue}>
                    {isPro ? 'On — Pro features unlocked' : 'Off — paywalls & free limits show'}
                  </Text>
                </View>
                <Switch
                  value={isPro}
                  onValueChange={(v) => setDevProOverride(v)}
                  trackColor={{ true: C.primary, false: C.outlineVariant }}
                  thumbColor="#fff"
                />
              </View>
              {devProOverride !== null && (
                <>
                  <View style={styles.divider} />
                  <SettingRow
                    icon="refresh-outline"
                    label="USE REAL SUBSCRIPTION STATE"
                    value="Clear the tester override"
                    onPress={() => setDevProOverride(null)}
                  />
                </>
              )}
            </View>
          </View>
        )}

        {/* ── App ─────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="notifications-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>NOTIFICATIONS</Text>
                <Text style={styles.settingValue}>{pushEnabled ? 'Reminders & nudges on' : 'Off for this device'}</Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={togglePush}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>

            {/* Per-rule controls (§6.1) — mute one nag without silencing the rest.
                Pre-workout is a local reminder (works regardless of the master
                switch); the others are retention pushes gated by the master switch. */}
            {([
              { key: 'pre_workout', label: 'Pre-workout reminder', sub: '30 minutes before a session', server: false },
              { key: 'missed_workout', label: 'Missed workout', sub: 'A gentle nudge if you miss one', server: true },
              { key: 'streak_at_risk', label: 'Streak at risk', sub: "Evening reminder when today's is still open", server: true },
              { key: 'weekly_report', label: 'Weekly report', sub: 'Your Sunday progress recap', server: true },
              { key: 'free_time_gap', label: 'Free time suggestions', sub: 'A quick workout when you have a gap', server: true },
              { key: 'partner_reminder', label: 'Workout partner', sub: 'When a workout you planned with a friend is coming up', server: true },
              { key: 'friend_competition', label: 'Friend competition', sub: "When you're close on the weekly leaderboard", server: true },
            ] as const).map((r) => {
              const disabled = r.server && !pushEnabled
              return (
                <View key={r.key} style={[styles.prefRow, disabled && { opacity: 0.45 }]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.prefLabel}>{r.label}</Text>
                    <Text style={styles.prefSub}>{r.sub}</Text>
                  </View>
                  <Switch
                    value={notifPrefs[r.key]}
                    onValueChange={r.server ? toggleServerRule(r.key as ServerRule) : togglePreWorkout}
                    disabled={disabled}
                    trackColor={{ true: C.primary, false: C.outlineVariant }}
                    thumbColor="#fff"
                  />
                </View>
              )
            })}

            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="contrast-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>APPEARANCE</Text>
                <Text style={styles.settingValue}>{mode === 'dark' ? 'Dark' : 'Light'}</Text>
              </View>
              <View style={styles.themeToggle}>
                {(['dark', 'light'] as ThemeMode[]).map((m) => {
                  const on = mode === m
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.themeOpt, on && styles.themeOptOn]}
                      onPress={() => setMode(m)}
                      activeOpacity={0.85}
                      accessibilityLabel={m === 'dark' ? 'Dark mode' : 'Light mode'}
                    >
                      <Ionicons name={m === 'dark' ? 'moon' : 'sunny'} size={15} color={on ? C.onPrimary : C.outline} />
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="scale-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>UNITS</Text>
                <Text style={styles.settingValue}>{unit === 'kg' ? 'Kilograms' : 'Pounds'}</Text>
              </View>
              <View style={styles.themeToggle}>
                {(['lb', 'kg'] as WeightUnit[]).map((u) => {
                  const on = unit === u
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.themeOpt, on && styles.themeOptOn]}
                      onPress={() => setUnit(u)}
                      activeOpacity={0.85}
                      accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
                    >
                      <Text style={[styles.unitOptText, on && { color: C.onPrimary }]}>{u}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
            <View style={styles.divider} />
            <SettingRow icon="school-outline" label="REPLAY APP TOUR" value="Show the guided walkthrough again" onPress={replayTour} />
          </View>
        </View>

        {/* ── Account ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <SettingRow icon="shield-outline" label="PRIVACY & TERMS" value="View" onPress={() => router.push('/legal')} />
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={confirmSignOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* App Store-required: delete account + all data from within the app. */}
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator color={C.error} />
          ) : (
            <Text style={styles.deleteText}>Delete Account</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.deleteHint}>Permanently erases your account and all data.</Text>

        {/* Brand footer */}
        <View style={styles.brandFooter}>
          <Image
            source={require('@/assets/images/tempo-logo.png')}
            style={styles.brandFooterLogo}
            contentFit="contain"
            accessibilityLabel="Tempo"
          />
          <Text style={styles.brandFooterVersion}>Tempo · Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
        </View>
      </ScrollView>

      {/* ── Log body measurement modal ────────────────────────────────────── */}
      <TempoSheet visible={bodyModal} onClose={() => setBodyModal(false)} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Log Measurement</Text>
            <Text style={styles.modalHint}>Weigh in regularly — even a few times a week is enough for Tempo to read your real trend. Body fat and waist are optional.</Text>

            <Text style={styles.modalLabel}>WEIGHT ({unitLabel(unit).toUpperCase()})</Text>
            <TextInput
              style={styles.modalInput}
              value={weightInput}
              onChangeText={setWeightInput}
              placeholder={unit === 'kg' ? 'e.g. 80' : 'e.g. 175'}
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={6}
            />

            <Text style={styles.modalLabel}>BODY FAT % (OPTIONAL)</Text>
            <TextInput
              style={styles.modalInput}
              value={bodyFatInput}
              onChangeText={setBodyFatInput}
              placeholder="e.g. 18"
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={5}
            />

            <Text style={styles.modalLabel}>WAIST (IN, OPTIONAL)</Text>
            <TextInput
              style={styles.modalInput}
              value={waistInput}
              onChangeText={setWaistInput}
              placeholder="e.g. 32"
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={5}
            />

            <Text style={styles.modalLabel}>PROGRESS PHOTO (OPTIONAL)</Text>
            <TouchableOpacity style={styles.photoBtn} onPress={attachPhoto} disabled={photoBusy} activeOpacity={0.8}>
              {photoBusy ? (
                <ActivityIndicator color={C.primary} />
              ) : photoPreview ? (
                <>
                  <Image source={{ uri: photoPreview }} style={styles.photoThumb} contentFit="cover" />
                  <Text style={styles.photoBtnText}>Photo attached · tap to change</Text>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>Add a progress photo</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.saveBtn, bodySaving && { opacity: 0.6 }]} onPress={saveBodyEntry} disabled={bodySaving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{bodySaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      {/* ── Injuries / limitations modal ──────────────────────────────────── */}
      {/* `scroll`: single top-level BottomSheetScrollView — see AddWorkoutSheet for
          why a nested one inside a non-scroll TempoSheet leaves "Save" unreachable
          once the option list plus safe-area padding exceeds the 85% snap point. */}
      <TempoSheet visible={injuryModal} onClose={() => setInjuryModal(false)} snapPoints={['85%']} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Injuries & Limitations</Text>
            <Text style={styles.modalHint}>Tell Tempo what to work around. We'll steer your Quick Workouts away from the muscles and movements that aggravate these areas.</Text>

            <View style={{ gap: Spacing.xs, marginTop: Spacing.sm }}>
              {INJURY_OPTIONS.map((o) => {
                const sel = injurySel.includes(o.id)
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[styles.equipRow, sel && styles.equipRowSel]}
                    onPress={() => toggleInjury(o.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.equipIcon, sel && { backgroundColor: C.primary }]}>
                      <Ionicons name={o.icon as any} size={18} color={sel ? '#fff' : C.primary} />
                    </View>
                    <Text style={[styles.equipLabel, sel && { color: C.primary }]}>{o.label}</Text>
                    <Ionicons
                      name={sel ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={sel ? C.primary : C.outlineVariant}
                    />
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity style={[styles.saveBtn, injurySaving && { opacity: 0.6 }]} onPress={saveInjuries} disabled={injurySaving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{injurySaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      {/* ── Edit profile modal ────────────────────────────────────────────── */}
      <TempoSheet visible={editing} onClose={() => setEditing(false)} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <Text style={styles.modalLabel}>DISPLAY NAME</Text>
            <TextInput
              style={styles.modalInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Your name"
              placeholderTextColor={C.outline}
              maxLength={24}
            />

            <Text style={styles.modalLabel}>USERNAME</Text>
            <TextInput
              style={styles.modalInput}
              value={usernameInput}
              onChangeText={(v) => setUsernameInput(v.toLowerCase().replace(/[^a-z0-9_@]/g, ''))}
              placeholder="@username"
              placeholderTextColor={C.outline}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={21}
            />

            <Text style={styles.modalLabel}>AVATAR</Text>
            <View style={styles.avatarPickRow}>
              {AVATAR_PRESETS.map((p) => {
                const sel = p.id === avatarId
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.avatarPick, { backgroundColor: p.color }, sel && styles.avatarPickSel]}
                    onPress={() => setAvatarId(p.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={p.icon as any} size={22} color="#fff" />
                    {sel && (
                      <View style={styles.avatarPickCheck}>
                        <Ionicons name="checkmark-circle" size={18} color={C.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={saveProfile} disabled={saving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      {/* ── Equipment modal ───────────────────────────────────────────────── */}
      {/* `scroll`: see the injuries modal above — same fix, same reason. */}
      <TempoSheet visible={equipModal} onClose={() => setEquipModal(false)} snapPoints={['85%']} scroll>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Your Equipment</Text>
            <Text style={styles.modalHint}>Update this anytime — traveling, home week, or a new gym. It instantly tunes your swaps and Quick Workouts.</Text>

            <View style={{ gap: Spacing.xs, marginTop: Spacing.sm }}>
              {EQUIPMENT_OPTIONS.map((o) => {
                const sel = equipSel.includes(o.id)
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[styles.equipRow, sel && styles.equipRowSel]}
                    onPress={() => toggleEquip(o.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.equipIcon, sel && { backgroundColor: C.primary }]}>
                      <Ionicons name={o.icon as any} size={18} color={sel ? '#fff' : C.primary} />
                    </View>
                    <Text style={[styles.equipLabel, sel && { color: C.primary }]}>{o.label}</Text>
                    <Ionicons
                      name={sel ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={sel ? C.primary : C.outlineVariant}
                    />
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity style={[styles.saveBtn, equipSaving && { opacity: 0.6 }]} onPress={saveEquipment} disabled={equipSaving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{equipSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      {/* ── Swap editor modal ─────────────────────────────────────────────── */}
      <TempoSheet visible={swapModal !== null} onClose={() => setSwapModal(null)}>
          <View style={[styles.modalSheet, sheetPad]}>
            <Text style={styles.modalTitle}>Swap {swapModal?.originalName}</Text>
            <Text style={styles.modalHint}>
              Currently doing <Text style={{ color: C.primary, fontFamily: 'Inter_700Bold' }}>{swapModal?.substituteName}</Text> instead.
              Pick a different alternative, or go back to the original.
            </Text>

            {altsLoading ? (
              <View style={{ paddingVertical: Spacing.xl }}><PulseLoader caption="Loading…" /></View>
            ) : (
              <ScrollView style={{ maxHeight: 300, marginTop: Spacing.sm }} showsVerticalScrollIndicator={false}>
                <View style={{ gap: Spacing.xs }}>
                  {alts.map((a) => {
                    const current = a.id === swapModal?.substituteId
                    return (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.altRow, current && styles.altRowSel]}
                        onPress={() => changeSwapTo(a.id)}
                        disabled={swapBusy}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.altName, current && { color: C.primary }]} numberOfLines={1}>{a.name}</Text>
                        {a.curated && !current && <Text style={styles.altTag}>SUGGESTED</Text>}
                        {current && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </ScrollView>
            )}

            <TouchableOpacity style={[styles.resetBtn, swapBusy && { opacity: 0.6 }]} onPress={resetSwap} disabled={swapBusy} activeOpacity={0.85}>
              <Ionicons name="arrow-undo-outline" size={16} color={C.text} />
              <Text style={styles.resetBtnText}>Use original ({swapModal?.originalName})</Text>
            </TouchableOpacity>
          </View>
      </TempoSheet>

      <OptionSheet
        visible={deleteAccountStage === 'confirm'}
        title="Delete account?"
        subtitle="This permanently deletes your account and all your data — plans, workouts, logs, and progress. This cannot be undone."
        options={[{ key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true }]}
        onSelect={() => setDeleteAccountStage('final')}
        onClose={() => setDeleteAccountStage(null)}
      />
      <OptionSheet
        visible={deleteAccountStage === 'final'}
        title="Are you absolutely sure?"
        subtitle="Your account and every workout you’ve logged will be erased immediately. There’s no way to recover it."
        options={[{ key: 'delete', label: 'Delete forever', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { setDeleteAccountStage(null); runDelete() }}
        onClose={() => setDeleteAccountStage(null)}
      />
      <OptionSheet
        visible={signOutSheetVisible}
        title={session?.user.is_anonymous ? 'Sign out of guest account?' : 'Sign out?'}
        subtitle={session?.user.is_anonymous
          ? 'You’re using a guest account, and guest accounts can’t be signed back into. Signing out permanently loses your plan, workouts, and progress.'
          : 'You can sign back in any time.'}
        options={[{ key: 'signOut', label: session?.user.is_anonymous ? 'Sign out anyway' : 'Sign Out', icon: 'log-out-outline', destructive: true }]}
        onSelect={() => { setSignOutSheetVisible(false); void signOut() }}
        onClose={() => setSignOutSheetVisible(false)}
      />
      <OptionSheet
        visible={removeEventsSheet}
        title="Remove all Tempo events?"
        subtitle="This deletes every Tempo workout event from your connected calendar(s). Your Tempo plan itself is untouched — only the calendar copies are removed."
        options={[{ key: 'remove', label: 'Remove all', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { setRemoveEventsSheet(false); void doRemoveAllTempoEvents() }}
        onClose={() => setRemoveEventsSheet(false)}
      />
      <OptionSheet
        visible={changePlanSheet}
        title="Change Plan"
        subtitle="This will replace your current plan."
        options={[{ key: 'continue', label: 'Continue', icon: 'refresh-outline' }]}
        onSelect={() => { setChangePlanSheet(false); router.push('/onboarding/goal') }}
        onClose={() => setChangePlanSheet(false)}
      />

      <SaveProgressSheet
        visible={saveSheetVisible}
        context="profile"
        onClose={() => setSaveSheetVisible(false)}
        onLinked={() => { refreshProfile().catch(() => {}) }}
      />
    </ScreenTransition>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  friendBadge: {
    position: 'absolute', top: -4, right: -6, minWidth: 15, height: 15, borderRadius: Radius.full,
    backgroundColor: C.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  friendBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: '#fff' },
  badgeCount: {
    position: 'absolute', top: -4, right: -6, minWidth: 15, height: 15, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  headerLogo: { fontFamily: C.fontDisplay, fontSize: 16, color: C.primary, letterSpacing: 2 },
  scroll: { paddingBottom: 120, gap: Spacing.lg },

  // Hero
  // Dark modular profile card: a layered surface, not a solid colour block.
  hero: {
    marginHorizontal: Spacing.containerPadding,
    backgroundColor: C.surfaceContainer,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: C.glassBorder,
    ...Elevation.e2,
  },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroHeaderInfo: { flex: 1, gap: 3 },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEditBtn: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  heroAvatarWrap: {},
  avatarLarge: { width: 68, height: 68, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: C.glassBorder },
  avatarImg: { width: '100%', height: '100%' },
  avatarEditBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: Radius.full,
    backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.surfaceContainer,
  },
  displayName: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, flexShrink: 1 },
  username: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  levelChip: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, marginTop: 2 },
  levelChipText: { fontFamily: C.fontDisplay, fontSize: 11, color: C.primary, letterSpacing: 0.4 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.gold, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  proBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.6 },
  identitySection: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.lg, marginTop: Spacing.md },
  levelBarTrack: { height: 7, alignSelf: 'stretch', backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.full },
  levelBarFill: { height: 7, backgroundColor: C.primary, borderRadius: Radius.full },
  levelHint: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },
  // Secondary stats grid inside the card.
  heroStatsGrid: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.sm, marginTop: 2 },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatValue: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.6 },
  heroStatLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, letterSpacing: 0.2 },
  heroStatDivider: { width: 1, height: 28, backgroundColor: C.outlineVariant },

  // Sections
  section: { paddingHorizontal: Spacing.containerPadding, gap: Spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.1 },
  sectionSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2, marginBottom: Spacing.xs, lineHeight: 18 },
  sectionMeta: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline },
  sectionLink: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },

  // Save-your-progress card (guest-only, §1.1)
  saveCard: {
    marginHorizontal: Spacing.containerPadding,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primarySoft, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: C.primary,
  },
  saveIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center' },
  saveTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, letterSpacing: -0.1 },
  saveBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  // Cards & lists
  card: { backgroundColor: C.background, borderRadius: Radius.xl, ...Elevation.e1, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden' },
  emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, padding: Spacing.md, lineHeight: 19 },

  // Body stats
  bodyRow: { flexDirection: 'row', alignItems: 'stretch', padding: Spacing.md },
  bodyCell: { flex: 1, gap: 3 },
  bodyCellDivider: { width: 1, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.md },
  bodyCellLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  bodyCellValue: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.5 },
  bodyCellUnit: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },
  bodyCellSub: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, marginTop: 1 },
  bodyMetricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, marginTop: -Spacing.xs },
  bodyMetric: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, overflow: 'hidden' },
  bodyMetricVal: { fontFamily: 'Inter_700Bold', color: C.text },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 48,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, justifyContent: 'center',
  },
  photoThumb: { width: 32, height: 32, borderRadius: Radius.sm },
  photoBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },

  // Exercise swaps
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  swapIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  swapInfo: { flex: 1 },
  swapFrom: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  swapTo: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, marginTop: 1 },
  altRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  altRowSel: { borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  altName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  altTag: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.primary, letterSpacing: 0.5, backgroundColor: C.primarySoft, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.full, overflow: 'hidden' },
  resetBtn: {
    height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, marginTop: Spacing.md,
  },
  resetBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },

  // Setting rows
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
  settingIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  settingInfo: { flex: 1 },
  settingLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  settingValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text, marginTop: 1 },
  // Per-rule notification sub-rows (§6.1) — indented under the master switch.
  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, paddingLeft: 64,
  },
  prefLabel: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },
  prefSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 64 },
  changePlanRow: { padding: Spacing.md },
  changePlanText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.primary },

  // Appearance (dark / light) toggle
  themeToggle: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, padding: 3, gap: 3, borderWidth: 1, borderColor: C.outlineVariant },
  themeOpt: { width: 38, height: 30, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  themeOptOn: { backgroundColor: C.primary },
  unitOptText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline, textTransform: 'uppercase' },
  designOpt: { width: 46 },

  signOutBtn: { marginHorizontal: Spacing.containerPadding, height: 52, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  signOutText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.error },
  deleteBtn: { marginHorizontal: Spacing.containerPadding, marginTop: Spacing.sm, height: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.error },
  deleteHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, textAlign: 'center', marginTop: 2 },

  brandFooter: { alignItems: 'center', marginTop: Spacing.xl, marginBottom: Spacing.lg, gap: 8 },
  brandFooterLogo: { width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.outlineVariant },
  brandFooterVersion: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, letterSpacing: 0.2 },

  // Modal
  modalSheet: { padding: Spacing.lg, gap: Spacing.sm },
  modalTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
  modalHint: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 19, marginTop: 2 },
  equipRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
  },
  equipRowSel: { borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  equipIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  equipLabel: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  modalLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.sm },
  modalInput: {
    height: 48, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text,
  },
  avatarPickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  avatarPick: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarPickSel: { borderWidth: 3, borderColor: C.text },
  avatarPickCheck: { position: 'absolute', bottom: -3, right: -3, backgroundColor: '#fff', borderRadius: Radius.full },
  saveBtn: { height: 52, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
