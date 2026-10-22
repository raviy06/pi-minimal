# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Releases are cut automatically: when the `version` in `package.json` changes on
`main`, the Publish workflow tags it, publishes to npm, and uses the matching
`## [x.y.z]` section below as the top of the release notes.

## [Unreleased]

## [0.2.1] - 2026-10-22

### Added
- Automated releases: when `version` in `package.json` changes on `main`, the
  Publish workflow verifies the build, tags `vX.Y.Z`, creates a GitHub Release
  (CHANGELOG section + generated notes + package tarball), records a deployment
  to the `npm` environment, and publishes to npm via OIDC trusted publishing.
- `CHANGELOG.md` and a "Releasing" section in the README.

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

[Unreleased]: https://github.com/raviy06/pi-minimal/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/raviy06/pi-minimal/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/raviy06/pi-minimal/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/raviy06/pi-minimal/releases/tag/v0.1.0
