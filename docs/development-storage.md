# Development build storage

Jin uses the same Python 3.9+ storage runner for contributor checks, agent sessions
and CI. Run commands from the checkout root. On Windows use `python` where these
examples use `python3`. Cargo and the dependencies for the selected gate must be
installed first. Cargo metadata must expose `build_directory` so the runner can
monitor both output locations. Upgrade Cargo if inspection reports that this field
is unavailable. Use the existing Node version and lockfile for frontend work.

```sh
python3 scripts/dev_storage.py inspect
make check
make verify
```

The Makefile build, test, check, clippy and GUI verification targets run through
the guard. `make verify` retains the full core gate and determinism loop.
`make verify-gui` retains the bridge and frontend checks and its existing nvm
prerequisite. Use the direct runner below on systems without that Make setup.

## Choose a check

Use focused checks while iterating. Run the full applicable repository gates
before merging, locally or through CI, and record where they passed.

```sh
# Core and CLI type checking
python3 scripts/dev_storage.py run --report .artifacts/storage/core-check.json -- cargo check --locked -p jin-core -p jin

# One integration suite. Choose a package and suite matching the changed behavior.
python3 scripts/dev_storage.py run --report .artifacts/storage/core-test.json -- cargo test --locked -p jin-core --test vg1_rebuild_equivalence

# Browser UI checks run without compiling Tauri
python3 scripts/dev_storage.py run --cwd jin-gui --report .artifacts/storage/frontend-test.json -- npm test
python3 scripts/dev_storage.py run --cwd jin-gui --report .artifacts/storage/frontend-build.json -- npm run build

# Native bridge verification
python3 scripts/dev_storage.py run --report .artifacts/storage/bridge-test.json -- cargo test --locked -p jin-gui
```

Install frontend dependencies once with `npm --prefix jin-gui ci` after cloning
or when the lockfile changes. CI keeps its clean install and full verification
sequence. Browser verification needs Chromium only for the current smoke gate.

## Budgets and debug information

The runner initially requires 5 GiB of reserve plus 5 GiB of expected additional
usage on each output volume. These are configurable rollout values. They have
not been calibrated from cold and warm Jin builds. A refusal reports the affected
volume before launching the child.

```sh
python3 scripts/dev_storage.py run --reserve-gib 5 --budget-gib 12 --report .artifacts/storage/core-full.json -- make verify-core-commands
make verify STORAGE_RESERVE_GIB=5 STORAGE_BUDGET_GIB=12
```

Set the growth budget using a measured run with sufficient headroom. Each report
records the command, output locations, effective Cargo settings, initial and final
free bytes, sampled minimum free bytes, and exit status. Use a separate report
filename for each gate. Repeating a filename replaces that report. Sampling may
miss brief peaks, and unrelated activity on the volume also affects observations.
The check prevents starting with inadequate configured headroom. It cannot guarantee
that a running build or another process stays within that budget.

Routine checks default `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`, and
`CARGO_PROFILE_TEST_DEBUG=0`. This reduces generated data with slower rebuilds and
less debugger information as the trade-offs. Caller environment values take
precedence. Keep these settings consistent across repeated checks to avoid
recompiling artifacts for alternating profiles.

```sh
# Keep normal debug information for a debugger session
python3 scripts/dev_storage.py run --full-debug --report .artifacts/storage/debug-build.json -- cargo build -p jin-gui
```

Keep worktree-local Cargo targets for the normal workflow. `CARGO_TARGET_DIR` and
separate Cargo build directories are inspected when configured. The macOS bundle
check and release packaging consume established `target/` paths, so run those
without relocation overrides. `make verify-macos-app` explicitly uses full debug
settings for its debug app bundle.

## Cleanup and worktrees

Inspect candidate paths and their sizes first.

```sh
python3 scripts/dev_storage.py cleanup cargo --package jin-core
python3 scripts/dev_storage.py cleanup dist

# After reviewing and authorizing the selected scope
python3 scripts/dev_storage.py cleanup cargo --package jin-core --apply
```

Cargo cleanup is limited to one Jin package (`jin-core`, `jin` or `jin-gui`) in
the dev profile. It delegates to Cargo's native preview and clean commands so Cargo
coordinates access to its output. The default package is `jin-core`. Release output
is preserved by this operation. Frontend `dist` is report-only and applying cleanup
there is refused. Inspect its contents and stop all consumers before separately
requesting manual removal.

Use the printed reconstruction command and the runner's safety result when deciding
what to reclaim. Apply cleanup only to an explicitly selected eligible scope after
direct Cargo, Tauri and npm processes using that checkout have stopped. Guarded
operations coordinate through a checkout lock. Direct commands bypass that lock.
External targets, separate intermediate directories, symlinks, junctions and tracked
files cause cleanup refusal. Shared output needs its own reviewed maintenance.

Preserve Jin user data, source, Git worktrees, accepted visual references and agent
memory. Shared browser installations, SDKs and Docker images affect other projects
and need their own explicit maintenance request. A worktree retirement should check
its Git state and active use before separately authorizing its removal.

## CI and agent handoff

CI retains existing Rust, frontend and Windows checks. Cargo caches contain registry
and Git downloads. Target artifacts are rebuilt, trading CI time for smaller cache
restores. Each build uses the guard and storage reports are uploaded even after a
failed gate, with seven-day artifact retention. The storage runner's safety suite
runs on Ubuntu, macOS and Windows.

Agents should use the [development storage skill](../.agents/skills/jin-development-storage/SKILL.md)
and report the selected gate, result, report location, budget or settings overrides,
cleanup actually performed and outstanding verification. Use the same workflow in
each development worktree.
