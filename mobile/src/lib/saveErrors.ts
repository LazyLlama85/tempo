// Tempo — turn a failed save's raw error into copy a user can act on.
//
// Supabase surfaces three very different failure families through one catch:
// no network (fetch TypeError), an expired/invalid session (JWT/401), and real
// server errors. Each needs different advice — "try again" is only honest for
// the first one. Used by the plan flow and other critical saves.

import { supabase } from '@/lib/supabase'
import { BRAND_NAME } from '@/constants/brand'

export type SaveErrorKind = 'offline' | 'auth' | 'server'

export interface SaveErrorInfo {
  kind: SaveErrorKind
  title: string
  message: string
}

function messageOf(err: unknown): string {
  if (!err) return ''
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && 'message' in (err as any)) return String((err as any).message ?? '')
  return String(err)
}

export function isAuthError(err: unknown): boolean {
  const msg = messageOf(err).toLowerCase()
  const code = typeof err === 'object' && err ? String((err as any).code ?? '') : ''
  return (
    msg.includes('jwt') ||
    msg.includes('token') && msg.includes('expired') ||
    msg.includes('not authenticated') ||
    msg.includes('refresh_token') ||
    code === 'PGRST301' ||
    code === '401'
  )
}

export function isNetworkError(err: unknown): boolean {
  const msg = messageOf(err).toLowerCase()
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('abort') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  )
}

export function describeSaveError(err: unknown, what = 'save your changes'): SaveErrorInfo {
  if (isNetworkError(err)) {
    return {
      kind: 'offline',
      title: 'No connection',
      message: `${BRAND_NAME} couldn’t reach the server to ${what}. Check your internet connection and try again — nothing was lost.`,
    }
  }
  if (isAuthError(err)) {
    // The copy promises a refresh, so make one actually happen — most callers show
    // this in an alert with a Try Again button, and reading the alert takes longer
    // than the refresh round-trip. Fire-and-forget: the retry surfaces any failure.
    supabase.auth.refreshSession().catch(() => {})
    return {
      kind: 'auth',
      title: 'Session needs a refresh',
      message: `Your login session had expired. ${BRAND_NAME} is refreshing it now — tap Try Again and it should go through.`,
    }
  }
  const raw = messageOf(err)
  return {
    kind: 'server',
    title: 'Something went wrong',
    message: raw
      ? `Couldn’t ${what} (${raw}). Please try again — if it keeps happening, contact support.`
      : `Couldn’t ${what}. Please try again — if it keeps happening, contact support.`,
  }
}
