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

type TodayState = 'due' | 'complete' | 'none'

interface Props {
  visible: boolean
  /** due = a session is still on deck; complete = today's already trained; none = a rest day. */
  todayState: TodayState
  focus: string
  time: string           // 'HH:MM:SS'
  onContinue: () => void
  onQuick: () => void
  onClose: () => void
}

const SHEET_COPY: Record<TodayState, { title: string; subtitle: string }> = {
  due: { title: "What's next?", subtitle: "You've got a session on deck — or fit in something faster right now." },
  complete: { title: 'Already trained today', subtitle: "Today's session is done — want to fit in something extra?" },
  none: { title: 'Nothing on the books', subtitle: "No session scheduled today — take the rest, or train anyway." },
}

export function GoChooserSheet({ visible, todayState, focus, time, onContinue, onQuick, onClose }: Props) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const niceTime = formatTime12(time)
  const copy = SHEET_COPY[todayState]
  const due = todayState === 'due'

  return (
    <TempoSheet visible={visible} onClose={onClose} scroll>
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <Text style={s.title}>{copy.title}</Text>
        <Text style={s.subtitle}>{copy.subtitle}</Text>

        <PressableScale
          style={[s.cardPrimary, !due && s.cardPrimaryDisabled]}
          onPress={onContinue}
          disabled={!due}
          scaleTo={0.98}
          accessibilityState={{ disabled: !due }}
        >
          <View style={[s.cardIconPrimary, !due && s.cardIconPrimaryDisabled]}>
            <Ionicons
              name={due ? 'barbell' : todayState === 'complete' ? 'checkmark-circle' : 'moon'}
              size={22}
              color={due ? C.onPrimary : C.textSecondary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardTagPrimary, !due && s.cardTagPrimaryDisabled]}>TODAY'S PLAN</Text>
            {due ? (
              <>
                <Text style={s.cardTitlePrimary} numberOfLines={1}>{focus}</Text>
                {!!niceTime && <Text style={s.cardSubPrimary}>{niceTime}</Text>}
              </>
            ) : (
              <Text style={s.cardTitlePrimaryDisabled} numberOfLines={1}>
                {todayState === 'complete' ? 'Complete — nice work' : 'No session scheduled today'}
              </Text>
            )}
          </View>
          {due && <Ionicons name="chevron-forward" size={18} color={C.onPrimary} />}
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
  cardPrimaryDisabled: {
    backgroundColor: C.surfaceContainerLow, borderWidth: 1.5, borderColor: C.outlineVariant, ...Elevation.e0,
  },
  cardIconPrimary: { width: 44, height: 44, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  cardIconPrimaryDisabled: { backgroundColor: C.surfaceContainerHigh },
  cardTagPrimary: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.6 },
  cardTagPrimaryDisabled: { color: C.outline },
  cardTitlePrimary: { fontFamily: C.fontDisplay, fontSize: 18, color: C.onPrimary, letterSpacing: -0.2, marginTop: 1 },
  cardTitlePrimaryDisabled: { fontFamily: C.fontDisplay, fontSize: 16, color: C.textSecondary, letterSpacing: -0.2, marginTop: 1 },
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
