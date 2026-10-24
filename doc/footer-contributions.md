# Footer activity contributions (v1)

Pi-minimal remains the single footer owner. A trusted companion extension can publish a bounded activity snapshot without replacing the footer or fighting other widgets. With no contributor, existing hints and legacy phase/task summaries are unchanged.

Order: **existing hints → legacy tracker lines → activity rows last**. The only supported slot in v1 is `activity`; this does not implement a task tracker, subagent launcher, or PR/workspace display.

## Events

| Event | Direction | Payload |
|---|---|---|
| `pi-minimal:footer:v1:register` | consumer → host | Mutable registration request; host assigns `result` synchronously |
| `pi-minimal:footer:v1:ready` | host → consumers | `{ version: 1, sessionId, slots: ["activity"] }` |
| `pi-minimal:footer:v1:unavailable` | host → consumers | `{ version: 1, sessionId }` |

Use `ctx.sessionManager.getSessionId()`, not a file path. Events are in-process only, not a cross-process API. One consumer owns the activity slot at a time. Names/keys are display identity, not permission or process-control tokens.

Register during `session_start`; also listen for `ready` to tolerate either extension load order. Clear the local handle on `unavailable`. Do not attempt to reinstall the footer if no host responds.

```ts
const request = {
  version: 1,
  sessionId: ctx.sessionManager.getSessionId(),
  owner: "my-activity-extension",
  slot: "activity",
  result: undefined as RegisterRequest["result"],
};
pi.events.emit("pi-minimal:footer:v1:register", request);
if (request.result?.ok) {
  const registration = request.result.registration;
  const result = registration.publish({
    revision: 0,
    motion: "spinner",
    format: "icons",
    omitted: 0,
    rows: [
      { key: "child-1", agent: "worker", state: "running", text: "Last: executing tests" },
      { key: "child-2", agent: "reviewer", state: "completed", text: "Review output available" },
    ],
  });
  // Inspect result.ok; publication is not a task-completion acknowledgement.
  // On consumer shutdown: registration.dispose().
}
```

This snippet assumes the following structural types, copied into the consumer or maintained as a type-only development contract. No runtime import from an independently installed npm package is necessary. `src/footer-contribution-events.ts` and `src/footer-contributions.ts` are the host's canonical definitions.

```ts
type RegisterRequest = {
  version: 1;
  sessionId: string;
  owner: string;
  slot: "activity";
  result?:
    | { ok: true; registration: {
        publish(snapshot: unknown): { ok: true } | { ok: false; code: string };
        dispose(): void;
      } }
    | { ok: false; code: string };
};
```

No result means the host is absent/not ready. Registration errors include `invalid`, `wrong-session`, `occupied`, and `not-tui`. Publish errors include `invalid`, `stale`, and `disposed`.

## Snapshot schema

- `revision`: nonnegative safe integer, strictly increasing for each successful publish on one registration. Start at zero again after a new registration.
- `motion`: `spinner` or `static`.
- `format`: `icons` or `plain` (explicit textual state labels).
- `omitted`: nonnegative safe integer; extra underlying records not supplied in this snapshot.
- `rows`: at most 64 records; an empty array clears visible activity without releasing ownership.

Each row:
- `key`: unique 1–128 character identity, ASCII letters/numbers plus `. _ : @ + -`.
- `agent`: nonempty label after sanitization, at most 96 input characters.
- `state`: `queued`, `running`, `waiting`, `paused`, `stopping`, `completed`, `failed`, `stopped`, or `unknown`.
- `text`: at most 256 input characters; keep it short, safe, and evidence-grounded.
- Optional `parentKey`: references a key in the same snapshot. Missing references, self-parenting, and cycles are rejected.
- Optional `metrics`: `{ elapsedMs?: number, tokens?: number }`. Both values must be nonnegative safe integers. An absent object preserves the original compact row; an empty object displays unknown values (`—`, or `-` in plain mode), never invented zeros.
- Optional `task`: `{ planId: string, id: string, status: "todo" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled" }`. Both IDs use the same bounds as row keys. The link is display context, not permission to read/write a plan.

Metrics are right-aligned only if the full activity text still fits with at least two columns of separation. Drop tokens first, then time, before truncating activity. Elapsed time is supplied by the producer: compute from the run start while active, freeze at the run's end, and do not advance completed/unknown runs by inference. `tokens` means this child's own cumulative reported input + output tokens, excluding separately summed descendants. It is not context-window occupancy; omit unavailable data rather than guessing. The host does not calculate elapsed time from wall-clock time.

Task IDs appear beside activity. In-progress tasks need no extra badge; blocked/review/accepted/cancelled tasks get a distinct badge, and plain mode retains textual status. A completed agent with an `in_review` task shows a green run check plus an accent review diamond. This optional data does not create a tracker or automatically accept a task.

Owner uses the same character/length rules as row keys. Display text has ANSI/OSC, C0/C1, and bidi controls removed, with whitespace collapsed. The host clones and freezes validated snapshots. Invalid/stale publishes preserve the previous valid snapshot. Consumers must handle publish failure and send an explicit unknown/error observation when appropriate; an absent update does not prove a run ended.

## Presentation and responsibility boundaries

The host renders the first four supplied rows and one overflow line, without reordering them. Consumer owns stable ordering, priority, retention, dismissal and source reconciliation. Nesting is indented at most two levels. Terminal-width helpers enforce visible-column limits.

Running uses pi-minimal's yellow `◐`/`◓` frames every 400ms. Completed uses green `✓`; failed uses red `✗`. Attention/stopping is yellow `!`; stopping includes an explicit prefix. Other shapes remain distinct in monochrome. Plain mode retains state words and does not animate. `static` also disables animation. Consumers should choose static/plain according to user accessibility preferences; this terminal contract does not pretend to detect browser reduced-motion settings.

Only visible running rows animate; animation performs no provider queries, model calls, or filesystem reads. Host semantic theme colors are resolved each render. A completed run means only that run completed; it must not be presented as accepted task work without separate evidence.

The host does not validate execution truth. It validates display shape and lifecycle ownership. It does not publish or hide pi-subagents widgets, mutate any other extension's settings, store run history, or expose stop/steer actions.

## Lifecycle and rollback

Footer component reinstalls preserve the session registry, while disposing old redraw/branch listeners and animation timers. Session shutdown/replacement invalidates registration handles even if the next session reuses the same ID. A stale disposer cannot clear a newer owner. Dispose is idempotent.

Consumers dispose their handle and event subscriptions on shutdown, and register again in the new runtime. Use strictly increasing revisions to prevent late responses overwriting fresh data; request/session correlation remains the consumer's responsibility.

Disable the consumer to remove activity rows. No process is stopped and no task state is changed. The host contribution API is inert without a consumer. Test a new consumer in an isolated pi profile before changing live configuration.

This is a trusted extension contract, not a sandbox against malicious code already loaded into the process.
