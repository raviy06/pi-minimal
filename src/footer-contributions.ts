import { stripVTControlCharacters } from "node:util"

export const ACTIVITY_STATES = ["queued", "running", "waiting", "paused", "stopping", "completed", "failed", "stopped", "unknown"] as const
export type ActivityState = typeof ACTIVITY_STATES[number]
export type ActivityRow = Readonly<{ key: string; agent: string; state: ActivityState; text: string; parentKey?: string }>
export type ActivitySnapshot = Readonly<{
  revision: number; rows: readonly ActivityRow[]; omitted: number
  motion: "spinner" | "static"; format: "icons" | "plain"
}>
type Failure = { ok: false; code: "invalid" | "wrong-session" | "occupied" | "stale" | "disposed" }
export type ActivityRegistration = {
  publish(snapshot: unknown): { ok: true } | Failure
  dispose(): void
}
export type RegistrationResult = { ok: true; registration: ActivityRegistration } | Failure

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function identity(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._:@+-]{1,128}$/.test(value)
}
export function cleanActivityText(value: string): string {
  return stripVTControlCharacters(value)
    // Also remove bare C0/C1 and bidi controls; no terminal commands from labels.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/gu, " ").trim()
}
function normalizeSnapshot(input: unknown): ActivitySnapshot | undefined {
  if (!record(input) || !Number.isSafeInteger(input.revision) || (input.revision as number) < 0 ||
    !Number.isSafeInteger(input.omitted) || (input.omitted as number) < 0 ||
    !["spinner", "static"].includes(input.motion as string) || !["icons", "plain"].includes(input.format as string) ||
    !Array.isArray(input.rows) || input.rows.length > 64) return
  const rows: ActivityRow[] = []
  const parents = new Map<string, string | undefined>()
  for (const item of input.rows) {
    if (!record(item) || !identity(item.key) || parents.has(item.key) ||
      typeof item.agent !== "string" || item.agent.length > 96 || !cleanActivityText(item.agent) ||
      typeof item.text !== "string" || item.text.length > 256 ||
      !ACTIVITY_STATES.includes(item.state as ActivityState) ||
      (item.parentKey !== undefined && !identity(item.parentKey))) return
    parents.set(item.key, item.parentKey as string | undefined)
    rows.push(Object.freeze({ key: item.key, agent: cleanActivityText(item.agent), state: item.state as ActivityState,
      text: cleanActivityText(item.text), ...(item.parentKey === undefined ? {} : { parentKey: item.parentKey as string }) }))
  }
  for (const row of rows) {
    const seen = new Set([row.key])
    let parent = row.parentKey
    while (parent !== undefined) {
      if (!parents.has(parent) || seen.has(parent)) return
      seen.add(parent)
      parent = parents.get(parent)
    }
  }
  return Object.freeze({ revision: input.revision as number, rows: Object.freeze(rows), omitted: input.omitted as number,
    motion: input.motion as ActivitySnapshot["motion"], format: input.format as ActivitySnapshot["format"] })
}

export function createFooterContributions(initialSessionId: string | null = null) {
  let sessionId = initialSessionId
  let owner: symbol | undefined
  let snapshot: ActivitySnapshot | undefined
  const observers = new Set<() => void>()
  const notify = () => {
    for (const observer of [...observers]) {
      try { observer() } catch { /* A disposed UI must not invalidate a successful publish. */ }
    }
  }
  return {
    read: () => snapshot,
    subscribe(observer: () => void) { observers.add(observer); return () => { observers.delete(observer) } },
    reset(nextSessionId: string | null) {
      sessionId = nextSessionId; owner = undefined; snapshot = undefined; notify()
    },
    register(input: unknown): RegistrationResult {
      if (!record(input) || !identity(input.owner) || typeof input.sessionId !== "string" || !input.sessionId) return { ok: false, code: "invalid" }
      if (sessionId === null || input.sessionId !== sessionId) return { ok: false, code: "wrong-session" }
      if (owner) return { ok: false, code: "occupied" }
      const token = Symbol(input.owner)
      owner = token
      return { ok: true, registration: {
        publish(input: unknown) {
          if (owner !== token) return { ok: false, code: "disposed" }
          const next = normalizeSnapshot(input)
          if (!next) return { ok: false, code: "invalid" }
          if (snapshot && next.revision <= snapshot.revision) return { ok: false, code: "stale" }
          snapshot = next; notify()
          return { ok: true }
        },
        dispose() {
          if (owner !== token) return
          owner = undefined; snapshot = undefined; notify()
        },
      } }
    },
  }
}
export type FooterContributions = ReturnType<typeof createFooterContributions>
