function parseJson(stdout) {
    return JSON.parse(stdout);
}
export function parseAgentList(stdout) {
    const data = parseJson(stdout);
    const rows = data.result?.agents;
    if (!Array.isArray(rows))
        throw new Error("invalid herdr agent list");
    return rows.map((row) => ({
        agent: String(row.agent ?? ""),
        agent_status: String(row.agent_status ?? ""),
        pane_id: String(row.pane_id ?? ""),
        tab_id: String(row.tab_id ?? ""),
    }));
}
export function parseTabList(stdout) {
    const data = parseJson(stdout);
    const rows = data.result?.tabs;
    if (!Array.isArray(rows))
        throw new Error("invalid herdr tab list");
    return rows.map((row) => ({
        label: String(row.label ?? ""),
        tab_id: String(row.tab_id ?? ""),
    }));
}
export function listSiblings(agents, tabs, selfPane, selfTab) {
    if (!selfPane && !selfTab)
        return undefined;
    const labels = new Map(tabs.map((t) => [t.tab_id, t.label]));
    const parts = [];
    for (const agent of agents) {
        if (selfPane && agent.pane_id === selfPane)
            continue;
        if (!selfPane && selfTab && agent.tab_id === selfTab)
            continue;
        const name = labels.get(agent.tab_id) || agent.agent;
        if (!name)
            continue;
        parts.push({ name, status: agent.agent_status });
    }
    if (parts.length === 0)
        return undefined;
    return parts;
}
