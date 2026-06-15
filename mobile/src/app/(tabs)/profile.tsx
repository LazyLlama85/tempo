import { ScrollView, TouchableOpacity, View, Text, StyleSheet, Alert, Linking } from 'react-native'
import { useState, useEffect } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { useAuthStore } from '@/stores/auth'
import { useProgressStats } from '@/hooks/useProgressStats'
import { requestCalendarPermissions, getCalendarPermissionStatus } from '@/services/calendarService'

const C = Colors.light

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

type SettingRowProps = { icon: string; label: string; value: string; onPress?: () => void }
function SettingRow({ icon, label, value, onPress }: SettingRowProps) {
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon as any} size={18} color={C.primary} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />
    </TouchableOpacity>
  )
}

export default function ProfileScreen() {
  const router = useRouter()
  const { profile, session, signOut } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { stats, isLoading: statsLoading } = useProgressStats(userId)
  const [calendarStatus, setCalendarStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null)

  useEffect(() => {
    getCalendarPermissionStatus().then(setCalendarStatus)
  }, [])

  const handleCalendarIntegration = async () => {
    if (calendarStatus === 'granted') {
      Alert.alert('Calendar Connected', 'Add workouts to your device calendar from the Schedule tab.')
    } else if (calendarStatus === 'denied') {
      Alert.alert('Permission Denied', 'Allow Tempo to access your calendar in Settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ])
    } else {
      const granted = await requestCalendarPermissions()
      const newStatus = granted ? 'granted' : 'denied'
      setCalendarStatus(newStatus)
      if (granted) Alert.alert('Calendar Connected', 'Add workouts to your device calendar from the Schedule tab.')
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLogo}>TEMPO</Text>
        <TouchableOpacity style={styles.avatar} onPress={() => Alert.alert('Profile Photo', 'Avatar customization coming soon.')}>
          <Ionicons name="person" size={18} color={C.onPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Avatar section */}
        <View style={styles.profileSection}>
          <View style={styles.avatarLarge}>
            <Ionicons name="person" size={36} color={C.onPrimary} />
          </View>
          <Text style={styles.displayName}>{profile?.display_name ?? 'Athlete'}</Text>
          <Text style={styles.memberSince}>
            Member since{' '}
            {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : new Date().getFullYear()}
          </Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: 'WORKOUTS', value: statsLoading ? '—' : String(stats.totalWorkouts) },
            { label: 'THIS WEEK', value: statsLoading ? '—' : String(stats.thisWeek) },
            { label: 'STREAK', value: statsLoading ? '—' : (stats.streak > 0 ? `${stats.streak}d` : '0') },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* My Plan section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Plan</Text>
          <View style={styles.card}>
            <SettingRow icon="trophy-outline" label="PRIMARY GOAL" value={profile?.goal ? GOAL_LABELS[profile.goal] : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="barbell-outline" label="EXPERIENCE" value={profile?.experience ? EXP_LABELS[profile.experience] : '—'} />
            <View style={styles.divider} />
            <SettingRow icon="calendar-outline" label="DAYS PER WEEK" value={profile?.days_per_week ? `${profile.days_per_week} days` : '—'} />
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.changePlanRow}
              onPress={() =>
                Alert.alert('Change Plan', 'This will replace your current plan.', [
                  { text: 'Cancel' },
                  {
                    text: 'Continue',
                    onPress: () => {
                      router.push('/onboarding/goal')
                    },
                  },
                ])
              }
            >
              <Text style={styles.changePlanText}>Change Plan</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Integrations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Integrations</Text>
          <View style={styles.card}>
            <SettingRow
              icon="calendar-outline"
              label="DEVICE CALENDAR"
              value={
                calendarStatus === 'granted' ? 'Connected' :
                calendarStatus === 'denied' ? 'Permission denied' : 'Not connected'
              }
              onPress={handleCalendarIntegration}
            />
          </View>
        </View>

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <SettingRow icon="notifications-outline" label="NOTIFICATIONS" value="On" onPress={() => Linking.openSettings()} />
            <View style={styles.divider} />
            <SettingRow icon="shield-outline" label="PRIVACY" value="" onPress={() => Alert.alert('Privacy Policy', 'Review our privacy policy at tempo.app/privacy.')} />
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={signOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md },
  headerLogo: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.primary, letterSpacing: 2 },
  avatar: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 120 },
  profileSection: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  avatarLarge: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  displayName: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.2 },
  memberSince: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary },
  statsRow: { flexDirection: 'row', marginHorizontal: Spacing.containerPadding, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.lg },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: C.text, letterSpacing: -0.3 },
  statLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  section: { paddingHorizontal: Spacing.containerPadding, marginBottom: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.1 },
  card: { backgroundColor: C.background, borderRadius: Radius.xl, ...CardShadow, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
  settingIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  settingInfo: { flex: 1 },
  settingLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  settingValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text, marginTop: 1 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 64 },
  signOutBtn: { marginHorizontal: Spacing.containerPadding, height: 52, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xl },
  signOutText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.error },
  changePlanRow: { padding: Spacing.md },
  changePlanText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.primary },
})
