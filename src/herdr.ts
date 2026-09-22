export type HerdrAgent = {
  agent: string
  agent_status: string
  pane_id: string
  tab_id: string
}

export type HerdrTab = {
  label: string
  tab_id: string
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout)
}

export function parseAgentList(stdout: string): HerdrAgent[] {
  const data = parseJson(stdout) as {
    result?: { agents?: Array<Record<string, unknown>> }
  }
  const rows = data.result?.agents
  if (!Array.isArray(rows)) throw new Error("invalid herdr agent list")
  return rows.map((row) => ({
    agent: String(row.agent ?? ""),
    agent_status: String(row.agent_status ?? ""),
    pane_id: String(row.pane_id ?? ""),
    tab_id: String(row.tab_id ?? ""),
  }))
}

export function parseTabList(stdout: string): HerdrTab[] {
  const data = parseJson(stdout) as {
    result?: { tabs?: Array<Record<string, unknown>> }
  }
  const rows = data.result?.tabs
  if (!Array.isArray(rows)) throw new Error("invalid herdr tab list")
  return rows.map((row) => ({
    label: String(row.label ?? ""),
    tab_id: String(row.tab_id ?? ""),
  }))
}

export type Sibling = {
  name: string
  status: string
}

export function listSiblings(
  agents: HerdrAgent[],
  tabs: HerdrTab[],
  selfPane?: string,
  selfTab?: string,
): Sibling[] | undefined {
  if (!selfPane && !selfTab) return undefined
  const labels = new Map(tabs.map((t) => [t.tab_id, t.label]))
  const parts: Sibling[] = []
  for (const agent of agents) {
    if (selfPane && agent.pane_id === selfPane) continue
    if (!selfPane && selfTab && agent.tab_id === selfTab) continue
    const name = labels.get(agent.tab_id) || agent.agent
    if (!name) continue
    parts.push({ name, status: agent.agent_status })
  }
  if (parts.length === 0) return undefined
  return parts
}
