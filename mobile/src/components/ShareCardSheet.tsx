// Tempo — share sheet for the Wrapped cards.
//
// Renders the selected card, snapshots it to a PNG with react-native-view-shot, and
// hands it to the OS share sheet. The auto-caption sits underneath with a one-tap
// "Copy" so the user can paste a real sentence instead of "Completed workout."

import { useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Spacing, Radius } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { TempoSheet } from '@/components/TempoSheet'
import { WrappedCard } from '@/components/WrappedCard'
import { captionFor, type WrappedCard as CardModel } from '@/lib/wrapped'


// react-native-view-shot, expo-sharing and expo-clipboard are native modules:
// they're only present once the dev/standalone client has been rebuilt to include
// them. Requiring them lazily means a client that predates these deps shows a
// friendly "update the app" message instead of crashing the whole screen at import.
type NativeShare = {
  captureRef: (ref: unknown, opts: Record<string, unknown>) => Promise<string>
  Sharing: { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: Record<string, unknown>) => Promise<void> }
  Clipboard: { setStringAsync: (s: string) => Promise<boolean> }
}
function loadNativeShare(): NativeShare | null {
  try {
    return {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      captureRef: require('react-native-view-shot').captureRef,
      Sharing: require('expo-sharing'),
      Clipboard: require('expo-clipboard'),
    }
  } catch {
    return null
  }
}

const CARD_LABEL: Record<CardModel['kind'], string> = {
  weekly: 'Weekly', streak: 'Streak', pr: 'PR', goal: 'Goal',
  monthVolume: 'Month', topLifts: 'Top Lifts', weightTrend: 'Weight',
}

interface Props {
  visible: boolean
  cards: CardModel[]
  onClose: () => void
}

export function ShareCardSheet({ visible, cards, onClose }: Props) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<View>(null)

  const card = cards[Math.min(index, cards.length - 1)]
  const caption = card ? captionFor(card) : ''

  const handleShare = async () => {
    if (!card || busy) return
    const native = loadNativeShare()
    if (!native) {
      Alert.alert('Update needed', 'Image sharing comes with the latest app build. Update the app to share your card — your caption is ready to copy below in the meantime.')
      return
    }
    setBusy(true)
    try {
      const uri = await native.captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' })
      // Pre-load the caption onto the clipboard so it's ready to paste alongside.
      await native.Clipboard.setStringAsync(caption)
      if (!(await native.Sharing.isAvailableAsync())) {
        Alert.alert('Caption copied', 'Sharing isn’t available here, but your caption is on the clipboard.')
        return
      }
      await native.Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: `Share your ${BRAND_NAME} card`,
      })
    } catch {
      Alert.alert('Couldn’t share', 'Something went wrong creating your card. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    if (!caption) return
    const native = loadNativeShare()
    if (!native) {
      Alert.alert('Update needed', 'Copying the caption comes with the latest app build — update the app to enable it.')
      return
    }
    await native.Clipboard.setStringAsync(caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <TempoSheet visible={visible} onClose={onClose} scroll>
        <View style={styles.sheet}>
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
          <View style={{ height: Math.max(insets.bottom, Spacing.md) }} />
        </View>
    </TempoSheet>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  sheet: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },

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
