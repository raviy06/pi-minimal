import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export type GitState = {
  branch: string | undefined
  /** Count of changed paths from `git status --porcelain`; undefined when unknown. */
  dirty: number | undefined
}

export function parseBranch(stdout: string): string | undefined {
  const line = stdout.trim().split("\n")[0]?.trim()
  if (!line || line === "HEAD") return undefined
  return line
}

export function parsePorcelain(stdout: string): number {
  return stdout.split("\n").filter((line) => line.trim().length > 0).length
}

export function formatGitState(state: GitState | undefined): { branch: string; dirty: string } {
  if (!state?.branch) return { branch: "", dirty: "" }
  const dirty = state.dirty && state.dirty > 0 ? `±${state.dirty}` : ""
  return { branch: state.branch, dirty }
}

/**
 * Polls git for the current branch and dirty count. Call `refresh()` after events that may have
 * changed the tree (tool results, turn end); `get()` is always synchronous.
 */
export function createGitState(pi: ExtensionAPI, cwd: () => string, minIntervalMs = 5000) {
  let state: GitState | undefined
  let lastRun = 0
  let inFlight: Promise<void> | undefined
  const listeners = new Set<() => void>()

  const refresh = (force = false): Promise<void> => {
    const now = Date.now()
    if (inFlight) return inFlight
    if (!force && now - lastRun < minIntervalMs) return Promise.resolve()
    lastRun = now
    inFlight = (async () => {
      try {
        const branchRun = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: cwd(), timeout: 2000 })
        if (branchRun.code !== 0) {
          state = undefined
          return
        }
        const branch = parseBranch(branchRun.stdout)
        const statusRun = await pi.exec("git", ["status", "--porcelain"], { cwd: cwd(), timeout: 3000 })
        const dirty = statusRun.code === 0 ? parsePorcelain(statusRun.stdout) : undefined
        state = { branch, dirty }
      } catch {
        state = undefined
      } finally {
        inFlight = undefined
        for (const listener of listeners) listener()
      }
    })()
    return inFlight
  }

  return {
    get: () => state,
    refresh,
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type GitStateHandle = ReturnType<typeof createGitState>
