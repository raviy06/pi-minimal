# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Releases are cut automatically: when the `version` in `package.json` changes on
`main`, the Publish workflow tags it, publishes to npm, and uses the matching
`## [x.y.z]` section below as the top of the release notes.

## [Unreleased]

### Added

- Open PRs: the footer shows `#1675 #1670 +3` chips, right-aligned on the hints line below the editor, for open PRs in the repo of cwd that you
  authored or were asked to review, each an OSC 8 hyperlink to the PR, coloured accent (mine), dim
  (my draft), amber (needs my review) or red (failing CI / changes requested). `/prs [mine|review|all]`
  lists them with open / paste URL / checkout actions; `list_open_prs` tool for the model. Uses the
  `gh` CLI; works on GitHub.com and GitHub Enterprise. New peer dependency `@earendil-works/pi-ai`
  (supplied by pi) for the tool schema.
- Background processes: `⚙ N bg` after the key hints in the footer while processes left behind by `bash` tool
  calls are running; `ctrl+b` / `/bg` opens an overlay listing each one with running/ended state and
  duration, `k` kills the selection, `K` its process group. Attribution diffs `ps` around each bash
  call using pi's detached process groups, so no command is rewritten. New `backgroundShortcut`
  setting (`"ctrl+b"`; `null` disables the key).

- Rex siblings: inside a Rex session (`REX_SESSION` + `REX_BLOCK`) the status line shows other
  panes' agent state, read from Rex's Program Status Protocol (OSC 7501) over one
  `rex events --json` stream instead of polling. Needs a reporter in each pi (an extension that
  writes OSC 7501 on `agent_start` / `agent_settled`); programs such as claude-code or terraform
  that already speak the protocol appear as well. `error` renders like `blocked`.

### Changed

- Sibling status now comes from a `SiblingSource` (`src/siblings.ts`) picked from the environment;
  the Herdr poller moved from `session.ts` into `herdr.ts` unchanged. Herdr wins when both hosts
  are present. The status line re-renders when the sibling list changes, not only on git changes.

## [0.5.0] - 2026-10-27

Session lifecycle, one tool-row lifecycle, and a domain glossary. `hideGauntletWidgets`
is now opt-in and the 200 ms chrome steal interval is gone.

### Added

- `write` rows show the written content (first 400 lines) when expanded with `ctrl+o`.
- With `editDiff: "expanded"` (the default), diffs of up to 8 lines are shown inline;
  hiding them saved nothing and cost a keypress. Longer diffs still wait for `ctrl+o`.
- `CONTEXT.md`: a glossary of the domain (chrome, reclaim, slots, owner token, the snapshot
  kinds, plan vs the legacy pi-gauntlet projection, activity rows, hints, turn rule, working
  status). The 0.1 spec and plan moved to `doc/archive/`.
- The plan slot can be addressed as `slot: "plan"`; `summary` stays accepted as its legacy
  name and the ready event now lists `["activity", "plan", "summary"]`.

### Changed

- `hideGauntletWidgets` now defaults to `false`. Hiding another extension's widgets is
  opt-in; set it to `true` to keep the previous behaviour.
- Chrome is re-asserted only on events (session start and its two settle ticks, turn
  end, tool end). The 200 ms interval that cleared pi-gauntlet's widgets five times a
  second is gone; it never reinstalled the header or footer anyway.
- All session-scoped state (config, cwd, the footer contribution registry, the git and
  Herdr pollers, the chrome) now lives on one `Session` object created at session start
  and disposed at shutdown or when the next session starts. Late async results from a
  disposed session are dropped instead of drawing into the new one.
- The compact, generic and codemode tool rows are now three small strategies over one
  row lifecycle (`createRowRenderers`): running state, live spinner, status colours,
  the error line and expansion are implemented once. Edit-diff colouring moved to
  `src/edit-diff.ts`. No visible change beyond the two items above.
- Internal renames for clarity: `TrackerSnapshot` → `GauntletProjection`,
  `readSnapshot` → `readGauntletProjection`, the tracker's `TaskStatus` →
  `GauntletTaskStatus`, and the slot's authority symbol is `ownerToken`. No wire change.
- `doc/footer-contributions.md` now states precisely when the legacy projection is replaced
  (only while a plan line renders), how control characters are sanitised (VT stripped,
  C0/C1/bidi replaced with spaces), and that `inReview`/`blocked` are bounded individually.

### Fixed

- The working message is cleared on session shutdown; it used to drop the context
  before clearing and leave the last status on screen.
- Git state reads the working directory once per refresh, so branch and dirty count
  always describe the same tree, and one throwing change listener no longer blocks
  the others.

## [0.4.0] - 2026-10-27

### Added

- `editDiff` setting in `pi-minimal.json`: controls whether an `edit` row shows the
  change itself. `"expanded"` (default) shows the unified diff in the `│`-ruled
  block when the row is expanded with `ctrl+o`, where the bare "Successfully
  replaced" text used to be. `"always"` shows it inline as soon as the edit lands,
  capped at 40 lines with `… N more lines (ctrl+o)` for the rest. `"never"` keeps
  the stats-only row. Lines use the theme's `toolDiffAdded` / `toolDiffRemoved` /
  `toolDiffContext` colours and keep pi's line-number gutter; when one line
  replaces one line, only the changed tokens are inverse-highlighted, as in pi's
  own edit renderer. Failed edits and results without a diff are unchanged.

## [0.3.1] - 2026-10-25

### Added
- Compact rows for tools that bring no renderer of their own, such as most MCP tools and
  `subagents_enable`: `✓ mcp   re_mcp · query_prometheus query=… step=1m   12 lines · 1.4s`.
  The verb is `mcp`, `agent` (subagent tools) or `tool`; up to three scalar arguments show as
  `key=value`; a short single-line result shows verbatim, otherwise a line count. Failures show
  their first line underneath; `ctrl+o` shows the full result. Tools that draw themselves
  (the `subagent` live view, pi-gauntlet's trackers) keep their own renderer.

### Changed
- Bash rows drop `cd <session cwd> && ` and shorten other `cd <dir> && ` prefixes to the
  directory name (`pi-subagents › sed -n …`), so the part that differs between rows is visible
  and the outcome column stays put. Multi-line commands such as heredocs say how many lines follow
  (`python3 - <<'EOF' · +4 lines`).
- The thinking gutter `┊` now runs down every line of a thinking paragraph, including lines the
  terminal wraps: paragraphs are pre-wrapped to the content width the host renders at (re-done on
  resize). Previously only the first line of each paragraph had it, so wrapped thinking sat flush
  with prose. Inline code stays whole; lists, quotes and fenced code are untouched.
- The task tracker line is a segmented bar coloured by status (`Tasks ▰▰▰▰▱ 4/5`) instead of a
  run of check marks; past 12 tasks it scales to 10 segments.

## [0.3.0] - 2026-10-25

### Added
- `codemode` renders as a tool row: `✓ code  3 calls · plan_tracker ×2, bash … 54 lines · 1.2s`,
  with one child row per nested call. Built-in tools inside a script read exactly like their
  top-level rows (`bash` shows its command); other tools show up to three scalar arguments as
  `key=value` instead of raw JSON. Children update live while the script runs. The script source
  and output appear only on `ctrl+o`, in plain dim text, so syntax colours no longer compete with
  status colours. A failed nested call or script error shows its first line under the row, like
  `bash`. Previously codemode fell through to pi-core's default panel: a background slab with the
  highlighted script, JSON arguments, an output preview and a `Took …` timer.

### Changed
- `minimal-dark` contrast: `dim` (verbs, outcomes, tool output) L 48 % → 56 % and `thinkingText`
  52 % → 58 %, estimated ~3.1:1 → ~4.4:1 and ~3.7:1 → ~4.8:1 on the background. They were within
  4 % of each other and below WCAG's 4.5:1 text target. `faint` 34 % → 36 %.
- `minimal-dark` keeps syntax colours off the status hues: `syntaxFunction` was warning-yellow
  (now lavender) and `syntaxNumber` was success-green (now teal), so code no longer looks like a
  spinner or a check mark.
- `minimal-dark` draws no background behind pending/successful tool output (`toolPendingBg`,
  `toolSuccessBg` → `bg`). Tools pi-minimal does not restyle yet (`subagent`, MCP tools) lose
  their slab; failures keep `toolErrorBg`.

## [0.2.3] - 2026-10-24

### Added
- Versioned, session-scoped footer activity contribution API. Companion extensions
  can publish bounded activity rows after existing hints and tracker summaries
  without replacing the footer. No visible change without a contributor.
- Icon-first activity rows with pi-minimal's spinner/check/failure colors,
  plain/static modes, overflow handling, optional elapsed time/token metrics,
  and optional task links with independent task-state badges.
- Snapshot validation, immutable metadata, exclusive slot ownership, stale-update
  protection, and integration documentation.
- Independent plan-summary contribution slot with violet slanted progress segments
  and exact accepted/total counts, rendered below the input. One blank row
  separates nonempty footer groups; activity rows stay compact. The summary is
  display-only and does not add task storage or infer acceptance from agent runs.
- Release checks for matching manifest/lockfile versions and a dated changelog entry.

### Fixed
- Dispose activity subscriptions and animation timers across footer replacement
  and shutdown; prevent delayed settle callbacks from reinstalling stale chrome.
- Synchronize the previously stale lockfile package version with the manifest.

## [0.2.2] - 2026-10-22

### Added
- Fenced code renders as a closed box (`╭─ lang ─╮` / `│ code │` / `╰───╯`)
  instead of literal ``` lines, keeping syntax highlighting; long lines wrap
  inside the box. pi-tui exposes no hook for this, so pi-minimal post-processes
  the code token's rendered lines.

### Changed
- Chrome margin (status line, footer, turn rule, tool rows) follows pi's
  `outputPad` setting so it lines up with transcript text. Set
  `editorPaddingX` to the same value for a flush left edge.
- Chrome modules tolerate a stale `chrome` module after `/reload`, which
  previously could crash the renderer when the package was updated in place.
- `mdCodeBlockBorder` in `minimal-dark` is a faint grey again (it frames the
  box now) instead of background-coloured.

## [0.2.1] - 2026-10-22

### Added
- Automated releases: when `version` in `package.json` changes on `main`, the
  Publish workflow verifies the build, tags `vX.Y.Z`, creates a GitHub Release
  (CHANGELOG section + generated notes + package tarball), records a deployment
  to the `npm` environment, and publishes to npm via OIDC trusted publishing.
- `CHANGELOG.md` and a "Releasing" section in the README.
- The Publish workflow upgrades npm to >= 11.5.1 (required for OIDC trusted
  publishing) and is re-runnable: an existing tag whose version is missing
  from npm is published without re-tagging.
- `repository`, `homepage`, and `bugs` fields in `package.json`, required for
  npm provenance verification.

### Changed
- The release-triggered publish workflow is now a manual, token-based fallback
  (`release.yml`) for re-publishing an existing tag.

## [0.2.0] - 2026-10-22

### Added
- One-line tool rows for the built-in tools with a status glyph (`◐` running,
  `✓` ok, `✗` failed), a fixed verb column, and a right-aligned outcome
  (`34 lines · 1.0s`, `exit 1`, `+3 −1`, `4 matches`, `2.1 KB`).
- Failed rows show the first line of output underneath; `ctrl+o` expands the
  full output as a `│`-ruled block.
- A dim turn rule (`── 15:51 · 12s · 4 tools ──`) after every agent run,
  stored as a custom entry that never enters model context.
- `┊` gutter on thinking paragraphs.
- Status line shows the git branch and dirty count (`⎇ main ±1`) and colours
  the context meter amber at 70 % and red at 90 %.
- Footer key hints appear only when idle with an empty editor; `/compact` is
  suggested under context pressure.
- `minimal-dark` theme shipped with the package.

### Changed
- Tool renderers are attached with `registerToolRenderer` at extension load
  instead of re-registering the built-in tools in `session_start`, so resumed
  transcripts render the same way as new messages.
- Requires pi `>=1.4.0`.

## [0.1.0] - 2026-09-23

### Added
- Initial release: header/footer chrome, compact tool activity rows, working
  status line, Herdr sibling status, Gauntlet widget hiding.

[Unreleased]: https://github.com/raviy06/pi-minimal/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/raviy06/pi-minimal/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/raviy06/pi-minimal/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/raviy06/pi-minimal/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/raviy06/pi-minimal/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/raviy06/pi-minimal/releases/tag/v0.1.0
