import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
const count = (value) => Number.isSafeInteger(value) && value >= 0;
export function normalizePlanSnapshot(value) {
    if (!record(value) || !count(value.revision) || (value.format !== "icons" && value.format !== "plain"))
        return;
    if (value.plan === undefined)
        return Object.freeze({ revision: value.revision, format: value.format });
    const plan = value.plan;
    if (!record(plan) || typeof plan.id !== "string" || !/^[a-zA-Z0-9._:@+-]{1,128}$/.test(plan.id) ||
        !count(plan.accepted) || !count(plan.total) || !count(plan.inReview) || !count(plan.blocked) ||
        plan.accepted > plan.total || plan.inReview > plan.total - plan.accepted || plan.blocked > plan.total - plan.accepted)
        return;
    return Object.freeze({ revision: value.revision, format: value.format,
        plan: Object.freeze({ id: plan.id, accepted: plan.accepted, total: plan.total, inReview: plan.inReview, blocked: plan.blocked }) });
}
/** Display-only accepted-task counts, never inferred from agent execution. */
export function renderFooterPlan(snapshot, width, theme) {
    if (!snapshot?.plan || width <= 0)
        return [];
    const { id, accepted, total, inReview, blocked } = snapshot.plan;
    const plain = snapshot.format === "plain", separator = plain ? " / " : " · ";
    const label = theme.fg("accent", `Plan ${id}`);
    if (!total)
        return [truncateToWidth(`${label}${separator}No tasks yet`, width)];
    const slots = total <= 12 ? total : 10;
    const filled = total <= 12 ? accepted : Math.floor(accepted / total * slots);
    const bar = theme.fg("accent", (plain ? "#" : "▰").repeat(filled)) + theme.fg("muted", (plain ? "." : "▱").repeat(slots - filled));
    const counts = `${accepted}/${total}`;
    const attention = [inReview ? `${plain ? "" : "◇ "}${inReview} review` : "", blocked ? `! ${blocked} blocked` : ""].filter(Boolean);
    const suffix = attention.length ? separator + attention.join(separator) : "";
    for (const text of [`${label}${separator}${bar} ${counts}${suffix}`, `${label}${separator}${counts}${suffix}`, `${label}${separator}${counts}`]) {
        if (visibleWidth(text) <= width)
            return [text];
    }
    // Exact counts outrank a long plan label on extremely narrow terminals.
    const room = width - visibleWidth(counts) - 1;
    return [room > 0 ? `${truncateToWidth(label, room)} ${counts}` : truncateToWidth(counts, width)];
}
