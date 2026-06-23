// Tempo — share sheet for the Wrapped cards.
//
// Renders the selected card, snapshots it to a PNG with react-native-view-shot, and
// hands it to the OS share sheet. The auto-caption sits underneath with a one-tap
// "Copy" so the user can paste a real sentence instead of "Completed workout."

import { useRef, useState } from 'react'
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import * as Clipboard from 'expo-clipboard'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { WrappedCard } from '@/components/WrappedCard'
import { captionFor, type WrappedCard as CardModel } from '@/lib/wrapped'

const C = Colors.light

const CARD_LABEL: Record<CardModel['kind'], string> = {
  weekly: 'Weekly', streak: 'Streak', pr: 'PR', goal: 'Goal',
}

interface Props {
  visible: boolean
  cards: CardModel[]
  onClose: () => void
}

export function ShareCardSheet({ visible, cards, onClose }: Props) {
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<View>(null)

  const card = cards[Math.min(index, cards.length - 1)]
  const caption = card ? captionFor(card) : ''

  const handleShare = async () => {
    if (!card || busy) return
    setBusy(true)
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' })
      // Pre-load the caption onto the clipboard so it's ready to paste alongside.
      await Clipboard.setStringAsync(caption)
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Caption copied', 'Sharing isn’t available here, but your caption is on the clipboard.')
        return
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Share your Tempo card',
      })
    } catch {
      Alert.alert('Couldn’t share', 'Something went wrong creating your card. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    if (!caption) return
    await Clipboard.setStringAsync(caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Share your card</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {cards.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {cards.map((c, i) => {
                const on = i === index
                return (
                  <TouchableOpacity
                    key={c.kind}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setIndex(i)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{CARD_LABEL[c.kind]}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}

          {card && (
            <View style={styles.preview}>
              <WrappedCard ref={cardRef} card={card} />
            </View>
          )}

          {/* Auto-caption */}
          <View style={styles.captionBox}>
            <Text style={styles.captionText}>{caption}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopy} activeOpacity={0.8}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={C.primary} />
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy caption'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.shareBtn, busy && { opacity: 0.6 }]}
            onPress={handleShare}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? <ActivityIndicator color={C.onPrimary} /> : (
              <>
                <Ionicons name="share-outline" size={18} color={C.onPrimary} />
                <Text style={styles.shareText}>Share image</Text>
              </>
            )}
          </TouchableOpacity>
          <View style={{ height: Platform.OS === 'ios' ? Spacing.lg : Spacing.md }} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: C.outlineVariant, alignSelf: 'center', marginBottom: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.text, letterSpacing: -0.3 },

  chips: { gap: Spacing.xs, paddingBottom: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: C.outlineVariant, backgroundColor: C.background,
  },
  chipOn: { borderColor: C.primary, backgroundColor: C.primarySoft },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  chipTextOn: { color: C.primary },

  preview: { alignItems: 'center', paddingVertical: Spacing.sm },

  captionBox: {
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: C.outlineVariant, gap: Spacing.sm, marginTop: Spacing.xs,
  },
  captionText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text, lineHeight: 20 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  copyText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },

  shareBtn: {
    height: 56, backgroundColor: C.primary, borderRadius: Radius.lg, marginTop: Spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
  },
  shareText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
