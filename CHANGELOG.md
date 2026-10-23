# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Releases are cut automatically: when the `version` in `package.json` changes on
`main`, the Publish workflow tags it, publishes to npm, and uses the matching
`## [x.y.z]` section below as the top of the release notes.

## [Unreleased]

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

[Unreleased]: https://github.com/raviy06/pi-minimal/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/raviy06/pi-minimal/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/raviy06/pi-minimal/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/raviy06/pi-minimal/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/raviy06/pi-minimal/releases/tag/v0.1.0
