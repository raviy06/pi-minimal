import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
export function taskPrefix(task, plain, theme) {
    if (!task)
        return "";
    if (plain)
        return `[${task.status}] ${task.id} / `;
    const badges = {
        blocked: ["!", "warning"], in_review: ["◇", "accent"], done: ["✓", "success"], cancelled: ["⊘", "muted"],
    };
    const badge = badges[task.status];
    return `${badge ? theme.fg(badge[1], badge[0]) + " " : ""}${task.id} · `;
}
function elapsed(ms, missing) {
    if (ms === undefined)
        return missing;
    const seconds = Math.floor(ms / 1000);
    if (seconds >= 3600)
        return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m`;
    if (seconds >= 60)
        return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
    return `${seconds}s`;
}
function tokens(value, missing) {
    if (value === undefined)
        return missing;
    if (value >= 999950)
        return `${(value / 1000000).toFixed(1)}m`;
    if (value >= 1000)
        return `${(value / 1000).toFixed(1)}k`;
    return String(value);
}
/** Metrics never displace activity text: first drop tokens, then elapsed time. */
export function alignActivityMetrics(left, metrics, width, plain, theme) {
    if (metrics) {
        const missing = plain ? "-" : "—";
        const time = elapsed(metrics.elapsedMs, missing);
        const full = `${time}${plain ? " / " : " · "}${tokens(metrics.tokens, missing)} tok`;
        for (const right of [full, time]) {
            const gap = width - visibleWidth(left) - visibleWidth(right);
            if (gap >= 2)
                return left + " ".repeat(gap) + theme.fg("muted", right);
        }
    }
    return truncateToWidth(left, width);
}
