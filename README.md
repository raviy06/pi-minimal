# pi-minimal

A Pi coding-agent package.

## Requirements

- Node.js `>=22.19.0`
- Pi `>=1.4.0` (uses `registerToolRenderer`, `registerEntryRenderer`, `registerMarkdownTransformer`)

No other Pi extension is required. Pi supplies the peer packages used by this extension. The `gh` CLI is needed only for the open-PR chips.

Optional integrations:

- `pi-gauntlet`: supplies the phase and task data shown in the footer. Set `hideGauntletWidgets: true` to also hide its own widgets, since the footer already shows that data.
- Herdr: sibling status (other agents in the workspace, `working` / `blocked` / `idle`) appears when Pi runs inside a Herdr pane (`HERDR_ENV=1`). Herdr's own pi integration reports each pane's state.
- Rex: the same sibling status appears when Pi runs inside a [Rex](https://www.superlogical.com/rex) session (`REX_SESSION` + `REX_BLOCK`). Rex learns a pane's state from the [Program Status Protocol (OSC 7501)](https://www.superlogical.com/rex/docs/build/program-status), so each pi needs an extension that reports it (e.g. a `rex-agent-state.ts` that writes `ESC ] 7501 ; state=working:app=pi ESC \\` on `agent_start`); other programs that speak the protocol show up too. Herdr wins when both are present.

## Installation

```bash
pi install npm:pi-minimal
```

Git installation also works:

```bash
pi install git:github.com/raviy06/pi-minimal
```

Do not load this package beside the live `grok-chrome` extension. Disable or remove `grok-chrome` before enabling `pi-minimal`.

## What it changes

- **Tool rows** – every built-in tool call (`bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`) renders as one line: status glyph (`◐` running, `✓` ok, `✗` failed), verb, item, and a right-aligned outcome (`34 lines · 1.0s`, `exit 1`, `+3 −1`, `4 matches`). Failed rows show the first line of output underneath; `ctrl+o` expands full output in a `│`-ruled block. `codemode` renders the same way, as a `code` row with one child row per nested tool call; `ctrl+o` shows the script and its output. Tools without a renderer of their own (most MCP tools) get the same one-line row; tools that draw themselves keep their look. Bash rows drop a leading `cd <session cwd> &&` and shorten other `cd` prefixes to the directory name.
- **Turn rule** – after each agent run a dim `── 15:51 · 12s · 4 tools ──` separator is appended (stored as a custom entry; never sent to the model).
- **Thinking gutter** – every line of a thinking paragraph, wrapped lines included, starts with `┊`, so thinking reads as a column beside prose.
- **Status line** – one line above the editor: model · thinking level · context meter (amber at 70 %, red at 90 %) · cwd · `⎇ branch ±dirty` · siblings (other agents in the same Herdr workspace or Rex session, with their state).
- **Footer** – key hints appear only when the agent is idle and the editor is empty; `/compact` is suggested under context pressure.
- **Open PRs** – for the GitHub repo in the working directory (any host `gh` is logged in to), the footer shows chips for open PRs you authored or were asked to review, right-aligned on the key-hints line below the editor: `#1675 #1670 +3`. The chips stay while you type or the agent works, even though the hints hide. Each chip is a terminal hyperlink to the PR (OSC 8; click or cmd-click in Rex, Ghostty, iTerm2, WezTerm, Kitty). Colours: accent = mine, dim = my draft, amber = waiting on my review, red = failing CI or changes requested. `/prs [mine|review|all]` lists them with actions (open in browser, paste URL into the editor, `gh pr checkout`); the `list_open_prs` tool gives the model the same list. Refreshed every 3 minutes and after each turn (at most once a minute). Needs the `gh` CLI.
- **Background processes** – when a `bash` tool call leaves something running (`npm run dev &`, `nohup ./watch.sh`), the footer shows `⚙ 2 bg` after the key hints below the editor (it stays while the hints hide). `ctrl+b` (or `/bg`) opens a list with each process, whether it is running or has ended, and for how long; `k` kills the selected process, `K` its whole process group. Pi kills these groups when it exits, so the list is scoped to this pi. Attribution uses process groups (pi spawns each bash call detached), so commands are never rewritten; a process that has already exited shows as `ended` without an exit code, since it was reparented away from pi. Set `backgroundShortcut` in `pi-minimal.json` to another key, or `null` to keep only `/bg`.
- **Code blocks** – fenced code renders as a closed box with the language as its title, keeping syntax highlighting, instead of literal ``` lines; long lines wrap inside the box.
- **Alignment** – chrome follows pi's `outputPad` setting. Pi's editor uses the separate `editorPaddingX` setting (default `0`); set `"editorPaddingX": 1` for a flush left edge with the transcript.
- **Theme** – ships `minimal-dark`: no background behind tool rows (failures excepted), a grey ladder whose readable tiers stay near 4.5:1, syntax colours kept off the status hues, visible user-message tint, dimmer thinking text, violet headings (yellow is reserved for warnings), and faint code-block frames. Select it in `/settings` → Theme, or set `"theme": "minimal-dark"`.

## Configuration

The package loads JSON in this order:

1. Built-in defaults
2. Global: `~/.pi/agent/pi-minimal.json` (or `$PI_CODING_AGENT_DIR/pi-minimal.json` when the agent directory is overridden)
3. Project: `.pi/pi-minimal.json` in the current working directory, only when the project is trusted

Project values override global values. A missing file, omitted key, or invalid value does not override the lower-precedence value.

Supported keys:

- `hideGauntletWidgets` (boolean, default `false`) – when `true`, pi-minimal clears pi-gauntlet's `phase_tracker` and `plan_tracker` widgets each time it re-asserts its chrome (session start, turn end, tool end).
- `editDiff` (`"always"` | `"never"` | `"expanded"`, default `"expanded"`) – when an `edit` row shows its diff. `"expanded"` shows diffs of up to 8 lines inline and puts longer ones behind `ctrl+o`; `"always"` shows every diff inline as the edit lands (first 40 lines, the rest behind `ctrl+o`); `"never"` keeps the `+3 −1` stats only. `write` rows show the written content behind `ctrl+o`.

```json
{ "hideGauntletWidgets": true, "editDiff": "always" }
```

## Optional footer activity API

Companion extensions can publish session-scoped activity rows through the versioned
in-process footer contribution API. Pi-minimal keeps ownership of the footer and
renders activity **after** existing hints and tracker summaries. An independent
`summary` slot supplies a violet segmented plan bar below the input. Nonempty
groups are separated by one blank row; agent rows remain compact. The API adds no
visible content without a contributor and changes no other extension's settings.

Rows use pi-minimal's yellow running spinner, green completion check, and red
failure glyph. Plain-text and static modes are supported. See
[Footer activity contributions](doc/footer-contributions.md) for the protocol,
validation limits, lifecycle, and integration example.

This is a display integration seam, not a subagent runtime or task tracker.

## Releasing

Every new extension PR must include a version bump before it is opened, so merging
it can trigger publication and users can update. Keep `package.json`, both root
version fields in `package-lock.json`, the package test expectation, and the dated
changelog entry synchronized. Before merging concurrent PRs, verify that the
selected version is still newer than `main` and has not already been published.

Releases are automatic. To ship a version:

1. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`.
2. Bump `version` in `package.json` (and the expectation in `test/package.test.ts`), run `npm run build`, commit `dist/`.
3. Merge to `main`.

The Publish workflow (`.github/workflows/publish.yml`, npm's registered trusted publisher) detects the new version, verifies lint/typecheck/tests/build, tags `vx.y.z`, creates a GitHub Release (CHANGELOG section + auto-generated notes + package tarball), records a deployment to the `npm` environment, and publishes to npm via OIDC trusted publishing (provenance included). Pushes that do not change the version do nothing. `Release (manual fallback)` re-publishes an existing tag with the `NPM_TOKEN` secret if the automated path ever fails.
