# pi-minimal

A Pi coding-agent package.

## Requirements

- Node.js `>=22.19.0`
- Pi `>=1.4.0` (uses `registerToolRenderer`, `registerEntryRenderer`, `registerMarkdownTransformer`)

No other Pi extension is required. Pi supplies the peer packages used by this extension.

Optional integrations:

- `pi-gauntlet`: supplies the phase and task data shown in the footer. Its widgets are hidden by default.
- Herdr: sibling status appears only when Pi is running inside Herdr.

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

- **Tool rows** – every built-in tool call (`bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`) renders as one line: status glyph (`◐` running, `✓` ok, `✗` failed), verb, item, and a right-aligned outcome (`34 lines · 1.0s`, `exit 1`, `+3 −1`, `4 matches`). Failed rows show the first line of output underneath; `ctrl+o` expands full output in a `│`-ruled block.
- **Turn rule** – after each agent run a dim `── 15:51 · 12s · 4 tools ──` separator is appended (stored as a custom entry; never sent to the model).
- **Thinking gutter** – thinking paragraphs are prefixed with `┊` so they read as secondary.
- **Status line** – one line above the editor: model · thinking level · context meter (amber at 70 %, red at 90 %) · cwd · `⎇ branch ±dirty` · Herdr siblings.
- **Footer** – key hints appear only when the agent is idle and the editor is empty; `/compact` is suggested under context pressure.
- **Theme** – ships `minimal-dark`: neutral tool backgrounds, visible user-message tint, dimmer thinking text, violet headings (yellow is reserved for warnings), and code-fence lines coloured like the background so fenced code reads as a padded block. Select it in `/settings` → Theme, or set `"theme": "minimal-dark"`.

## Configuration

The package loads JSON in this order:

1. Built-in defaults
2. Global: `~/.pi/agent/pi-minimal.json` (or `$PI_CODING_AGENT_DIR/pi-minimal.json` when the agent directory is overridden)
3. Project: `.pi/pi-minimal.json` in the current working directory, only when the project is trusted

Project values override global values. A missing file, omitted key, or invalid value does not override the lower-precedence value.

The only supported key is `hideGauntletWidgets`. It defaults to `true`.

```json
{ "hideGauntletWidgets": true }
```
