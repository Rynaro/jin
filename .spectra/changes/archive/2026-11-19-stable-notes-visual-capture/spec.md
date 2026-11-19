---
eidolon: vivi
kind: spec
version: 1
created_at: 2026-11-19
---

# Stable notes visual capture

## Scope

Make the visual-reference detector selftest exercise real production UI captures while keeping canonical visual comparison independent. This test-infrastructure change leaves references, environment rules, and renderer settings unchanged.

## Approach

Seed each of the five production scenarios through the browser fixture and capture a fresh PNG. Load each raster at its intrinsic dimensions and require byte-for-byte equality with its source capture before testing the detector. Use the normal reference writer and comparator on fresh frames. An actual DOM marker must cause rejection, and removing it must restore equality on another fresh frame. Verify reference hashes are unchanged.

Keep stale-build, environment, unknown-scenario, and invalid-mutation guards. The canonical visual comparison continues to render the live app against platform-bound checked-in references. On mismatch it retains baseline and actual PNG diagnostics. Linux CI uploads only generated failure screenshots. No masks, tolerances, renderer flags, dependencies, or reference updates are introduced.

## Acceptance criteria

### AC-SNVC-1

GIVEN the five production UI scenarios
WHEN the detector selftest seeds them
THEN each fresh application PNG is loaded at native dimensions and byte-matches the source capture before detector assertions proceed.

### AC-SNVC-2

GIVEN a validated live raster and the normal reference writer and comparator
WHEN a fresh capture is compared, the DOM marker is added, then removed
THEN the unchanged frame compares equal, the marked frame is rejected, and a new restored frame compares equal while all immutable reference hashes remain unchanged.

### AC-SNVC-3

GIVEN stale build stamps, environment mismatches, unknown scenarios, or invalid mutation flags
WHEN the detector selftest validates its inputs
THEN it rejects each invalid case while retaining the existing environment and reference-integrity guards.

### AC-SNVC-4

GIVEN unchanged application code and platform-bound references
WHEN canonical visual comparison runs
THEN it independently renders the live app and compares exact PNG bytes while preserving both baseline and actual PNGs on mismatch. Linux CI uploads only generated failure screenshots.

## Verification

The final candidate passed five complete detector selftests on Linux and five on macOS, then passed live comparison against all five macOS references. Repeated unchanged renderer runs showed pixel-level raster variability, so the detector selftest validates lossless raster fidelity while canonical comparison continues to report real live-render differences with paired diagnostics.
