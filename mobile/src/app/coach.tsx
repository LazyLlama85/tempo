// Tempo — Tempo Coach (batch C3: the thread, text only).
//
// A chat surface over the user's own training data. The server half
// (supabase/functions/tempo-coach) may hand back a PROPOSED action alongside the
// text; this batch deliberately does NOT render an Apply affordance for it — the
// confirm card and the executor switch are C4, and TEMPO_COACH_PLAN.md §10 keeps
// them in their own session precisely so the scheduling-engine writes get their
// own "nothing else changed" diff review.
//
// What that means here: when a reply arrives with an action but no text (the model
// is asked to always explain first, but an empty bubble on a purchase-driving
// surface is not something to leave to a prompt), we fall back to
// describeAction() so the user still reads a sentence. The action itself is
// persisted server-side with action_state='proposed' either way, so nothing is
// lost when C4 turns it into a card.
//
// No entry points are added in this batch (they're C5) — the route exists and is
// reachable directly, which is exactly the "use it yourself for a day" state the
// plan asks for.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ScreenHeader, DismissButton, TempoPulse } from '@/components/brand'
import { PressableScale } from '@/components/motion'
import { Spacing, Radius } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import {
  describeAction, fetchCoachContext, fetchCoachHistory, sendCoachMessage,
  type CoachContext, type CoachError, type CoachMessage,
} from '@/lib/coach'

const MAX_CHARS = 2000

// The empty state's tappable openers. Starters materially lift first-use rate —
// a blank composer on a chat surface is the single biggest reason people never
// send a first message. Each one maps to a different tool the coach can reach for.
const STARTERS = [
  "I'm busy Tuesday and Wednesday",
  'My shoulder is bothering me',
  'Am I actually making progress?',
  "I'm travelling next week",
]

/** A thread row. Pending/failed rows are local-only until the server persists them. */
interface Row extends CoachMessage {
  /** Set on a user row whose reply never arrived — renders a Retry affordance. */
  failed?: CoachError
}

let rowSeq = 0
const localId = () => `local-${++rowSeq}`

export default function CoachScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const params = useLocalSearchParams<{ entry?: string; prefill?: string }>()

  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState(params.prefill ?? '')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)

  // The context pack is fetched once per screen open and reused for every turn.
  // It's a snapshot of a plan that isn't changing while the user types, and
  // re-reading six tables per message would be pure latency.
  const contextRef = useRef<CoachContext | null>(null)
  const listRef = useRef<FlatList<Row>>(null)

  useEffect(() => {
    const entry = params.entry
    track('coach_opened', {
      entry: entry === 'home' || entry === 'plan' || entry === 'progress' || entry === 'tab'
        ? entry
        : 'direct',
    })
    // Route params are read once, at mount, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      // History first (it's what the user sees), context in parallel because the
      // first send shouldn't wait on it. Both are individually best-effort: a
      // coach with no history is usable, a coach that won't open is not.
      const [history] = await Promise.all([
        fetchCoachHistory(supabase, userId).catch(() => [] as CoachMessage[]),
        fetchCoachContext(supabase, userId)
          .then((ctx) => { contextRef.current = ctx })
          .catch(() => { contextRef.current = null }),
      ])
      if (cancelled) return
      setRows(history)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  const send = useCallback(async (text: string, retryOfId?: string) => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setBanner(null)
    setSending(true)

    // On a retry the user's bubble is already on screen — reuse it rather than
    // stacking a duplicate.
    const userRowId = retryOfId ?? localId()
    if (retryOfId) {
      setRows((prev) => prev.map((r) => (r.id === retryOfId ? { ...r, failed: undefined } : r)))
    } else {
      setRows((prev) => [...prev, {
        id: userRowId,
        role: 'user',
        content: trimmed,
        action: null,
        action_state: null,
        created_at: new Date().toISOString(),
      }])
      setDraft('')
    }

    // History replayed to the model excludes anything that failed — a bubble the
    // server never saw isn't part of the conversation.
    const priorRows = rows.filter((r) => !r.failed)

    // A missing context pack degrades the answer; it must not block the send.
    if (!contextRef.current && userId) {
      contextRef.current = await fetchCoachContext(supabase, userId).catch(() => null)
    }

    const result = await sendCoachMessage(supabase, {
      message: trimmed,
      context: contextRef.current ?? { today: new Date().toISOString().slice(0, 10) },
      history: priorRows,
    })

    setSending(false)

    if (!result.ok) {
      // The user message stays on screen with a Retry. Quota is NOT consumed on a
      // failure — the server only counts rows it successfully persisted.
      setRows((prev) => prev.map((r) => (r.id === userRowId ? { ...r, failed: result.error } : r)))
      setBanner(errorBanner(result.error))
      if (result.error.kind === 'quota') {
        setLocked(result.error.locked)
        setRemaining(0)
      }
      return
    }

    const { reply } = result
    setRemaining(reply.remaining)
    setLocked(reply.locked)

    // Never ship an empty bubble: fall back to a locally-generated sentence
    // describing whatever the model proposed.
    const body = reply.text.trim()
      || (reply.action ? describeAction(reply.action) : "I didn't catch that — try rephrasing?")

    setRows((prev) => [...prev, {
      id: localId(),
      role: 'assistant',
      content: reply.truncated ? `${body}…` : body,
      action: reply.action,
      action_state: reply.action ? 'proposed' : null,
      created_at: new Date().toISOString(),
    }])

    track('coach_message_sent', { has_action: !!reply.action, locked: reply.locked })
    if (reply.action) track('coach_action_proposed', { tool: reply.action.name })
  }, [rows, sending, userId])

  // The list is inverted so new messages sit at the bottom and the keyboard
  // pushes the thread up for free; the data is reversed for the same reason.
  const data = [...rows].reverse()

  if (!session) return <Redirect href="/sign-in" />

  const renderRow = ({ item }: { item: Row }) => {
    const mine = item.role === 'user'
    return (
      <View style={styles.rowWrap}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleCoach]}>
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.content}</Text>
        </View>
        {item.failed ? (
          <TouchableOpacity
            style={styles.retry}
            onPress={() => send(item.content, item.id)}
            accessibilityRole="button"
            accessibilityLabel="Retry sending this message"
          >
            <Ionicons name="refresh" size={13} color={C.textSecondary} />
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    )
  }

  const canSend = draft.trim().length > 0 && !sending

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Coach"
        subtitle={remaining != null && locked ? `${remaining} left this week` : undefined}
        size="sm"
        leading={<DismissButton kind="x" onPress={() => router.back()} label="Close" />}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <TempoPulse size={34} />
            <Text style={styles.emptyTitle}>Ask your coach</Text>
            <Text style={styles.emptyBody}>
              Tempo can see your plan, your week and how your training is actually going. Tell it
              what changed and it will work out what to do about it.
            </Text>
            <View style={styles.starters}>
              {STARTERS.map((s) => (
                <PressableScale key={s} style={styles.starter} onPress={() => send(s)}>
                  <Text style={styles.starterText}>{s}</Text>
                </PressableScale>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={data}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={renderRow}
            contentContainerStyle={styles.thread}
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          />
        )}

        {sending ? (
          <View style={styles.typing}>
            <TempoPulse size={18} />
            <Text style={styles.typingText}>Thinking…</Text>
          </View>
        ) : null}

        {banner ? (
          <View style={styles.banner}>
            <Ionicons name="information-circle-outline" size={15} color={C.textSecondary} />
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAX_CHARS))}
            placeholder="What's going on with your training?"
            placeholderTextColor={C.outline}
            multiline
            maxLength={MAX_CHARS}
            editable={!sending}
            accessibilityLabel="Message your coach"
          />
          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnOff]}
            onPress={() => send(draft)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={18} color={C.onPrimary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function errorBanner(e: CoachError): string {
  switch (e.kind) {
    case 'offline':
      return 'Coach needs a connection. Your message is still here — retry when you’re back online.'
    case 'quota':
      return e.locked
        ? 'You’ve used your free coach messages for this week.'
        : 'You’ve hit this month’s coach limit.'
    case 'unavailable':
      return 'Coach isn’t available right now. Try again shortly.'
    default:
      return 'That didn’t go through. Tap retry on your message.'
  }
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  thread: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  rowWrap: { gap: 4 },
  bubble: {
    maxWidth: '86%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: C.primary, borderBottomRightRadius: Radius.sm },
  bubbleCoach: {
    alignSelf: 'flex-start', backgroundColor: C.surfaceContainerLow,
    borderBottomLeftRadius: Radius.sm,
  },
  bubbleText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: C.text },
  bubbleTextMine: { color: C.onPrimary },
  retry: {
    alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 2,
  },
  retryText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.containerPadding, gap: Spacing.sm,
  },
  emptyTitle: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.3 },
  emptyBody: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21,
    color: C.textSecondary, textAlign: 'center',
  },
  starters: { alignSelf: 'stretch', gap: Spacing.xs, marginTop: Spacing.sm },
  starter: {
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  starterText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },

  typing: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.xs,
  },
  typingText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },

  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginHorizontal: Spacing.containerPadding, marginBottom: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm,
  },
  bannerText: {
    flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 18,
    color: C.textSecondary,
  },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs,
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: Spacing.xs, paddingBottom: Spacing.md,
    borderTopWidth: 0.5, borderTopColor: C.outlineVariant,
    backgroundColor: C.surface,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44,
    backgroundColor: C.background, borderWidth: 1, borderColor: C.outlineVariant,
    borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingTop: 12, paddingBottom: 12,
    fontFamily: 'Inter_400Regular', fontSize: 15, color: C.text,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
})
