// Arclo — single source of truth for the product name.
//
// Anywhere the app needs to say who it is — the wordmark, in-app copy, alert
// text, calendar event titles — import from here instead of hardcoding the
// name. This name is provisional (not fully locked in) — that's the whole
// point of routing everything through this file: renaming again means
// editing the values below, plus two places this file can't reach:
//   • mobile/app.json — native identity (display name, permission strings,
//     bundle id, scheme). Kept separate deliberately: those changes require a
//     full native rebuild, not just a JS/OTA update, so they're a bigger,
//     more deliberate step than everything else here. Note that
//     bundleIdentifier/package/scheme/associatedDomains were deliberately
//     NOT changed during this rename (see app.json) — only the display name
//     and permission strings were.
//   • web/*.html — the marketing site is plain static HTML (no templating),
//     so its mentions of the name are a manual find-and-replace.
// See ARCHITECTURE.md for the full list.

export const BRAND_NAME = 'Arclo'

// Lowercase, for the wordmark glyph (components/brand.tsx) and anywhere else
// that intentionally renders the name in its logo casing.
export const BRAND_NAME_LOWER = 'arclo'

// Still fittempo.app — the domain purchase for arclo.app (or whatever domain
// is eventually settled on) hasn't happened yet. Update this (and the
// associatedDomains / intentFilters host in mobile/app.json, which need a
// native rebuild) once it has, and only once web/share.html etc. are
// actually hosted there — a share link pointing somewhere that doesn't
// resolve is worse than one pointing at the old name.
export const BRAND_DOMAIN = 'fittempo.app'

// The prefix stamped on every calendar event Arclo creates (device
// Calendar + Google Calendar), and matched on later to find/remove them
// (calendarService.ts, calendarSync.ts, googleCalendar/CalendarApiService.ts).
export const CALENDAR_EVENT_PREFIX = 'Arclo'

// Prefixes this product has used previously. Events already sitting in a
// user's calendar keep whatever prefix was current when they were created,
// so the "find my events" / "remove all my events" sweeps match this list
// too, not just CALENDAR_EVENT_PREFIX — otherwise a rename orphans every
// event created before it. On a future rename: move the old
// CALENDAR_EVENT_PREFIX value in here (keep every prior entry, never remove
// one), then set CALENDAR_EVENT_PREFIX to the new name.
export const LEGACY_CALENDAR_EVENT_PREFIXES = ['Tempo', 'Fitaround']

// Still the pre-rebrand inbox — update once a proper domain mailbox exists,
// and update web/privacy.html + web/terms.html + web/delete-account.html to
// match (plain static HTML, so that's a manual find-and-replace, not an
// import from here).
export const BRAND_SUPPORT_EMAIL = 'fittempo.app@gmail.com'
