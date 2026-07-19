// Tempo — the GO chooser (bottom sheet).
//
// Tapping GO when today's plan still has a session due used to jump straight into
// it with no way to choose otherwise. Now it offers a genuine choice: continue that
// session, or build a Quick Workout instead (e.g. plans changed and a shorter
// at-home session fits better right now). Only shown when a session is actually
// due — GO's no-session fallback (auto-generate + start) is untouched.

import { View, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { TempoSheet } from '@/components/TempoSheet'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius, Elevation, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'

function formatTime12(hhmmss: string): string {
  const [hStr, mStr] = hhmmss.split(':')
  const h = Number(hStr); const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

interface Props {
  visible: boolean
  focus: string
  time: string           // 'HH:MM:SS'
  onContinue: () => void
  onQuick: () => void
  onClose: () => void
}

export function GoChooserSheet({ visible, focus, time, onContinue, onQuick, onClose }: Props) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const niceTime = formatTime12(time)

  return (
    <TempoSheet visible={visible} onClose={onClose}>
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <Text style={s.title}>What's next?</Text>
        <Text style={s.subtitle}>You've got a session on deck — or fit in something faster right now.</Text>

        <PressableScale style={s.cardPrimary} onPress={onContinue} scaleTo={0.98}>
          <View style={s.cardIconPrimary}><Ionicons name="barbell" size={22} color={C.onPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTagPrimary}>TODAY'S PLAN</Text>
            <Text style={s.cardTitlePrimary} numberOfLines={1}>{focus}</Text>
            {!!niceTime && <Text style={s.cardSubPrimary}>{niceTime}</Text>}
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.onPrimary} />
        </PressableScale>

        <PressableScale style={s.cardGhost} onPress={onQuick} scaleTo={0.98}>
          <View style={s.cardIconGhost}><Ionicons name="flash" size={19} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTagGhost}>SHORT ON TIME?</Text>
            <Text style={s.cardTitleGhost}>Quick Workout instead</Text>
            <Text style={s.cardSubGhost}>Pick your time — Tempo builds a session that fits.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.primary} />
        </PressableScale>
      </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 19, marginTop: -6 },

  cardPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.primary, borderRadius: Radius.xl, padding: Spacing.lg, ...Elevation.e2,
  },
  cardIconPrimary: { width: 44, height: 44, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  cardTagPrimary: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.6 },
  cardTitlePrimary: { fontFamily: C.fontDisplay, fontSize: 18, color: C.onPrimary, letterSpacing: -0.2, marginTop: 1 },
  cardSubPrimary: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 },

  cardGhost: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: C.outlineVariant,
  },
  cardIconGhost: { width: 40, height: 40, borderRadius: Radius.lg, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardTagGhost: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, color: C.outline, letterSpacing: 0.6 },
  cardTitleGhost: { fontFamily: C.fontDisplay, fontSize: 16, color: C.text, letterSpacing: -0.2, marginTop: 1 },
  cardSubGhost: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1, lineHeight: 16 },
})
