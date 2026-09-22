export type ReclaimReason =
  | "session_start"
  | "session_settle"
  | "interval"
  | "turn_end"
  | "tool_execution_end"

export type ReclaimPolicy = {
  resetEditor: boolean
  reinstallChrome: boolean
}

export function reclaimPolicy(reason: ReclaimReason): ReclaimPolicy {
  if (reason === "session_start") {
    return { resetEditor: true, reinstallChrome: true }
  }
  if (reason === "interval") {
    return { resetEditor: false, reinstallChrome: false }
  }
  // session_settle / turn_end / tool_execution_end: restore chrome, keep editor
  return { resetEditor: false, reinstallChrome: true }
}

export function applyReclaim(
  reason: ReclaimReason,
  ui: { setEditorComponent: (factory: undefined) => void },
  install: { widgets: () => void; chrome: () => void },
): ReclaimPolicy {
  const policy = reclaimPolicy(reason)
  install.widgets()
  if (policy.resetEditor) ui.setEditorComponent(undefined)
  if (policy.reinstallChrome) install.chrome()
  return policy
}
