import { hyperlink } from "@earendil-works/pi-tui";
import { createListeners } from "./listeners.js";
export const PR_LIST_FIELDS = "number,title,url,isDraft,author,reviewRequests,reviewDecision,statusCheckRollup,updatedAt";
/** Parses `gh repo view --json nameWithOwner,url`. */
export function parseRepoView(stdout) {
    const data = JSON.parse(stdout);
    if (typeof data.nameWithOwner !== "string" || typeof data.url !== "string")
        throw new Error("invalid gh repo view");
    return { nameWithOwner: data.nameWithOwner, host: new URL(data.url).host, url: data.url };
}
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
export function ciFailing(checks) {
    return (checks ?? []).some((check) => FAILED_STATES.has(check.state ?? "") || FAILED_CONCLUSIONS.has(check.conclusion ?? ""));
}
/**
 * Parses `gh pr list --json …` for `involves:@me` into my PRs: authored by `login`, or requesting
 * my review (directly; team requests are included when `teams` lists my team slugs). Others I'm
 * merely mentioned on are dropped.
 */
export function parsePrList(stdout, repo, login, teams = []) {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data))
        throw new Error("invalid gh pr list");
    const teamSet = new Set(teams.map((team) => team.toLowerCase()));
    const prs = [];
    for (const raw of data) {
        if (typeof raw.number !== "number" || typeof raw.url !== "string")
            continue;
        const author = typeof raw.author?.login === "string" ? raw.author.login : "";
        const requested = (raw.reviewRequests ?? []).some((request) => {
            if (typeof request.login === "string")
                return request.login.toLowerCase() === login.toLowerCase();
            const slug = typeof request.slug === "string" ? request.slug : typeof request.name === "string" ? request.name : "";
            return teamSet.has(slug.toLowerCase());
        });
        const mine = author.toLowerCase() === login.toLowerCase();
        if (!mine && !requested)
            continue;
        prs.push({
            number: raw.number,
            title: typeof raw.title === "string" ? raw.title : "",
            url: raw.url,
            repo: `${repo.host}/${repo.nameWithOwner}`,
            author,
            isDraft: raw.isDraft === true,
            kind: mine ? "mine" : "review",
            reviewDecision: typeof raw.reviewDecision === "string" ? raw.reviewDecision : "",
            ciFailing: ciFailing(raw.statusCheckRollup),
            updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
        });
    }
    // Review requests first (they need me), then mine; newest first within each.
    prs.sort((a, b) => (a.kind === b.kind ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.kind === "review" ? -1 : 1));
    return prs;
}
/** Chip colour: trouble (failing CI, changes requested) wins, then review requests, then drafts. */
export function prColor(pr) {
    if (pr.ciFailing || pr.reviewDecision === "CHANGES_REQUESTED")
        return "error";
    if (pr.kind === "review")
        return "warning";
    if (pr.isDraft)
        return "dim";
    return "accent";
}
export const PR_LEGEND = "#n mine · dim draft · amber needs my review · red failing CI / changes requested";
/** Status-line segment: `#1675 #1670 +3` with each number an OSC 8 link; undefined when empty. */
export function prSegment(prs, theme, max = 4) {
    if (prs.length === 0)
        return undefined;
    const shown = prs.slice(0, max);
    const chips = shown.map((pr) => theme.fg(prColor(pr), hyperlink(`#${pr.number}`, pr.url)));
    const rest = prs.length - shown.length;
    if (rest > 0)
        chips.push(theme.fg("dim", `+${rest}`));
    return chips.join(" ");
}
export function describePr(pr) {
    const flags = [
        pr.kind === "review" ? "review requested" : pr.isDraft ? "draft" : "mine",
        pr.ciFailing ? "CI failing" : undefined,
        pr.reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : pr.reviewDecision === "APPROVED" ? "approved" : undefined,
    ].filter(Boolean);
    return `#${pr.number}  ${pr.title}  · ${flags.join(" · ")}${pr.kind === "review" ? ` · @${pr.author}` : ""}`;
}
const GH_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 3 * 60_000;
const DEFAULT_MIN_INTERVAL_MS = 60_000;
export function createPrSource(deps) {
    const now = deps.now ?? Date.now;
    const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    const listeners = createListeners();
    let alive = true;
    let state = { prs: [] };
    let inFlight;
    let timer;
    let lastRun = 0;
    const logins = new Map();
    // Only what is displayed counts as a change; a refresh that confirms the same list is silent.
    const visible = (snap) => JSON.stringify([snap.repo, snap.prs, snap.error]);
    const set = (next) => {
        const changed = visible(next) !== visible(state);
        state = next;
        if (changed)
            listeners.notify();
    };
    const gh = (args) => deps.pi.exec("gh", args, { cwd: deps.cwd(), timeout: GH_TIMEOUT_MS });
    const viewerLogin = async (host) => {
        const cached = logins.get(host);
        if (cached)
            return cached;
        const run = await gh(["api", "--hostname", host, "user", "--jq", ".login"]);
        if (run.code !== 0)
            return undefined;
        const login = run.stdout.trim();
        if (login)
            logins.set(host, login);
        return login || undefined;
    };
    const fetchOnce = async () => {
        let repo = state.repo;
        try {
            if (!repo) {
                const view = await gh(["repo", "view", "--json", "nameWithOwner,url"]);
                if (!alive)
                    return;
                if (view.code !== 0) {
                    // Not a GitHub repo (or gh not authenticated): show nothing, keep polling slowly.
                    set({ prs: [], error: view.stderr.trim() || "gh repo view failed" });
                    return;
                }
                repo = parseRepoView(view.stdout);
            }
            const login = await viewerLogin(repo.host);
            if (!alive)
                return;
            if (!login) {
                set({ repo, prs: [], error: `gh is not authenticated for ${repo.host}` });
                return;
            }
            const list = await gh([
                "pr", "list", "-R", `${repo.host}/${repo.nameWithOwner}`, "--state", "open", "--limit", "100",
                "--search", "involves:@me", "--json", PR_LIST_FIELDS,
            ]);
            if (!alive)
                return;
            if (list.code !== 0) {
                set({ repo, prs: state.prs, error: list.stderr.trim() || "gh pr list failed", fetchedAt: state.fetchedAt });
                return;
            }
            set({ repo, prs: parsePrList(list.stdout, repo, login), fetchedAt: now() });
        }
        catch (error) {
            if (!alive)
                return;
            set({ repo, prs: state.prs, error: error instanceof Error ? error.message : String(error), fetchedAt: state.fetchedAt });
        }
    };
    const schedule = () => {
        if (!alive)
            return;
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => { void refresh(true); }, pollMs);
        timer.unref?.();
    };
    const refresh = (force = false) => {
        if (!alive)
            return Promise.resolve();
        if (inFlight)
            return inFlight;
        if (!force && now() - lastRun < minIntervalMs)
            return Promise.resolve();
        lastRun = now();
        inFlight = fetchOnce().finally(() => {
            inFlight = undefined;
            schedule();
        });
        return inFlight;
    };
    void refresh(true);
    return {
        get: () => state,
        onChange: listeners.add,
        refresh,
        dispose() {
            if (!alive)
                return;
            alive = false;
            if (timer)
                clearTimeout(timer);
            timer = undefined;
            listeners.clear();
        },
    };
}
