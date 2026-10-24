import type { FooterContributions, RegistrationResult } from "./footer-contributions.js"

export const FOOTER_EVENTS = {
  register: "pi-minimal:footer:v1:register",
  ready: "pi-minimal:footer:v1:ready",
  unavailable: "pi-minimal:footer:v1:unavailable",
} as const
export type RegisterRequest = {
  version: 1; sessionId: string; owner: string; slot: "activity"
  result?: RegistrationResult | { ok: false; code: "not-tui" }
}
type Events = {
  on(name: string, handler: (value: unknown) => void): () => void
  emit(name: string, value: unknown): void
}

/** Bind once per session, not once per footer mount. Trusted in-process protocol. */
export function bindFooterContributionEvents(events: Events, registry: FooterContributions, sessionId: string, mode: string): () => void {
  registry.reset(mode === "tui" ? sessionId : null)
  const unsubscribe = events.on(FOOTER_EVENTS.register, (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return
    const request = value as Partial<RegisterRequest>
    // A different host may have answered first. Never overwrite its result.
    if (request.result !== undefined) return
    if (request.version !== 1 || request.slot !== "activity") request.result = { ok: false, code: "invalid" }
    else if (mode !== "tui") request.result = { ok: false, code: "not-tui" }
    else request.result = registry.register(request)
  })
  if (mode === "tui") events.emit(FOOTER_EVENTS.ready, { version: 1, sessionId, slots: ["activity"] })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    registry.reset(null)
    if (mode === "tui") events.emit(FOOTER_EVENTS.unavailable, { version: 1, sessionId })
  }
}
