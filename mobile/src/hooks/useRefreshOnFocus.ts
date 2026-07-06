import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

// Re-pull a screen's data every time its tab regains focus.
//
// React Query only refetches on *mount* and (via focusManager) app-foreground —
// tab switches are neither, so without this a screen keeps whatever data it had
// when it first mounted until some OTHER screen happens to mount the same query
// key. That was the root cause of "content doesn't load until I navigate away
// and come back": the away-and-back was the refetch.
//
// Keys are partial-match roots (e.g. ['scheduled_workouts'] hits every range).
// The first focus after mount is skipped — the mount fetch already covers it.
// Keys are read through a ref so callers can pass fresh literals every render
// without re-arming the focus effect (which would loop: invalidate → refetch →
// render → new keys → invalidate …).
export function useRefreshOnFocus(...queryKeys: QueryKey[]) {
  const queryClient = useQueryClient()
  const keysRef = useRef<QueryKey[]>(queryKeys)
  const firstFocus = useRef(true)

  useEffect(() => {
    keysRef.current = queryKeys
  })

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false
        return
      }
      for (const key of keysRef.current) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    }, [queryClient]),
  )
}
