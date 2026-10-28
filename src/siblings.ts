import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createHerdrSiblings } from "./herdr.js"
import { createRexSiblings, type RexSpawn } from "./rex.js"

/** One other agent in the same workspace, as shown on the status line. */
export type Sibling = {
  name: string
  /** `idle | working | blocked | done | error`, or whatever the host reports; colour falls back to muted. */
  status: string
}

/**
 * Where sibling status comes from. `get()` is synchronous; `onChange` fires when the list may have
 * changed so the status line can re-render; `dispose()` stops timers and child processes and makes
 * late results inert.
 */
export type SiblingSource = {
  get(): Sibling[] | undefined
  onChange(listener: () => void): () => void
  dispose(): void
}

export type SiblingSourceDeps = {
  pi: ExtensionAPI
  env?: NodeJS.ProcessEnv
  spawn?: RexSpawn
}

/**
 * Picks the host the session runs in. Herdr wins when both are present (Rex inside a Herdr pane):
 * Herdr knows every agent it launched, Rex only the programs that report status.
 */
export function createSiblingSource(deps: SiblingSourceDeps): SiblingSource | undefined {
  const env = deps.env ?? process.env
  if (env.HERDR_ENV === "1") return createHerdrSiblings(deps.pi, env)
  if (env.REX_SESSION && env.REX_BLOCK) return createRexSiblings({ pi: deps.pi, env, spawn: deps.spawn })
  return undefined
}
