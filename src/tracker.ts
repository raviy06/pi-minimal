import type { ExtensionContext } from "@earendil-works/pi-coding-agent"

const PHASES = ["brainstorm", "plan", "implement", "verify", "ship"] as const
type PhaseName = (typeof PHASES)[number]
type PhaseStatus = "pending" | "in_progress" | "complete" | "skipped"
type TaskStatus = "pending" | "in_progress" | "complete" | "failed"

type PhaseMap = Record<PhaseName, { status: PhaseStatus; substep?: string | null }>

type Task = { name: string; status: TaskStatus }

export type TrackerSnapshot = {
  phases?: PhaseMap
  tasks?: Task[]
}

function readSnapshot(ctx: ExtensionContext): TrackerSnapshot {
  let phases: PhaseMap | undefined
  let tasks: Task[] | undefined
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue
    const msg = entry.message as {
      role?: string
      toolName?: string
      details?: {
        error?: string
        phases?: PhaseMap
        tasks?: Task[]
      }
    }
    if (msg.role !== "toolResult" || !msg.details || msg.details.error) continue
    if (msg.toolName === "phase_tracker" && msg.details.phases) {
      phases = msg.details.phases
    }
    if (msg.toolName === "plan_tracker" && msg.details.tasks) {
      tasks = msg.details.tasks
    }
  }
  return { phases, tasks }
}

function phaseActive(phases: PhaseMap): boolean {
  return PHASES.some((p) => phases[p]?.status && phases[p].status !== "pending")
}

export function formatTrackerLines(
  ctx: ExtensionContext,
  theme: { fg: (name: string, s: string) => string },
): string[] {
  const { phases, tasks } = readSnapshot(ctx)
  const lines: string[] = []
  if (phases && phaseActive(phases)) {
    const parts = PHASES.map((p) => {
      const st = phases[p]?.status || "pending"
      const icon =
        st === "complete"
          ? theme.fg("success", "✓")
          : st === "in_progress"
            ? theme.fg("warning", "→")
            : st === "skipped"
              ? theme.fg("dim", "⊘")
              : theme.fg("dim", "○")
      const label = st === "skipped" ? theme.fg("dim", p) : p
      return `${icon} ${label}`
    })
    lines.push(`${theme.fg("muted", "Phases")} ${parts.join(theme.fg("dim", " → "))}`)
  }
  if (tasks && tasks.length > 0) {
    const done = tasks.filter((t) => t.status === "complete").length
    const icons = tasks
      .map((t) => {
        if (t.status === "complete") return theme.fg("success", "✓")
        if (t.status === "in_progress") return theme.fg("warning", "→")
        if (t.status === "failed") return theme.fg("error", "✗")
        return theme.fg("dim", "○")
      })
      .join("")
    const current =
      tasks.find((t) => t.status === "in_progress") ?? tasks.find((t) => t.status === "pending")
    const name = current ? theme.fg("text", ` ${current.name}`) : ""
    lines.push(
      `${theme.fg("muted", "Tasks")} ${icons} ${theme.fg("dim", `(${done}/${tasks.length})`)}${name}`,
    )
  }
  return lines
}

export function hideGauntletWidgets(ctx: ExtensionContext): void {
  ctx.ui.setWidget("phase_tracker", undefined)
  ctx.ui.setWidget("plan_tracker", undefined)
}
