---
name: jin-development-storage
description: Guard Jin development builds against insufficient disk space, select scoped verification, and inspect project cleanup candidates. Use before expensive Cargo or Tauri checks, during low-space diagnosis, or when retiring agent worktrees.
---

Use the repository runner from the active checkout with Python 3.9+.
Read `docs/development-storage.md` for commands, prerequisites and budget tuning.

1. Run `python3 scripts/dev_storage.py inspect` from that checkout. Resolve the
   actual output volumes and current free bytes before choosing an expensive gate.
2. Select a focused check for the changed behavior. Use guarded `cargo check`
   or a named test suite for core iteration, frontend commands with `--cwd jin-gui`
   for browser work, and explicit `-p jin-gui` for native bridge checks. Run the
   applicable full repository gates before merge and record where they passed.
3. Execute through `scripts/dev_storage.py run --report PATH -- COMMAND`.
   The runner uses a 5 GiB reserve and 5 GiB growth budget by default. Treat these
   as initial policy values and tune them from measured cold and warm reports.
   A refused gate needs more headroom or an appropriately measured budget.
4. Keep the routine Cargo settings consistent. Explicit environment values take
   precedence. Use `run --full-debug` for debugger sessions. Preserve the normal
   target location for macOS bundle verification and release packaging.
5. For requested cleanup, preview `cleanup cargo --package PACKAGE` or `cleanup
   dist` and report the exact path and size. Cargo supports only the dev profile
   of one selected Jin package. Apply that reviewed scope with `--apply` after
   explicit authorization. Dist remains report-only. Stop direct consumers first.
   Cargo native locking and the shared runner lock coordinate supported operations.
   Preserve user data, tracked files, Git state, accepted visual references,
   agent memory and shared tool caches.
6. Report the command, exit result, JSON report path, observed minimum free bytes,
   caller overrides, cleanup actually applied and remaining verification. Retiring
   a worktree itself is a separate authorized action after checking its Git state.

On Windows use `python` in place of `python3`. Prefer the portable runner when the
existing Make/nvm environment is unavailable. Follow the exact commands exposed
by `python scripts/dev_storage.py --help` and its subcommand help.
