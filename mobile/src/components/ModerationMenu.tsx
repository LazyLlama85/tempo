// Arclo — the Report / Block affordance (App Store Guideline 1.2).
//
// One component rather than three copies: every social surface (feed, both
// leaderboards, activity events, the friends list, group members) opens a person
// through `/friend-profile?userId=…`, so mounting this there covers all of them
// with a single, discoverable implementation — which is also what a reviewer
// looks for.
//
// The parent owns the trigger button and the `visible` flag; this owns the whole
// two-step flow (menu -> reason picker -> confirmation) and the blocking
// confirmation, so no caller has to reimplement the copy or the error handling.

import { useState } from 'react'
import { Alert } from 'react-native'
import { OptionSheet, type OptionSheetItem } from '@/components/OptionSheet'
import { supabase } from '@/lib/supabase'
import * as haptics from '@/lib/haptics'
import {
  blockUser, reportUser, REPORT_REASONS,
  type ReportContext, type ReportReason,
} from '@/lib/moderation'

interface Props {
  visible: boolean
  onClose: () => void
  targetUserId: string
  /** Shown in the sheet copy so the user is certain who they are acting on. */
  targetName: string
  context: ReportContext
  /** Called after a successful block — callers usually pop the screen. */
  onBlocked?: () => void
}

const MENU: OptionSheetItem[] = [
  { key: 'report', label: 'Report', sub: 'Tell us about abusive or offensive content', icon: 'flag-outline' },
  { key: 'block', label: 'Block', sub: 'You will not see each other anywhere in the app', icon: 'hand-left-outline', destructive: true },
]

export function ModerationMenu({ visible, onClose, targetUserId, targetName, context, onBlocked }: Props) {
  const [reasonOpen, setReasonOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirmBlock = () => {
    onClose()
    Alert.alert(
      `Block ${targetName}?`,
      'You will not see each other in the feed, on leaderboards, in groups, or in search. Any friendship between you is removed. You can undo this in Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (busy) return
            setBusy(true)
            const ok = await blockUser(supabase, targetUserId)
            setBusy(false)
            if (ok) {
              haptics.success()
              Alert.alert('Blocked', `You and ${targetName} will no longer see each other.`)
              onBlocked?.()
            } else {
              Alert.alert('Couldn’t block', 'Check your connection and try again.')
            }
          },
        },
      ],
    )
  }

  const submitReport = async (reason: ReportReason) => {
    setReasonOpen(false)
    if (busy) return
    setBusy(true)
    const ok = await reportUser(supabase, targetUserId, context, reason)
    setBusy(false)
    if (!ok) {
      Alert.alert('Couldn’t send report', 'Check your connection and try again.')
      return
    }
    haptics.success()
    // Offer the block in the same breath: someone who just reported abuse
    // usually also wants to stop seeing it, and making them hunt for a second
    // menu is how a compliant flow still feels broken.
    Alert.alert(
      'Report sent',
      'Thanks — we review every report. Do you also want to block this person so you stop seeing them?',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: confirmBlock },
      ],
    )
  }

  return (
    <>
      <OptionSheet
        visible={visible && !reasonOpen}
        title={targetName}
        subtitle="Report abusive content, or block this person entirely."
        options={MENU}
        onSelect={(key) => {
          if (key === 'report') setReasonOpen(true)
          else if (key === 'block') confirmBlock()
        }}
        onClose={onClose}
      />

      <OptionSheet
        visible={reasonOpen}
        title="What’s wrong?"
        subtitle="This goes to our review team. Reports are private."
        options={REPORT_REASONS.map((r) => ({ key: r.key, label: r.label }))}
        onSelect={(key) => submitReport(key as ReportReason)}
        onClose={() => { setReasonOpen(false); onClose() }}
      />
    </>
  )
}
