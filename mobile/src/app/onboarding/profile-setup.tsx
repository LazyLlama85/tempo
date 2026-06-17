import { useState } from 'react'
import {
  StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput,
  Alert, ActivityIndicator,
} from 'react-native'
import { useRouter, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, CardShadow } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { AVATAR_PRESETS, buildAvatarValue, parseAvatar } from '@/lib/avatar'

const C = Colors.light

// Last onboarding step — runs after the plan is built (see plan-preview). Lets a
// new user put a name + avatar on their profile before entering the app. It's
// optional (everything here is editable later from the Profile tab), so "Skip"
// just drops straight into the app. onboarding_complete was already set when the
// plan was generated, so bailing here never traps the user back in onboarding.
export default function ProfileSetupScreen() {
  const router = useRouter()
  const { session, profile, refreshProfile } = useAuthStore()

  // Pre-fill from anything we already know (e.g. a Google display name), and match
  // the current avatar to a preset so returning users see their existing choice.
  const existing = parseAvatar(profile?.avatar_url)
  const presetMatch = AVATAR_PRESETS.find(p => p.icon === existing.icon && p.color === existing.color)

  const [name, setName] = useState(
    profile?.display_name ?? (session?.user.user_metadata?.full_name as string | undefined) ?? ''
  )
  const [avatarId, setAvatarId] = useState(presetMatch?.id ?? AVATAR_PRESETS[0].id)
  const [saving, setSaving] = useState(false)

  if (!session) return <Redirect href="/sign-in" />

  const preset = AVATAR_PRESETS.find(p => p.id === avatarId) ?? AVATAR_PRESETS[0]
  const firstName = name.trim().split(' ')[0]

  const enterApp = () => router.replace('/(tabs)')

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await supabase
        .from('user_profiles')
        .update({
          display_name: name.trim() || null,
          avatar_url: buildAvatarValue(preset.icon, preset.color),
        })
        .eq('user_id', session.user.id)
      await refreshProfile()
      enterApp()
    } catch {
      setSaving(false)
      Alert.alert('Could not save', 'Please try again, or skip for now.')
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header — no back: the plan is already built, this is the finish line */}
      <View style={styles.header}>
        <View style={{ width: 38 }} />
        <Text style={styles.logo}>TEMPO</Text>
        <TouchableOpacity onPress={enterApp} disabled={saving} hitSlop={8}>
          <Text style={[styles.skipTop, saving && { opacity: 0.4 }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar — plan done, this is the last touch */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '100%' }]} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.stepLabel}>LAST STEP</Text>
        <Text style={styles.title}>Make it yours.</Text>
        <Text style={styles.subtitle}>Add a name and pick an avatar — you'll see these across your profile and progress.</Text>

        {/* Live preview */}
        <View style={styles.preview}>
          <View style={[styles.avatarLarge, { backgroundColor: preset.color }]}>
            <Ionicons name={preset.icon as any} size={40} color="#fff" />
          </View>
          <Text style={styles.previewName}>{firstName || 'Athlete'}</Text>
        </View>

        <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={C.outline}
          maxLength={24}
          autoCapitalize="words"
          returnKeyType="done"
        />

        <Text style={styles.fieldLabel}>AVATAR</Text>
        <View style={styles.avatarGrid}>
          {AVATAR_PRESETS.map((p) => {
            const sel = p.id === avatarId
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.avatarPick, { backgroundColor: p.color }, sel && styles.avatarPickSel]}
                onPress={() => setAvatarId(p.id)}
                activeOpacity={0.85}
              >
                <Ionicons name={p.icon as any} size={24} color="#fff" />
                {sel && (
                  <View style={styles.avatarPickCheck}>
                    <Ionicons name="checkmark-circle" size={18} color={C.primary} />
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <Text style={styles.continueBtnText}>Enter Tempo →</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  logo: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: C.primary, letterSpacing: 2 },
  skipTop: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },

  preview: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  avatarLarge: {
    width: 84, height: 84, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', ...CardShadow,
  },
  previewName: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.text, letterSpacing: -0.2 },

  fieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  input: {
    height: 52, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text,
  },

  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  avatarPick: { width: 56, height: 56, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarPickSel: { borderWidth: 3, borderColor: C.text },
  avatarPickCheck: { position: 'absolute', bottom: -3, right: -3, backgroundColor: '#fff', borderRadius: Radius.full },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
