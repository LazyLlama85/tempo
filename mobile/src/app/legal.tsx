// Tempo — in-app Privacy Policy & Terms.
//
// The App Store (Guideline 5.1.1) requires a privacy policy that's accessible from
// within the app, not just a URL buried in metadata. Keeping it in-app means it
// always resolves for the reviewer (no dependency on a marketing site being live).
// This is a plain-language summary of what Tempo actually collects and does; have it
// reviewed by counsel before public launch and mirror it at your privacy URL.

import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Colors, Spacing, Radius } from '@/constants/theme'

const C = Colors.light

const UPDATED = 'June 2026'
const SUPPORT_EMAIL = 'fittempo.app@gmail.com'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  )
}
function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.p}>{children}</Text>
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  )
}

export default function LegalScreen() {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & Terms</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Privacy Policy</Text>
        <Text style={styles.updated}>Last updated {UPDATED}</Text>

        <Section title="What we collect">
          <P>Tempo stores only what it needs to plan and track your training:</P>
          <Bullet>Account: your email and sign-in identity (via Apple, Google, or guest).</Bullet>
          <Bullet>Profile: goal, experience, equipment, availability, and the preferences you set.</Bullet>
          <Bullet>Training data: your plans, scheduled workouts, logged sets, reps, weights, RPE, and recovery check-ins.</Bullet>
          <Bullet>Calendar: if you grant access, Tempo reads your busy times to schedule workouts around them. Event details are used on your device to find free time and are not sold or shared.</Bullet>
        </Section>

        <Section title="How we use it">
          <P>Your data is used to generate your plan, schedule sessions around your real life, track progress, and personalize recommendations. We don’t sell your personal data, and we don’t use it for third-party advertising.</P>
        </Section>

        <Section title="Calendar access">
          <P>Calendar permission is optional and used solely to find open time for workouts. You can revoke it anytime in your device settings, and Tempo keeps working without it. If you connect Google Calendar, your access is stored securely server-side and removed when you disconnect or delete your account.</P>
        </Section>

        <Section title="Storage & security">
          <P>Your data is stored with our backend provider (Supabase) and protected so that only you can access your own records. Sensitive tokens are kept server-side and never shipped in the app.</P>
        </Section>

        <Section title="Deleting your account">
          <P>You can permanently delete your account and all associated data at any time from Profile → Delete Account. This removes your profile, plans, workouts, logs, recovery data, and any connected-calendar tokens immediately and cannot be undone.</P>
        </Section>

        <Section title="Contact">
          <P>Questions about your privacy or data? Reach us at {SUPPORT_EMAIL}.</P>
        </Section>

        <View style={styles.divider} />

        <Text style={styles.h1}>Terms of Use</Text>
        <Text style={styles.updated}>Last updated {UPDATED}</Text>

        <Section title="Acceptance">
          <P>By using Tempo you agree to these terms. If you don’t agree, please don’t use the app.</P>
        </Section>

        <Section title="Not medical advice">
          <P>Tempo provides general fitness guidance for informational purposes only. It is not medical advice. Exercise carries inherent risks — consult a qualified professional before starting any program, and stop if you feel pain or discomfort. You train at your own risk.</P>
        </Section>

        <Section title="Your responsibilities">
          <Bullet>Provide accurate information so recommendations fit you.</Bullet>
          <Bullet>Use the app for your personal, non-commercial training.</Bullet>
          <Bullet>Keep your account secure.</Bullet>
        </Section>

        <Section title="Availability & changes">
          <P>We work to keep Tempo reliable but provide it “as is,” without warranties, and may update or change features over time. We may update these terms; continued use means you accept the changes.</P>
        </Section>

        <Section title="Contact">
          <P>Questions about these terms? Reach us at {SUPPORT_EMAIL}.</P>
        </Section>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.sm,
  },
  headerTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.text, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xl },

  h1: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, color: C.text, letterSpacing: -0.4, marginTop: Spacing.sm },
  updated: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, marginTop: 2, marginBottom: Spacing.sm },

  section: { marginTop: Spacing.md },
  h2: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, marginBottom: Spacing.xs, letterSpacing: -0.1 },
  p: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },

  bulletRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: 6 },
  bulletDot: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary, lineHeight: 21 },
  bulletText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 21 },

  divider: { height: 1, backgroundColor: C.outlineVariant, marginVertical: Spacing.lg },
})
