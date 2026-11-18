---
spec: engram/1.0
name: jin-playwright-mcp
id: egr_1ad62c7b
version: 1
intent:
  does: Inspect and exercise the Jin GUI through the repository's deterministic Playwright MCP setup.
  use_when: Use for browser-driven GUI investigation, interaction checks, console inspection, or reproducible local frontend verification; do not use it as proof of native Tauri behavior.
  not_when: validating the native Tauri runtime or real provider integrations
capabilities:
  requires: []
  produces: []
  alternatives: []
  conflicts_with: []
relations:
  requires: []
  before: []
  supersedes: []
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools: [npm]
  network:
    mode: required
    destinations: ["http://127.0.0.1:1420"]
  secrets: none
routing:
  positive:
  - jin playwright mcp
  - Inspect and exercise the Jin GUI through the repository's deterministic Playwright MCP setup.
  - Use for browser-driven GUI investigation, interaction checks, console inspection, or reproducible local frontend verification; do not use it as proof of native Tauri behavior.
  negative:
  - verify native Tauri behavior or platform rendering
  body_digest: e71c80867c9924419186dfdec27de35eb08d6d5627d90499200a2f2773df75c5
origin:
  channel: imported
  verification_status: pending
  content_hashes:
    body_sha256: e71c80867c9924419186dfdec27de35eb08d6d5627d90499200a2f2773df75c5
    content_sha256: e737fd97d661e3f515adb2eaad0e3b43c65b417865eda25bd19b758073ab6a90
  journal:
  - version: 1
    timestamp: '2026-11-18T20:27:00.604107+00:00'
    author: register
    event: imported
    note: migrated from SKILL.md
skill_md_source:
  body_raw: |2

    # Jin Playwright MCP

    Use the repository-registered `playwright` MCP against the existing Vite dev server.

    ## Start the application

    1. From the repository root, run `npm --prefix jin-gui run dev:agent` and leave it running.
    2. Navigate only to `http://127.0.0.1:1420`. The MCP network allowlist rejects other origins.
    3. If the MCP is absent after configuration changed, restart the agent/client so it reloads `.mcp.json` or `.codex/config.toml`.

    The browser is headless, isolated, UTC, `en-US`, fixed at 1280×800, and uses reduced motion. `jin-gui/tools/tauri-fixture-init.js` supplies deterministic tasks, notes, folders, and basic shell responses. It installs only on the local Vite origin and does not replace a real Tauri bridge.

    ## Work with the page

    - Begin with an accessibility snapshot and inspect browser console errors before interacting.
    - Prefer roles, accessible names, labels, and test ids over CSS selectors or coordinates.
    - Re-snapshot after navigation or state changes instead of reusing stale element references.
    - Treat `Unsupported Jin fixture command` as an explicit harness gap. Do not hide it with a permissive fallback; extend the fixture only when the task requires that command and its deterministic result is known.
    - Save screenshots, traces, and other MCP output under `.artifacts/playwright-mcp/`.

    This harness validates the web frontend with a mock command bridge. It does not exercise the native Tauri runtime, filesystem, jin-core, OAuth, or platform rendering.
  projection_sha256: bb3af34ef946d80bcdb46441d9d1f8a29cc926a1cf3df12d3d735190f0d87287
  extra_frontmatter: {}
legacy:
  plasticity:
    storage_strength: 0.0
    exposure_count: 0
    outcome:
      success: 0
      failure: 0
    last_applied:
    excitability: 0.05
    last_checkpoint: '2026-11-18T20:27:00.604107+00:00'
    status: draft
---
## Procedure
1. From the repository root, run `npm --prefix jin-gui run dev:agent` and leave it running.
2. Navigate only to `http://127.0.0.1:1420`. The MCP network allowlist rejects other origins.
3. If the MCP is absent after configuration changed, restart the agent/client so it reloads `.mcp.json` or `.codex/config.toml`.
# Jin Playwright MCP
Use the repository-registered `playwright` MCP against the existing Vite dev server.
## Start the application
The browser is headless, isolated, UTC, `en-US`, fixed at 1280×800, and uses reduced motion. `jin-gui/tools/tauri-fixture-init.js` supplies deterministic tasks, notes, folders, and basic shell responses. It installs only on the local Vite origin and does not replace a real Tauri bridge.
## Work with the page
- Begin with an accessibility snapshot and inspect browser console errors before interacting.
- Prefer roles, accessible names, labels, and test ids over CSS selectors or coordinates.
- Re-snapshot after navigation or state changes instead of reusing stale element references.
- Treat `Unsupported Jin fixture command` as an explicit harness gap. Do not hide it with a permissive fallback; extend the fixture only when the task requires that command and its deterministic result is known.
- Save screenshots, traces, and other MCP output under `.artifacts/playwright-mcp/`.
This harness validates the web frontend with a mock command bridge. It does not exercise the native Tauri runtime, filesystem, jin-core, OAuth, or platform rendering.

## Pitfalls

## Examples

## Provenance
