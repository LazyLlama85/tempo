// Tempo — Training tab hub segments.
//
// The Train hub's top navigation: a premium segmented control (Readiness / Splits /
// Workouts / Session) plus the inline views for each. Kept strictly to TRAINING —
// no Progress analytics, no Calendar scheduling. Splits/Workouts actions route to
// the existing my-splits / my-workouts screens (single source of truth); this layer
// only makes them premium + discoverable from the hub. Pure/presentational — the
// screen fetches the data and passes it in.

import { useState, type ReactNode } from 'react'
import { View, Text, StyleSheet, TextInput } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Spacing, Radius, Elevation } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { FadeInView, PressableScale } from '@/components/motion'
import { CountUp } from '@/components/celebration'
import { SvgProgressRing } from '@/components/SvgProgressRing'
import { HeroGlow } from '@/components/HeroGlow'
import { MuscleMap, type MuscleGroup, type MapBubble } from '@/components/MuscleMap'
import type { Readiness, Intensity, MuscleRecoveryResult, RecoveryStatus, MuscleStatus } from '@/lib/fitnessInsights'
import type { Split, WorkoutTemplate } from '@/types'

export type TrainSeg = 'readiness' | 'splits' | 'workouts' | 'session'

type IconName = keyof typeof Ionicons.glyphMap
const SEG_META: { key: TrainSeg; label: string; icon: IconName; tint: (c: Palette) => string }[] = [
  { key: 'session', label: 'Session', icon: 'play', tint: (c) => c.primary },
  { key: 'readiness', label: 'Readiness', icon: 'pulse', tint: (c) => c.success },
  { key: 'splits', label: 'Splits', icon: 'repeat', tint: (c) => c.ember },
  { key: 'workouts', label: 'Workouts', icon: 'barbell', tint: (c) => c.gold },
]

// ── Segmented control ───────────────────────────────────────────────────────────

export function TrainSegments({ value, onChange }: { value: TrainSeg; onChange: (s: TrainSeg) => void }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  return (
    <View style={s.segBar}>
      {SEG_META.map((m) => {
        const active = m.key === value
        const tint = m.tint(C)
        return (
          <PressableScale key={m.key} style={[s.segItem, active && s.segItemActive]} scaleTo={0.94} onPress={() => onChange(m.key)}>
            <Ionicons name={m.icon} size={18} color={active ? tint : C.outline} />
            <Text style={[s.segLabel, active && { color: C.text }]} numberOfLines={1}>{m.label}</Text>
          </PressableScale>
        )
      })}
    </View>
  )
}

// ── Readiness view (workout-focused; NOT the Progress recovery dashboard) ─────────

const STATUS_COLOR = (C: Palette, st: RecoveryStatus) =>
  st === 'recovered' ? C.readyHigh : st === 'recovering' ? C.readyMed : st === 'fatigued' ? C.readyLow : C.primary

const MUSCLE_LABEL: Record<string, string> = { chest: 'Chest', back: 'Back', legs: 'Legs', shoulders: 'Shoulders', arms: 'Arms' }

export function TrainReadinessView({
  readiness, intensity, muscle, locked = false, onUnlock,
}: { readiness: Readiness; intensity: Intensity; muscle: MuscleRecoveryResult; locked?: boolean; onUnlock?: () => void }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const band = readiness.score >= 80 ? C.readyHigh : readiness.score >= 55 ? C.readyMed : C.readyLow
  const bandGlow = readiness.score >= 80 ? 'rgba(34,197,94,0.16)' : readiness.score >= 55 ? C.goldGlow : C.emberGlow
  const intTint = intensity.label === 'Hard' ? C.readyHigh : intensity.label === 'Moderate' ? C.readyMed : C.readyLow

  // Body map: colour each muscle by its recovery, and bubble the % on the least-recovered.
  const recToStatus = (st: RecoveryStatus): MuscleStatus | undefined =>
    st === 'recovered' ? 'optimal' : st === 'recovering' ? 'attention' : st === 'fatigued' ? 'fatigued' : undefined
  const pct = (hours: number | null) => (hours == null ? 100 : Math.min(100, Math.round((hours / 48) * 100)))
  const statusByGroup: Partial<Record<MuscleGroup, MuscleStatus>> = {}
  for (const g of muscle.groups) { const m = recToStatus(g.status); if (m) statusByGroup[g.group as MuscleGroup] = m }
  const bubbles: MapBubble[] | undefined = locked
    ? undefined
    : [...muscle.groups].filter((g) => g.hours != null).sort((a, b) => pct(a.hours) - pct(b.hours)).slice(0, 3)
        .map((g) => ({ group: g.group as MuscleGroup, text: `${pct(g.hours)}%`, tone: STATUS_COLOR(C, g.status) }))

  return (
    <FadeInView key="readiness" style={s.card}>
      <View style={s.rowBetween}>
        <Text style={s.cardLabel}>WORKOUT READINESS</Text>
        <Text style={[s.pill, { color: intTint, borderColor: intTint }]}>{intensity.label.toUpperCase()}</Text>
      </View>

      <View style={s.readyTop}>
        <View style={s.readyRingWrap}>
          <HeroGlow color={bandGlow} size={128} />
          <SvgProgressRing value={readiness.score} size={100} stroke={11} gradientFrom={band} gradientTo={band}>
            <CountUp value={readiness.score} style={[s.readyNum, { color: band }]} />
          </SvgProgressRing>
        </View>
        <View style={s.readyRight}>
          <Text style={s.readyIntensity}>{intensity.blurb}</Text>
          <View style={s.recBox}>
            <Ionicons name="bulb" size={14} color={C.primary} />
            <Text style={s.recText}>Recommended today: <Text style={{ color: C.text, fontFamily: 'Inter_700Bold' }}>{muscle.recommendedFocus}</Text></Text>
          </View>
        </View>
      </View>

      {/* Recovery body map — Muscle Intelligence (Pro). Free users see a dimmed teaser. */}
      <View style={s.readyBodyWrap}>
        <MuscleMap view="front" statusByGroup={statusByGroup} bubbles={bubbles} dimmed={locked} size={150} />
        {locked && (
          <View style={s.readyLockOverlay}>
            <Ionicons name="lock-closed" size={20} color={C.onPrimary} />
            <Text style={s.readyLockText}>Recovery by muscle</Text>
            {onUnlock && (
              <PressableScale style={s.readyUnlockBtn} scaleTo={0.96} onPress={onUnlock}>
                <Text style={s.readyUnlockText}>Unlock Muscle Intelligence</Text>
              </PressableScale>
            )}
          </View>
        )}
      </View>

      {!locked && (
        <View style={s.muscleList}>
          {muscle.groups.map((g) => (
            <View key={g.group} style={s.muscleRow}>
              <View style={[s.muscleDot, { backgroundColor: STATUS_COLOR(C, g.status) }]} />
              <Text style={s.muscleName}>{MUSCLE_LABEL[g.group] ?? g.group}</Text>
              <Text style={[s.muscleStatus, { color: STATUS_COLOR(C, g.status) }]}>{g.label}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={s.readyFoot}>Recovery is estimated from your recent sessions — it helps you pick today's workout.</Text>
    </FadeInView>
  )
}

// ── Splits view ───────────────────────────────────────────────────────────────--

function daysPerWeek(split: Split): number {
  return split.days.filter((d) => !d.rest).length
}
function splitLabels(split: Split): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of split.days) {
    if (d.rest) continue
    const l = (d.label || '').trim()
    if (l && !seen.has(l.toLowerCase())) { seen.add(l.toLowerCase()); out.push(l) }
  }
  return out.slice(0, 4)
}

export function SplitsView({
  splits, loading, onOpenSplit, onManage,
}: { splits: Split[]; loading: boolean; onOpenSplit: (id: string) => void; onManage: () => void }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  return (
    <FadeInView key="splits" style={{ gap: Spacing.md }}>
      <View style={s.rowBetween}>
        <Text style={s.sectionTitle}>Your Splits</Text>
        <PressableScale scaleTo={0.95} onPress={onManage}><Text style={s.sectionAction}>Manage →</Text></PressableScale>
      </View>
      {loading ? (
        <Text style={s.emptyText}>Loading your splits…</Text>
      ) : splits.length === 0 ? (
        <EmptyBlock icon="repeat" title="No splits yet" body="A split is your weekly training pattern — Push/Pull/Legs, Upper/Lower, and more." actionLabel="Create a split" onAction={onManage} />
      ) : (
        splits.map((sp) => (
          <PressableScale key={sp.id} style={[s.itemCard, sp.is_active && { borderColor: C.emberLine }]} scaleTo={0.98} onPress={() => onOpenSplit(sp.id)}>
            <View style={[s.itemIcon, { backgroundColor: C.emberSoft }]}><Ionicons name="repeat" size={20} color={C.ember} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={s.itemTitleRow}>
                <Text style={s.itemName} numberOfLines={1}>{sp.name}</Text>
                {sp.is_active && (
                  <View style={s.activeBadge}><Ionicons name="checkmark-circle" size={12} color={C.success} /><Text style={s.activeBadgeText}>ACTIVE</Text></View>
                )}
              </View>
              <Text style={s.itemMeta}>{daysPerWeek(sp)} day{daysPerWeek(sp) === 1 ? '' : 's'}/week{sp.kind === 'auto' ? ' · Tempo' : sp.kind === 'custom' ? ' · Yours' : ''}</Text>
              {splitLabels(sp).length > 0 && (
                <View style={s.chipRow}>
                  {splitLabels(sp).map((l, i) => (
                    <View key={i} style={s.muscleChip}><Text style={s.muscleChipText}>{l}</Text></View>
                  ))}
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.outline} />
          </PressableScale>
        ))
      )}
    </FadeInView>
  )
}

// ── Workouts view ───────────────────────────────────────────────────────────────

export function WorkoutsView({
  templates, loading, onOpenWorkout, onBrowse, onCreate,
}: { templates: WorkoutTemplate[]; loading: boolean; onOpenWorkout: (id: string) => void; onBrowse: () => void; onCreate: () => void }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  const [q, setQ] = useState('')
  const filtered = q.trim() ? templates.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())) : templates

  return (
    <FadeInView key="workouts" style={{ gap: Spacing.md }}>
      <View style={s.rowBetween}>
        <Text style={s.sectionTitle}>Your Workouts</Text>
        <PressableScale scaleTo={0.95} onPress={onBrowse}><Text style={s.sectionAction}>Browse all →</Text></PressableScale>
      </View>

      {templates.length > 0 && (
        <View style={s.searchBox}>
          <Ionicons name="search" size={16} color={C.outline} />
          <TextInput
            style={s.searchInput}
            placeholder="Search your workouts"
            placeholderTextColor={C.outline}
            value={q}
            onChangeText={setQ}
            returnKeyType="search"
          />
          {q.length > 0 && (
            <PressableScale scaleTo={0.9} onPress={() => setQ('')}><Ionicons name="close-circle" size={16} color={C.outline} /></PressableScale>
          )}
        </View>
      )}

      {loading ? (
        <Text style={s.emptyText}>Loading your workouts…</Text>
      ) : templates.length === 0 ? (
        <EmptyBlock icon="barbell" title="No saved workouts" body="Build a reusable workout template, or save one from any session." actionLabel="Create a workout" onAction={onCreate} />
      ) : filtered.length === 0 ? (
        <Text style={s.emptyText}>No workouts match “{q}”.</Text>
      ) : (
        filtered.map((t) => (
          <PressableScale key={t.id} style={s.itemCard} scaleTo={0.98} onPress={() => onOpenWorkout(t.id)}>
            <View style={[s.itemIcon, { backgroundColor: C.primarySoft }]}><Ionicons name="barbell" size={20} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.itemName} numberOfLines={1}>{t.name}</Text>
              <Text style={s.itemMeta}>{t.exercise_ids.length} exercise{t.exercise_ids.length === 1 ? '' : 's'} · ~{t.est_duration_min} min</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.outline} />
          </PressableScale>
        ))
      )}
    </FadeInView>
  )
}

// ── Shared empty block ────────────────────────────────────────────────────────--

function EmptyBlock({ icon, title, body, actionLabel, onAction }: { icon: IconName; title: string; body: string; actionLabel: string; onAction: () => void }) {
  const C = useTheme()
  const s = useThemedStyles(makeStyles)
  return (
    <View style={s.emptyBlock}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={26} color={C.outline} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      <PressableScale style={s.emptyBtn} scaleTo={0.96} onPress={onAction}>
        <Text style={s.emptyBtnText}>{actionLabel}</Text>
      </PressableScale>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const makeStyles = (C: Palette) => StyleSheet.create({
  segBar: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 2 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 8, borderRadius: Radius.md },
  segItemActive: { backgroundColor: C.surfaceContainerHigh, ...Elevation.e1 },
  segLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: -0.1 },

  card: { backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.lg, gap: Spacing.md, ...Elevation.e1 },
  cardLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, borderWidth: 1, overflow: 'hidden' },

  readyTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  readyRingWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  readyNum: { fontFamily: C.fontDisplay, fontSize: 30, letterSpacing: -1 },
  readyRight: { flex: 1, gap: Spacing.sm },
  readyIntensity: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },
  recBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primarySoft, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 7 },
  recText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },

  muscleList: { gap: 2, borderTopWidth: 1, borderTopColor: C.outlineVariant, paddingTop: Spacing.sm },
  muscleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  muscleDot: { width: 9, height: 9, borderRadius: 5 },
  muscleName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  muscleStatus: { fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  readyFoot: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.textSecondary, lineHeight: 16 },
  readyBodyWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xs },
  readyLockOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: C.scrim, borderRadius: Radius.md },
  readyLockText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.onPrimary },
  readyUnlockBtn: { backgroundColor: C.primary, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 8, marginTop: 2 },
  readyUnlockText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.onPrimary },

  sectionTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  sectionAction: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },

  itemCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.md,
    borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1,
  },
  itemIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  itemName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text, flexShrink: 1 },
  itemMeta: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  muscleChip: { backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  muscleChipText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.textSecondary, letterSpacing: 0.2 },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.successSoft, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  activeBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: C.success, letterSpacing: 0.4 },

  searchBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.sm, height: 44 },
  searchInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text, padding: 0 },

  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, textAlign: 'center', paddingVertical: Spacing.md },
  emptyBlock: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.md },
  emptyIcon: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { backgroundColor: C.primary, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: 10, marginTop: Spacing.xs },
  emptyBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.onPrimary },
})
