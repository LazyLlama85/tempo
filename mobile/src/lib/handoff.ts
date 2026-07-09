// Tempo — cross-screen handoff for "create X, then return and use it" flows.
//
// Expo Router params only flow forward; when a screen pushes a child creator
// (e.g. Split editor → Workout builder) the result has to travel BACK. This is a
// tiny in-memory mailbox for that: the creator deposits the created id, the
// parent consumes it in its focus effect. Single-slot and consumed-on-read, so a
// stale handoff can never re-apply on a later visit.

let createdTemplateId: string | null = null

/** Workout builder calls this after saving a template it was asked to create for a split day. */
export function setSplitHandoff(templateId: string): void {
  createdTemplateId = templateId
}

/** Split editor calls this on refocus; returns the new template id at most once. */
export function consumeSplitHandoff(): string | null {
  const id = createdTemplateId
  createdTemplateId = null
  return id
}
