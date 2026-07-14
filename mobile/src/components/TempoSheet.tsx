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
   * Fixed snap points (e.g. ['85%']). Omit for the default `['90%']`.
   *
   * ⚠️ Do NOT switch this back to @gorhom's `enableDynamicSizing` (content-height sizing).
   * On the `scroll` path the content is a `BottomSheetScrollView`, which has no intrinsic
   * height — dynamic sizing measured it as ~0px and the sheet presented invisibly. That was
   * the "tap does nothing" bug: Edit Profile / Log Weight / Sign Out (and every OptionSheet)
   * all open sheets with no snapPoints + scroll, so they never appeared. A fixed snap point
   * always presents. Pass a smaller value (e.g. ['60%']) for shorter sheets if 90% feels tall.
   */
  snapPoints?: (string | number)[]
  style?: object
}

export function TempoSheet({ visible, onClose, children, scroll, snapPoints, style }: TempoSheetProps) {
  const C = useTheme()
  const ref = useRef<ElementRef<typeof BottomSheetModal>>(null)

  // Defer present()/dismiss() by one frame: on first mount the imperative modal
  // isn't registered with BottomSheetModalProvider yet, so calling present()
  // synchronously can no-op (another "sheet never opens" failure mode). The rAF
  // lets registration finish first.
  useEffect(() => {
    if (!ref.current) return
    const id = requestAnimationFrame(() => {
      if (visible) ref.current?.present()
      else ref.current?.dismiss()
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  const Content = scroll ? BottomSheetScrollView : BottomSheetView
  const resolvedSnapPoints = snapPoints ?? ['90%']

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={onClose}
      snapPoints={resolvedSnapPoints}
      enableDynamicSizing={false} // see snapPoints doc above — dynamic sizing = 0-height invisible sheets

      enablePanDownToClose
      enableDismissOnClose
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
