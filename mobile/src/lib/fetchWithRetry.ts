// Tempo — retry transient backend failures instead of surfacing them to the user.
//
// Why this exists (2026-08-14): App Review rejected the app under Guideline
// 2.1(a) — "error message displayed when we completed onboarding". The live
// request log for the reviewer's own account showed the cause exactly: EVERY
// request they made returned **503**, for about a minute, including the
// `POST /rest/v1/user_profiles` that onboarding's save chain depends on. It
// wasn't a code bug and it wasn't their network — Postgres was healthy
// throughout (cron jobs and checkpoints ran normally); Supabase's API gateway
// was briefly unavailable and recovered on its own.
//
// The real defect this exposed is that the app had NO tolerance for a transient
// backend failure. One 503 and the user got "Something went wrong", onboarding
// aborted, and the account was left with no profile row at all. We can't control
// gateway uptime, so the app has to survive a blip — which is also what a
// reviewer on a flaky test network, or a user on a train, needs.
//
// Deliberately conservative about WHICH failures are retried, because a retry
// that re-sends a write which actually landed is worse than the error it fixes:
//
//   • 502 / 503 — the gateway did not reach the database, so the request
//     provably had no effect. Always safe to retry, for any method. This is the
//     exact case that caused the rejection.
//   • 504 and network-level failures (fetch throws) — ambiguous: the request may
//     have been processed and only the RESPONSE lost. Retried for GET/HEAD only,
//     which are idempotent; a POST/PATCH/DELETE in this state is surfaced to the
//     caller rather than risk a duplicate insert.
//   • Everything else (4xx, 500) — never retried. A 500 can mean the statement
//     partially executed, and 4xx is a real answer, not a blip.

const RETRY_DELAYS_MS = [400, 1200] // → up to 3 attempts total

function isIdempotent(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD'
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * A `fetch` drop-in for the Supabase client that transparently retries the
 * transient failures described above. Anything it can't safely retry is returned
 * (or thrown) untouched, so caller-side error handling is unchanged.
 */
export function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method
  const retryableWhenAmbiguous = isIdempotent(method)

  const attempt = async (i: number): Promise<Response> => {
    const isLast = i >= RETRY_DELAYS_MS.length
    try {
      const res = await fetch(input, init)

      // Gateway couldn't reach the database — the request had no effect, so a
      // retry can't duplicate anything regardless of method.
      if ((res.status === 502 || res.status === 503) && !isLast) {
        await sleep(RETRY_DELAYS_MS[i])
        return attempt(i + 1)
      }
      // Timed out upstream: only safe to repeat when the call is idempotent.
      if (res.status === 504 && retryableWhenAmbiguous && !isLast) {
        await sleep(RETRY_DELAYS_MS[i])
        return attempt(i + 1)
      }
      return res
    } catch (err) {
      // Network-level failure (offline, DNS, connection reset). Same reasoning as
      // 504 — we can't know whether a write landed, so only repeat safe methods.
      if (retryableWhenAmbiguous && !isLast) {
        await sleep(RETRY_DELAYS_MS[i])
        return attempt(i + 1)
      }
      throw err
    }
  }

  return attempt(0)
}
