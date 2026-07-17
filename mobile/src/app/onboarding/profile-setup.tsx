import { useState } from 'react'
import {
  StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoWordmark } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { AVATAR_PRESETS, buildAvatarValue, parseAvatar } from '@/lib/avatar'
import { logMeasurement } from '@/lib/bodyMeasurements'
import { useUnitStore, unitLabel, inputToLbs } from '@/lib/units'
import { Slider } from '@/components/Slider'
import { track } from '@/lib/analytics'


// Last onboarding step — runs after the plan is built (see plan-preview). Lets a
// new user put a name + avatar on their profile before entering the app. It's
// optional (everything here is editable later from the Profile tab), so "Skip"
// just drops straight into the app. onboarding_complete was already set when the
// plan was generated, so bailing here never traps the user back in onboarding.
export default function ProfileSetupScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
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
  // Starting weight (optional): the seed for the weight-trend engine and the goal
  // countdown — without it those flagship surfaces stay dark until the user finds
  // "Log entry" in Profile → Body Stats, which most never do.
  const [weight, setWeight] = useState('')
  const [weightEditing, setWeightEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const unit = useUnitStore((s) => s.unit)
  const weightSliderDefault = unit === 'kg' ? 75 : 165
  const weightRange = unit === 'kg' ? { min: 36, max: 180 } : { min: 80, max: 400 }

  if (!session) return <Redirect href="/sign-in" />

  const preset = AVATAR_PRESETS.find(p => p.id === avatarId) ?? AVATAR_PRESETS[0]
  const firstName = name.trim().split(' ')[0]

  const enterApp = () => { track('profile_setup_skipped'); router.replace('/(tabs)') }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      // Input arrives in the display unit; storage is always lbs.
      const weightLbs = inputToLbs(weight, unit)
      const validWeight = weightLbs != null && weightLbs >= 50 && weightLbs <= 1000
      const { error } = await supabase
        .from('user_profiles')
        .update({
          display_name: name.trim() || null,
          avatar_url: buildAvatarValue(preset.icon, preset.color),
          ...(validWeight ? { bodyweight_lbs: weightLbs } : {}),
        })
        .eq('user_id', session.user.id)
      if (error) throw error
      // First body-measurement entry — powers the weight trend + goal countdown
      // from day one. Best-effort; profile save above is what matters.
      if (validWeight) {
        try { await logMeasurement(supabase, session.user.id, { weight_lbs: weightLbs }) } catch {}
      }
      await refreshProfile().catch(() => {})
      track('profile_setup_completed', { has_name: !!name.trim(), has_weight: validWeight })
      router.replace('/(tabs)')
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
        <TempoWordmark size={16} />
        <TouchableOpacity onPress={enterApp} disabled={saving} hitSlop={8}>
          <Text style={[styles.skipTop, saving && { opacity: 0.4 }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar — plan done, this is the last touch */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '100%' }]} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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

        <Text style={styles.fieldLabel}>CURRENT WEIGHT (OPTIONAL)</Text>
        <View style={styles.weightBig}>
          <Text style={styles.weightBigNum}>{weight || String(weightSliderDefault)}</Text>
          <Text style={styles.weightBigUnit}>{unitLabel(unit)}</Text>
        </View>
        <Slider
          value={Number(weight) || weightSliderDefault}
          min={weightRange.min}
          max={weightRange.max}
          onChange={(v) => setWeight(String(v))}
          accessibilityLabel="Current weight"
        />
        <TouchableOpacity onPress={() => setWeightEditing(true)} hitSlop={8}>
          <Text style={styles.weightTypeLink}>{weight ? 'Type an exact number' : "I'd rather type it"}</Text>
        </TouchableOpacity>
        {weightEditing && (
          <View style={styles.weightRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={weight}
              onChangeText={setWeight}
              placeholder={unit === 'kg' ? 'e.g. 75' : 'e.g. 165'}
              placeholderTextColor={C.outline}
              keyboardType="decimal-pad"
              maxLength={6}
              returnKeyType="done"
              autoFocus
            />
            <Text style={styles.weightUnit}>{unitLabel(unit)}</Text>
          </View>
        )}
        <Text style={styles.weightHint}>
          Starts your weight trend and goal countdown — Tempo projects when you'll hit your goal. Drag
          to set it, or leave it and skip for now.
        </Text>

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
        <PressableScale
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
        </PressableScale>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  logo: { fontFamily: C.fontDisplay, fontSize: 15, color: C.primary, letterSpacing: 2 },
  skipTop: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.textSecondary },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.lg },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl, gap: Spacing.md },
  stepLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  title: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.28, lineHeight: 34 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, color: C.textSecondary, lineHeight: 22 },

  preview: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  avatarLarge: {
    width: 84, height: 84, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', ...Elevation.e1,
  },
  previewName: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.2 },

  fieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  input: {
    height: 52, backgroundColor: C.background, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md,
    fontFamily: 'Inter_500Medium', fontSize: 16, color: C.text,
  },

  weightBig: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6, marginTop: Spacing.xs },
  weightBigNum: { fontFamily: C.fontNumeric, fontSize: 44, color: C.text, letterSpacing: -1 },
  weightBigUnit: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.textSecondary, marginBottom: 6 },
  weightTypeLink: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, textAlign: 'center', marginTop: Spacing.xs },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  weightUnit: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.textSecondary },
  weightHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, lineHeight: 17 },

  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  avatarPick: { width: 56, height: 56, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarPickSel: { borderWidth: 3, borderColor: C.text },
  avatarPickCheck: { position: 'absolute', bottom: -3, right: -3, backgroundColor: '#fff', borderRadius: Radius.full },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
  continueBtn: { height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  continueBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
