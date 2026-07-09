// Tempo — short share-link route: tempo.app/w/<code> (and tempo://w/<code>).
// Immediately forwards to the shared-workout landing screen; exists so the
// public link shape has a first-class deep-link target in the app.

import { Redirect, useLocalSearchParams } from 'expo-router'

export default function ShareLinkRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>()
  return <Redirect href={{ pathname: '/shared-workout', params: { code: code ?? '' } } as any} />
}
