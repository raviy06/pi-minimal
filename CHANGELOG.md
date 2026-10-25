# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Releases are cut automatically: when the `version` in `package.json` changes on
`main`, the Publish workflow tags it, publishes to npm, and uses the matching
`## [x.y.z]` section below as the top of the release notes.

## [Unreleased]

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
