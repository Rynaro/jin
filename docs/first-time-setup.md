# First-time setup

On a new Jin installation, a guided setup runs before normal use. It helps you choose Jin’s storage location, learn the core functions, and set basic preferences. The native setup is supported on Linux and macOS.

## Setup steps

The five steps are **Welcome**, **Storage**, **Functions**, **Settings**, and **Review**. They introduce the setup, choose storage, review core functions, set preferences, and confirm the choices before finishing.

## Storage location

Choose the folder where Jin should store its data. Jin accepts a missing folder,
an empty folder, or an existing initialized Jin folder. It rejects invalid paths,
paths that point to files, and non-empty folders unrelated to Jin.

Jin does not copy or migrate data during setup. When you complete the guide, Jin
initializes the selected folder when needed, saves the storage pointer and
completion state atomically, and automatically restarts the app.

When `JIN_ROOT` is set, it is authoritative and bypasses the persisted or default
storage path. The selected root is immutable while Jin is running.

If the configured root becomes unavailable, choose a replacement folder or
restore the original location and select **Retry**. A successful recovery
restarts the native app.

If Jin finds an initialized root, it skips the guide. A pending setup state takes
precedence, so an interrupted setup resumes from the saved step.

## Core functions

- **Capture** — create a new capture with `Ctrl+N` on Linux or `Cmd+N` on macOS.
- **Today** — see the items relevant to the current day.
- **Notes** — write and review free-form notes.
- **Tasks** — track actionable work.
- **Events** — manage scheduled events.

## Basic settings

- **Appearance** — choose Auto, Light, or Dark.
- **Text size** — adjust the reading size used by Jin.
- **Reduce motion** — limit animated interface movement.

These preferences use Jin’s existing appearance storage and can be changed later
in settings.

## Developer notes

Before storage initialization and scheduler startup, the native runtime can enter
`Ready`, `FirstRun`, or `RootUnavailable`. Pending setup state is stored in
`<OS config>/jin-gui/first_run_state.json` and is resumed after restart.

The browser fixture can simulate first-run setup:

```js
localStorage.setItem('jin.fixture.firstRun', 'true');
localStorage.setItem('jin.fixture.firstRunState', JSON.stringify({
  schema_version: 1,
  status: 'in_progress',
  step: 'storage',
  selected_root: null
}));
location.reload();
```

For picker cancellation, set `jin.fixture.firstRunPicker` to `cancel`. For an
unavailable root, set `jin.fixture.rootUnavailable` to `true`; set it to `restored`
to exercise restore-and-retry. Reload after the command clears the flag to simulate
a restart.

## Verification

Final tests passed: 131 Rust tests and 1,952 frontend tests across 53 files.
The browser fixture covers the setup flow, storage validation, recovery, focus,
scrolling, responsive widths, accessibility text sizing, and console errors.

Native folder-picker behavior, native restart behavior, and platform-specific rendering still require owner sign-off. The existing validator cannot run its Playwright fixture assertion because `.mcp.json` is missing the Playwright entry.

See the [verification report](../.spectra/changes/archive/2026-09-14-first-time-setup/verification.md).
