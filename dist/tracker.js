const PHASES = ["brainstorm", "plan", "implement", "verify", "ship"];
function readSnapshot(ctx) {
    let phases;
    let tasks;
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message")
            continue;
        const msg = entry.message;
        if (msg.role !== "toolResult" || !msg.details || msg.details.error)
            continue;
        if (msg.toolName === "phase_tracker" && msg.details.phases) {
            phases = msg.details.phases;
        }
        if (msg.toolName === "plan_tracker" && msg.details.tasks) {
            tasks = msg.details.tasks;
        }
    }
    return { phases, tasks };
}
function phaseActive(phases) {
    return PHASES.some((p) => phases[p]?.status && phases[p].status !== "pending");
}
export function formatTrackerLines(ctx, theme) {
    const { phases, tasks } = readSnapshot(ctx);
    const lines = [];
    if (phases && phaseActive(phases)) {
        const parts = PHASES.map((p) => {
            const st = phases[p]?.status || "pending";
            const icon = st === "complete"
                ? theme.fg("success", "✓")
                : st === "in_progress"
                    ? theme.fg("warning", "→")
                    : st === "skipped"
                        ? theme.fg("dim", "⊘")
                        : theme.fg("dim", "○");
            const label = st === "skipped" ? theme.fg("dim", p) : p;
            return `${icon} ${label}`;
        });
        lines.push(`${theme.fg("muted", "Phases")} ${parts.join(theme.fg("dim", " → "))}`);
    }
    if (tasks && tasks.length > 0) {
        const done = tasks.filter((t) => t.status === "complete").length;
        // One segment per task, coloured by status, so the list reads as a single bar instead of a
        // row of check marks. Past 12 tasks the bar is scaled to 10 segments (status order kept).
        const segment = (status) => {
            if (status === "complete")
                return theme.fg("success", "▰");
            if (status === "in_progress")
                return theme.fg("warning", "▰");
            if (status === "failed")
                return theme.fg("error", "▰");
            return theme.fg("dim", "▱");
        };
        const shown = tasks.length <= 12
            ? tasks.map((t) => t.status)
            : Array.from({ length: 10 }, (_, i) => tasks[Math.floor((i * tasks.length) / 10)]?.status);
        const icons = shown.map(segment).join("");
        const current = tasks.find((t) => t.status === "in_progress") ?? tasks.find((t) => t.status === "pending");
        const name = current ? theme.fg("text", ` ${current.name}`) : "";
        lines.push(`${theme.fg("muted", "Tasks")} ${icons} ${theme.fg("dim", `${done}/${tasks.length}`)}${name}`);
    }
    return lines;
}
export function hideGauntletWidgets(ctx) {
    ctx.ui.setWidget("phase_tracker", undefined);
    ctx.ui.setWidget("plan_tracker", undefined);
}
