let activityGroup;
export function resetActivityGroup() {
    activityGroup = undefined;
}
export function shortName(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 1)
        return path || "";
    return parts.slice(-2).join("/");
}
export function toolItem(kind, args) {
    if (kind === "bash") {
        const command = typeof args?.command === "string" ? args.command.split("\n")[0]?.trim() ?? "" : "";
        return command || "bash";
    }
    if (kind === "grep" || kind === "find") {
        return typeof args?.pattern === "string" && args.pattern ? args.pattern : kind;
    }
    const path = (typeof args?.path === "string" && args.path) ||
        (typeof args?.file_path === "string" && args.file_path) ||
        (typeof args?.target_directory === "string" && args.target_directory) ||
        "";
    return path ? shortName(path) : kind;
}
export function nextGroupedRow(verb, item, id) {
    if (activityGroup && activityGroup.verb === verb) {
        activityGroup.seen.add(id);
        if (id === activityGroup.leadId)
            return { header: verb, item };
        return { header: undefined, item };
    }
    activityGroup = { verb, leadId: id, seen: new Set([id]) };
    return { header: verb, item };
}
