# pi-minimal

A Pi coding-agent package.

## Requirements

- Node.js `>=22.19.0`
- Pi `>=0.84.4`

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

## Publishing

Create the GitHub environment before saving the npm trusted publisher:

1. Open **Settings → Environments → New environment**.
2. Set **Environment name** to `npm`.

Then add the trusted publisher at **npm → Trusted Publisher** with:

- **Organization or user:** `raviy06`
- **Repository:** `pi-minimal`
- **Workflow filename:** `publish.yml`
- **Environment name:** `npm`
- **Label:** leave empty
- **Publishing access:** `Public`

Publish a GitHub Release to run the workflow. No `NPM_TOKEN` is required.

Do not load this package beside the live `grok-chrome` extension. Disable or remove `grok-chrome` before enabling `pi-minimal`.

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
