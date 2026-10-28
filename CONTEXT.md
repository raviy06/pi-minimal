# pi-minimal domain glossary

The vocabulary used in code and docs, one entry per concept, with the file that defines it.
When a word below has a narrower meaning than in everyday use, the narrower meaning wins.

## Surfaces pi-minimal owns

- **Chrome** — the three host slots pi-minimal draws into: the header (`src/header.ts`, intentionally
  empty), the footer (`src/footer.ts`) and the status line (`src/cwd.ts`, a widget above the editor;
  it is *not* pi's `setStatus`). pi has no owner concept for these, so chrome is re-asserted on
  events; see *reclaim*.
- **Reclaim** — re-installing chrome after an event that may have let another extension draw over
  it (`src/reclaim.ts`). A *reclaim reason* (`session_start`, `session_settle`, `turn_end`,
  `tool_execution_end`) maps to a policy: whether to reset the editor and whether to reinstall chrome.
- **Status line** — `model · thinking · context meter · cwd · ⎇ branch ±dirty · siblings`
  (`src/cwd.ts`). *Siblings* are other agents in the same host workspace with their state
  (`working | blocked | idle | done | error`).
- **Sibling source** — where siblings come from (`src/siblings.ts`, `SiblingSource`: `get`,
  `onChange`, `dispose`). Chosen from the environment at session start: the *Herdr source*
  polls `herdr agent list` / `herdr tab list` (`src/herdr.ts`, `HERDR_ENV=1`); the *Rex source*
  follows one `rex events -s SESSION --json` stream and reads OSC 7501 program-status records
  (`src/rex.ts`, `REX_SESSION` + `REX_BLOCK`). Herdr wins when both are set. A sibling's name is
  its tab label, or the program's `app` when the tab only has a Rex auto-label (`Window 1a2b…`).
- **Hints** — the keybinding labels in the footer (`send · thinking · expand tools`, plus
  `/compact` from 70 % context), shown only when idle with an empty editor (`src/footer.ts`).
  Not task hints and not the change hints other extensions emit.
- **Tool row** — one line per tool call: `glyph verb item … outcome` (`src/tools.ts`,
  `src/tool-rows.ts`). *Compact* rows are the built-in tools, *generic* rows are tools with no
  renderer of their own (most MCP tools), the *codemode* row has one child row per nested call.
  A row's **outcome** is its right-aligned summary (`34 lines · 1.0s`, `+3 −1`, `exit 1`).
- **Turn rule** — the dim `── 15:51 · 12s · 4 tools ──` separator appended after each agent run
  (`src/turn-rule.ts`). Stored as a `pi-minimal.turn` custom session entry, never sent to the model.
  Its data is a *TurnSummary*, unrelated to the plan slot.
- **Working status** — the transient `Thinking · 3s` / `Running ls · 2 tools · 5s` message while
  an agent runs (`src/working-status.ts`), driven by agent/tool/message events and cleared when
  the agent settles. Its state object is a *WorkingSnapshot*.
- **Thinking gutter** — the `┊` column in front of assistant thinking text (`src/transcript.ts`).
- **Code box** — the faint frame around fenced code blocks (`src/code-box.ts`, a pi-tui
  `Markdown.prototype.renderToken` patch).

- **Open PR** — an open pull request in the repo of `cwd` that I authored (*mine*) or that requests
  my review (*review*); PRs that merely mention me are not shown (`src/prs.ts`, `PullRequest`,
  `kind`). Found with `gh repo view` → `gh api user` (login differs per host) → `gh pr list
  --search involves:@me`. Shown as *chips* right-aligned on the footer's hints line (`src/footer.ts`): `#1675`, an OSC 8 hyperlink to the
  PR, coloured by `prColor` (trouble > review > draft > mine). `/prs` and the `list_open_prs` tool
  live in `src/prs-command.ts`. The *PR source* (`PrSource`) polls every 3 min and on `refreshGit`,
  throttled to once a minute.
- **Background process** — a process a `bash` tool call left running after it returned
  (`src/background.ts`). Found by diffing `ps` before/after the call: new, orphaned (ppid 1) and in a
  *tracked group*, a process group whose leader (the tool shell) was born and died inside the call.
  Groups are polled every 2 s until empty. A process is `running` or `ended` (gone from `ps`, kept
  60 s; no exit code is knowable). Shown as `⚙ N bg` after the hints on the footer's hints line (`src/footer.ts`) and listed in the
  *background overlay* (`src/background-overlay.ts`, `/bg` or `backgroundShortcut`, default `ctrl+b`).

## Footer contributions (the extension point)

- **Contribution** — data another extension publishes for pi-minimal to render in the footer,
  through the in-process `pi-minimal:footer:v1:*` events (`src/footer-contribution-events.ts`).
  pi-minimal keeps ownership of the footer; contributors never draw.
- **Slot** — one of two independent places a contribution can go: `activity` (agent rows) and
  `plan` (one plan bar). `summary` is the legacy wire name of the plan slot and stays accepted.
  One owner per slot per session (`src/footer-contributions.ts`).
- **Owner** vs **owner token** — `owner` is the registrant's display identity (a validated
  string). The *owner token* is the `Symbol` handed back on registration; it alone authorises
  `publish`/`dispose`. A slot is *occupied* while a token is live.
- **Snapshot** — a complete replacement value published to a slot. Two kinds:
  **ActivitySnapshot** (`revision`, `rows`, `omitted`, `motion`, `format`) and **PlanSnapshot**
  (`revision`, `format`, optional `plan`). Publishing never patches; it replaces.
- **Revision** — a per-slot monotonic counter on each snapshot. A publish whose revision is not
  greater than the current one is *stale* and ignored.
- **Activity row** — one keyed line in the activity slot: `agent`, `state`, `text`, optional
  `parentKey` (two levels of nesting), `metrics` (`elapsedMs`, `tokens`), `task`
  (`planId`, `id`, `status`). Rendered in producer order, at most four plus `+ N more`
  (`src/footer-activity.ts`, `src/footer-activity-details.ts`).
- **Activity state** — `queued | running | waiting | paused | stopping | completed | failed |
  stopped | unknown`. Display-only; pi-minimal infers nothing about execution from it.
- **Plan** — the plan slot's payload: `id`, `accepted`, `total`, `inReview`, `blocked`. Counts
  are supplied by the contributor, never inferred from agent runs (`src/footer-plan.ts`).
- **Task status (contribution)** — `todo | in_progress | blocked | in_review | done | cancelled`
  on an activity row's `task`. Distinct from the gauntlet task status below.

## Legacy pi-gauntlet projection

- **Gauntlet projection** — what pi-gauntlet last reported on the session branch, read from its
  `phase_tracker` / `plan_tracker` tool-result `details` (`src/tracker.ts`,
  `readGauntletProjection`). A projection of another extension's history, not a contribution:
  unversioned and only as stable as those tools' result shapes. A rendered plan line from the
  plan slot replaces it in the footer.
- **Phase** — `brainstorm → plan → implement → verify → ship`, each
  `pending | in_progress | complete | skipped`.
- **Gauntlet task status** — `pending | in_progress | complete | failed` (`GauntletTaskStatus`).
  Not interchangeable with the contribution task status.
- **hideGauntletWidgets** — opt-in setting to clear pi-gauntlet's own widgets on each reclaim,
  since the footer already shows that data (`src/config.ts`).

## Process vs session

- **Load-time hooks** — installed once per extension instance: tool renderers, the markdown
  transformer, the code-box patch, working status and the turn rule (`src/index.ts`).
- **Session** — everything scoped to one pi session: config, cwd, the contribution registry,
  git poller, sibling source, settle timers and chrome (`src/session.ts`, when present). Created on
  `session_start`, disposed on `session_shutdown` or when the next session starts.
- **Chrome margin** — pi's `outputPad`, mirrored on `globalThis` so module copies reloaded by
  `/reload` agree (`src/chrome.ts`).
