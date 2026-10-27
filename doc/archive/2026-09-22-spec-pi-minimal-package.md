# pi-minimal Package

## Goal

Package the current Grok-style Pi interface as the public Pi package `pi-minimal`, so another machine can install it with Pi's normal package installer while retaining the current visual behavior, except thinking-block visibility. The package never reads or writes `hideThinkingBlock`; that display follows the user's existing Pi setting. `setHiddenThinkingLabel` restyles a hidden label and does not hide thinking blocks.

## Scope

`pi-minimal` version `0.1.0` includes:

- The current header, footer, cwd widget, compact built-in tool rendering, working-status display, and optional Herdr integration.
- Compact phase and task lines in the package footer when current tracker rules make them visible.
- A TypeScript build targeting Node.js 22.19.0 or newer and Pi 0.84.4 or newer.
- Package metadata, MIT license, README, and automated tests.

The package does not include Omarchy themes, Omarchy skills, credentials, sessions, agentmemory, MCP configuration, or other local Pi customizations.

The live extension at `~/.pi/agent/extensions/grok-chrome` remains untouched during implementation and verification. Cutover is a separate user action after the packaged extension is verified.

## Package contract

The repository root contains `package.json` with:

- `"name": "pi-minimal"`
- `"version": "0.1.0"`
- `"license": "MIT"`
- `"type": "module"`
- `"engines": { "node": ">=22.19.0" }`
- `"keywords": ["pi-package"]`
- `"pi": { "extensions": ["./dist/index.js"] }`
- `peerDependencies` of `"*"` for `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`

`typescript` and `@types/node` are development dependencies. The Pi packages remain wildcard peers and are not bundled. `npm run build` refreshes the committed `dist/` artifact. `dist/` is not gitignored, so a normal Git installation receives `dist/index.js` without a consumer build or npm publication.

The MIT license uses `Copyright (c) 2026 raviy06`. The README documents `pi install git:github.com/raviy06/pi-minimal`, the Node and Pi requirements, configuration, and the cutover warning.

## Runtime behavior

On TUI `session_start`, before the first reclaim, the extension loads configuration and installs the current visual chrome and compact renderers. It calls `ctx.ui.setHiddenThinkingLabel("◆ Thought")` and no-argument `ctx.ui.setWorkingIndicator()`. It never reads or writes Pi's `hideThinkingBlock` setting.

Gauntlet widget hiding is enabled unless configuration explicitly disables it. When enabled, the extension clears the `phase_tracker` and `plan_tracker` widgets and continues reclaiming that space. When disabled, it does not clear or reclaim those widgets. Footer visibility follows the current tracker rules regardless of that setting: the phase line appears only when at least one phase is not `pending`, and the task line appears only when the task list is nonempty.

Herdr probing and sibling display occur only when `HERDR_ENV=1`, as they do now. Print, JSON, and RPC modes do not install TUI components.

## Configuration

The extension loads configuration in this order:

1. Built-in defaults.
2. `join(getAgentDir(), "pi-minimal.json")`, when present. This is `~/.pi/agent/pi-minimal.json` unless Pi's agent directory is overridden.
3. `join(ctx.cwd, CONFIG_DIR_NAME, "pi-minimal.json")`, only when `ctx.isProjectTrusted()` returns true.

Project values override global values. A missing file, omitted `hideGauntletWidgets` key, or invalid value does not override the lower-precedence value. Invalid JSON, a non-object root, or a non-boolean `hideGauntletWidgets` value produces a `console.error` warning and is ignored at that layer. Unknown keys are ignored.

The only supported key is:

```json
{ "hideGauntletWidgets": false }
```

Its default is `true`. A non-boolean value is invalid for that key, produces a warning, and leaves the lower-precedence value unchanged.

## Source and compatibility decisions

Session-path sources live in `src/` and emit to `dist/`. The implementation copies the current modules needed by the live session path and excludes unused modules. TypeScript uses `NodeNext` module settings, and tests are excluded from the extension entry. Relative `.js` import specifiers are preserved. Runtime and tests do not require Node's TypeScript strip-types flag.

The activity test asserts the exported `activityBullet` and `rowIsRunning` behavior. `paintActivityLines` is not added.

## Verification

Verification uses temporary directories only. It sets `PI_CODING_AGENT_DIR` and must not modify the user's live Pi configuration, authentication, sessions, or `grok-chrome` directory. Any Pi process also uses `--no-extensions -e ./dist/index.js` so the live extension cannot load.

`npm test` builds the tests and runs `node --test` against emitted `.js` specifiers. It covers default widget hiding, the `false` opt-out, trusted project override, untrusted project skip, omitted keys, invalid JSON, active and empty tracker fixtures, named chrome calls, `HERDR_ENV` gating, and a spy proving `setHideThinkingBlock` is never called.

The required release checks are:

- `npm test` and `npm run build` pass on Node.js 22.19.0 using emitted JavaScript.
- `dist/index.js` is committed and matches the build output.
- A clean checkout loads through `pi install` without a consumer build.
- The installed extension loads under Pi 0.84.4 or newer.

## Documentation impact

- Feature / user-facing docs introduced: README.md — operations and package configuration
- Materially amended existing docs: none
- Derived / memory docs invalidated: none

## Out of scope

- npm registry publication
- Git tag or GitHub release creation
- automatic removal or disabling of the live extension
- migration of unrelated Pi settings and extensions
- changes to Pi core or Gauntlet
