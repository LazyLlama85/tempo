// Tempo — Google Calendar connect-error copy, shared by every screen that offers
// the connect action (calendar-setup.tsx, and the onboarding reveal's optional
// tap-in). Single source so the two call sites can never drift apart.

export function friendlyConnectError(code?: string): string {
  switch (code) {
    case 'cancelled': return 'Sign-in was cancelled.'
    case 'no_refresh_token': return 'Google didn’t grant offline access — allow Calendar permission and try again.'
    case 'store_failed': return 'Couldn’t reach the scheduling service. Please try again.'
    case 'not_signed_in': return 'Please sign in first, then connect your calendar.'
    case 'identity_taken': return 'That Google account already has its own Tempo login. To use it, sign out and sign back in with Google — or connect your Device Calendar instead.'
    case 'link_unavailable': return 'Google Calendar can’t be attached to this account yet — the device calendar works today.'
    case 'session_switched': return 'That Google account doesn’t match your Tempo account. Try again with the same account.'
    default: return code ? `Connection failed — ${code}` : 'Something went wrong connecting. Please try again.'
  }
}
