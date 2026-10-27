# pi-minimal Package Implementation Plan

> **REQUIRED SUB-SKILL:** Use the subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Package the current Grok-style Pi interface as an installable `pi-minimal` extension without changing its visual behavior except thinking-block visibility.

**Architecture:** Session-path TypeScript lives in `src/`, emits committed JavaScript to `dist/`, and loads layered JSON configuration before installing chrome. Tests compile separately and exercise configuration, tracker visibility, and session wiring without touching the live Pi setup.

**Tech Stack:** TypeScript, Node.js 22.19.0+, Node test runner, Pi extension APIs.

**Spec:** `doc/specs/2026-09-22-pi-minimal-package.md`

**Verification:** `npm test && npm run build && git diff --exit-code -- dist && PI_CODING_AGENT_DIR="$(mktemp -d)" pi --no-extensions -e ./dist/index.js --version`

---

## Files

**Create:**
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.tests.json`
- `.gitignore`
- `LICENSE`
- `README.md`
- `src/activity.ts`
- `src/chrome.ts`
- `src/config.ts`
- `src/cwd.ts`
- `src/footer.ts`
- `src/header.ts`
- `src/herdr.ts`
- `src/index.ts`
- `src/live-watch.ts`
- `src/reclaim.ts`
- `src/tool-rows.ts`
- `src/tools.ts`
- `src/tracker.ts`
- `src/working-status.ts`
- `test/activity.test.ts`
- `test/config.test.ts`
- `test/index.test.ts`
- `test/tracker.test.ts`
- `dist/` generated extension output

**Modify:** none

**Delete:** none

## Wave 1 — Foundations

Parallel-safe: Tasks 1–4 own disjoint files.

### Task 1: Package metadata

**TDD scenario:** New feature — full TDD cycle

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Package contract" L19-L35

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.tests.json`
- Create: `.gitignore`
- Create: `package-lock.json`

- [ ] **Step 1: Write the failing package test**

```js
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

test("package manifest exposes the committed extension", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  assert.equal(pkg.name, "pi-minimal")
  assert.equal(pkg.version, "0.1.0")
  assert.equal(pkg.license, "MIT")
  assert.equal(pkg.type, "module")
  assert.deepEqual(pkg.engines, { node: ">=22.19.0" })
  assert.deepEqual(pkg.keywords, ["pi-package"])
  assert.deepEqual(pkg.pi, { extensions: ["./dist/index.js"] })
  assert.deepEqual(pkg.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
  })
})
```

- [ ] **Step 2: Run test, confirm failure**

Run: `node --test test/package.test.js`
Expected: FAIL because `package.json` does not exist.

- [ ] **Step 3: Add the package files**

Create `package.json` with the asserted fields, `"private": false`, devDependencies `typescript`, `@types/node`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`, and scripts `"build": "tsc -p tsconfig.json"` and `"test": "tsc -p tsconfig.tests.json && node --test test-dist/*.test.js"`.

Create `tsconfig.json` with `rootDir: src`, `outDir: dist`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `strict: true`, and `include: ["src"]`.

Create `tsconfig.tests.json` extending it with `rootDir: .`, `outDir: test-dist`, and `include: ["src", "test"]`.

Create `.gitignore` containing `node_modules/` and `test-dist/`, but not `dist/`.

- [ ] **Step 4: Run test, confirm pass**

Run: `npm install && node --test test/package.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.tests.json .gitignore test/package.test.js
git commit -m "Add pi-minimal package manifest"
```

### Task 2: Configuration loader

**TDD scenario:** New feature — full TDD cycle

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Configuration" L47-L64

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing config tests**

Test `loadPiMinimalConfig({ agentDir, cwd, projectTrusted })` with temporary directories. Assert default `{ hideGauntletWidgets: true }`; global false overrides default; trusted project true overrides global false; untrusted project false does not override global true; omitted keys and unknown keys do not override; invalid JSON, a non-object root, and non-boolean `hideGauntletWidgets` call `console.error` and leave the lower-precedence value unchanged.

- [ ] **Step 2: Run test, confirm failure**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/config.test.js`
Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement the loader**

Export `PiMinimalConfig` and `loadPiMinimalConfig`. Read `join(agentDir, "pi-minimal.json")`, then `join(cwd, CONFIG_DIR_NAME, "pi-minimal.json")` only when `projectTrusted` is true. Parse with `JSON.parse`, validate only `hideGauntletWidgets`, and use `console.error` for invalid layers.

- [ ] **Step 4: Run test, confirm pass**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "Add layered pi-minimal configuration"
```

### Task 3: Tracker visibility

**TDD scenario:** New feature — full TDD cycle

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Runtime behavior" L37-L45

**Files:**
- Create: `src/tracker.ts`
- Test: `test/tracker.test.ts`

- [ ] **Step 1: Write the failing tracker tests**

Assert a phase line appears only when one phase is not `pending`, an empty or all-pending snapshot emits no phase line, a nonempty task list emits a task line, and an empty task list emits none. Assert `hideGauntletWidgets` calls `setWidget("phase_tracker", undefined)` and `setWidget("plan_tracker", undefined)`.

- [ ] **Step 2: Run test, confirm failure**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/tracker.test.js`
Expected: FAIL because `src/tracker.ts` does not exist.

- [ ] **Step 3: Copy and preserve the tracker**

Copy `formatTrackerLines` and `hideGauntletWidgets` from the live extension without changing their visibility rules.

- [ ] **Step 4: Run test, confirm pass**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/tracker.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tracker.ts test/tracker.test.ts
git commit -m "Preserve tracker footer visibility"
```

### Task 4: Activity rendering

**TDD scenario:** New feature — full TDD cycle

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Source and compatibility decisions" L66-L72

**Files:**
- Create: `src/activity.ts`
- Test: `test/activity.test.ts`

- [ ] **Step 1: Write the failing activity tests**

Assert `rowIsRunning` is false when `isPartial` is false and true when it is true. Assert `activityBullet(false, 0)`, `activityBullet(false, 1)`, and `activityBullet(true, 0)` return `"◆"`, while `activityBullet(true, 1)` returns `"◇"`.

- [ ] **Step 2: Run test, confirm failure**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/activity.test.js`
Expected: FAIL because `src/activity.ts` does not exist.

- [ ] **Step 3: Copy the activity helpers**

Copy `ActivityContext`, `rowIsRunning`, and `activityBullet` unchanged. Do not add `paintActivityLines`.

- [ ] **Step 4: Run test, confirm pass**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/activity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/activity.ts test/activity.test.ts
git commit -m "Preserve activity rendering helpers"
```

## Wave 2 — Session wiring

Solo: Task 5 imports the configuration, tracker, and activity modules created in Wave 1.

Depends on Wave 1: Task 5 consumes those modules.

### Task 5: Extension session wiring

**TDD scenario:** New feature — full TDD cycle

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Runtime behavior" L37-L45, § "Verification" L74-L86

**Files:**
- Create: `src/index.ts`
- Create: `src/header.ts`
- Create: `src/footer.ts`
- Create: `src/cwd.ts`
- Create: `src/chrome.ts`
- Create: `src/herdr.ts`
- Create: `src/tools.ts`
- Create: `src/tool-rows.ts`
- Create: `src/working-status.ts`
- Create: `src/reclaim.ts`
- Create: `src/live-watch.ts`
- Test: `test/index.test.ts`

- [ ] **Step 1: Write the failing session tests**

Drive the default export with a fake `ExtensionAPI`, emit `session_start`, and assert `setHiddenThinkingLabel("◆ Thought")`, no-argument `setWorkingIndicator()`, header, footer, and `tw-cwd` installation. Assert both Gauntlet widgets are cleared by default and neither is cleared when config disables hiding. Assert `setHideThinkingBlock` is absent from all calls. Assert no `herdr` execution when `HERDR_ENV` is unset and one probe when it equals `"1"`.

- [ ] **Step 2: Run test, confirm failure**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/index.test.js`
Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 3: Copy the session path and apply the deltas**

Copy the live session-path modules. Replace `editor.ts` with `src/chrome.ts` exporting `CHROME_MARGIN = 1`, and update imports to `./chrome.js`. Remove the `SettingsManager` import and `setHideThinkingBlock` call. Load config from `getAgentDir()` and `ctx.isProjectTrusted()` before the first reclaim, and skip widget clearing when `hideGauntletWidgets` is false.

- [ ] **Step 4: Run test, confirm pass**

Run: `npx tsc -p tsconfig.tests.json && node --test test-dist/test/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test/index.test.ts
git commit -m "Wire the pi-minimal session chrome"
```

## Wave 3 — Release artifact

Solo: Task 6 builds the extension entry created in Wave 2.

Depends on Wave 2: Task 6 emits `dist/index.js` from `src/index.ts`.

### Task 6: Build and installation smoke

**TDD scenario:** Trivial change — use judgment

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Verification" L74-L86

**Files:**
- Create: `dist/index.js`
- Create: `dist/` supporting emitted modules

- [ ] **Step 1: Build the extension**

Run: `npm test && npm run build`
Expected: tests pass and `dist/index.js` exists.

- [ ] **Step 2: Confirm the artifact is stable**

Run: `git diff --exit-code -- dist`
Expected: exit 0 after `dist/` is committed.

- [ ] **Step 3: Load it in an isolated Pi directory**

Run: `PI_CODING_AGENT_DIR="$(mktemp -d)" pi --no-extensions -e ./dist/index.js --version`
Expected: Pi starts with the extension and exits successfully without reading or writing the live agent directory.

- [ ] **Step 4: Commit**

```bash
git add dist
git commit -m "Add committed pi-minimal build"
```

## Wave 4 — Documentation

Solo: lone remaining task.

Depends on Waves 1–3: the README documents the completed package contract and artifact.

### Task 7: README and license

**TDD scenario:** Trivial change — use judgment

**Spec:** doc/specs/2026-09-22-pi-minimal-package.md § "Documentation impact" L88-L91

**Files:**
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Add the MIT license**

Use the standard MIT license with `Copyright (c) 2026 raviy06`.

- [ ] **Step 2: Document installation and configuration**

Document Node.js `>=22.19.0`, Pi `>=0.84.4`, `pi install git:github.com/raviy06/pi-minimal`, `hideGauntletWidgets`, and the warning not to load this package beside the live `grok-chrome` extension.

- [ ] **Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "Document pi-minimal installation"
```

## Spec coverage

| anchor | requirement (short) | owner |
|---|---|---|
| § "Package contract" L19-L35 | publish the Pi package manifest and peers | Task 1 |
| § "Runtime behavior" L37-L45 | preserve chrome and gate widget hiding | Task 5 |
| § "Runtime behavior" L37-L45 | preserve tracker line visibility | Task 3 |
| § "Configuration" L47-L64 | layer and validate configuration | Task 2 |
| § "Source and compatibility decisions" L66-L72 | build NodeNext output and test activity helpers | Task 4, Task 6 |
| § "Verification" L74-L86 | isolate tests and installation smoke | Task 5, Task 6 |
| § "Documentation impact" L88-L91 | add README and license | Task 7 |
| § "Out of scope" L93-L99 | exclude publishing, cutover, and unrelated migrations | waived: out of scope per spec |
