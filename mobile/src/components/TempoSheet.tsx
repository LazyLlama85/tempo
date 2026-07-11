// Tempo — shared swipeable bottom sheet.
//
// Every sheet in the app used to be a plain RN <Modal> with a decorative "handle" pill
// that had no gesture attached to it — users could see what looked like a drag handle
// but swiping down did nothing (tap-outside-to-close was the only way out). This wraps
// @gorhom/bottom-sheet so the handle is real: pan-to-dismiss, keyboard-aware (fixes the
// body-measurement modal's keyboard-covers-save-button bug), and content scrolling is
// arbitrated against the dismiss gesture instead of fighting it.
//
// Callers keep the same `visible`/`onClose` shape the old <Modal> API used, so migration
// is a near drop-in swap. Pass `scroll` when the sheet's content needs to scroll.

import { useEffect, useRef, type ElementRef } from 'react'
import { StyleSheet } from 'react-native'
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { Radius } from '@/constants/theme'
import { useTheme } from '@/theme'

interface TempoSheetProps {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
  /** Content scrolls internally (long forms/lists). Uses BottomSheetScrollView. */
  scroll?: boolean
  /**
   * Fixed snap points (e.g. ['90%']). Omit for the default: the sheet sizes itself to
   * its content, up to ~90% of the screen — right for short sheets (option pickers,
   * single-field forms) so they don't show a mostly-empty tall sheet.
   */
  snapPoints?: (string | number)[]
  style?: object
}

export function TempoSheet({ visible, onClose, children, scroll, snapPoints, style }: TempoSheetProps) {
  const C = useTheme()
  const ref = useRef<ElementRef<typeof BottomSheetModal>>(null)

  useEffect(() => {
    if (visible) ref.current?.present()
    else ref.current?.dismiss()
  }, [visible])

  const Content = scroll ? BottomSheetScrollView : BottomSheetView

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={onClose}
      snapPoints={snapPoints}
      enableDynamicSizing={!snapPoints}
      maxDynamicContentSize={undefined}
      backdropComponent={(props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.45} pressBehavior="close" />
      )}
      backgroundStyle={{ backgroundColor: C.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl }}
      handleIndicatorStyle={{ backgroundColor: C.outlineVariant, width: 40, height: 4 }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <Content
        style={[scroll ? styles.scrollFill : undefined, style]}
        contentContainerStyle={scroll ? styles.scrollContent : undefined}
        keyboardShouldPersistTaps={scroll ? 'handled' : undefined}
      >
        {children}
      </Content>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  scrollFill: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
})
