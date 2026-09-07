---
name: jin-playwright-mcp
description: Inspect and exercise the Jin GUI through the repository's deterministic Playwright MCP setup. Use for browser-driven GUI investigation, interaction checks, console inspection, or reproducible local frontend verification; do not use it as proof of native Tauri behavior.
---

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
