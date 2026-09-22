export type ToolKind = "read" | "edit" | "write" | "bash" | "grep" | "find" | "ls"

export type ToolArgs = {
  command?: unknown
  path?: unknown
  file_path?: unknown
  pattern?: unknown
  target_directory?: unknown
}

export type GroupedRow = {
  header?: string
  item: string
}

type ActivityGroup = {
  verb: string
  leadId: string
  seen: Set<string>
}

let activityGroup: ActivityGroup | undefined

export function resetActivityGroup(): void {
  activityGroup = undefined
}

export function shortName(path: string): string {
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= 1) return path || ""
  return parts.slice(-2).join("/")
}

export function toolItem(kind: ToolKind, args: ToolArgs | undefined): string {
  if (kind === "bash") {
    const command = typeof args?.command === "string" ? args.command.split("\n")[0]?.trim() ?? "" : ""
    return command || "bash"
  }
  if (kind === "grep" || kind === "find") {
    return typeof args?.pattern === "string" && args.pattern ? args.pattern : kind
  }
  const path =
    (typeof args?.path === "string" && args.path) ||
    (typeof args?.file_path === "string" && args.file_path) ||
    (typeof args?.target_directory === "string" && args.target_directory) ||
    ""
  return path ? shortName(path) : kind
}

export function nextGroupedRow(verb: string, item: string, id: string): GroupedRow {
  if (activityGroup && activityGroup.verb === verb) {
    activityGroup.seen.add(id)
    if (id === activityGroup.leadId) return { header: verb, item }
    return { header: undefined, item }
  }
  activityGroup = { verb, leadId: id, seen: new Set([id]) }
  return { header: verb, item }
}
