# VIGIL Verification — calendar-event-detail-m1

- Verdict: `verify_pass`
- Checker: VIGIL
- Maker: Vivi
- Verified commit: `4ba9f964b1ef4d91e815231c96aac440dd6b8df6`
- Verified: 2026-08-26
- Change tier: `full`

## Independence and scope

Maker and checker are identity-distinct (`Vivi` != `VIGIL`). VIGIL reviewed the
exact final commit after the maker's modal-hydration correction. The review
found the implementation aligned with the frozen M1 capability and interaction
contract, with no unresolved acceptance mismatch or console issue.

## Acceptance verdict

All 39 acceptance checks in `change.json` pass. The final focused regression
established that icon hydration is scoped to each newly created modal: the
existing navigation and first-dialog SVG nodes retain identity and connectivity,
each new dialog contains exactly one visible close `x`, no placeholder or marker
remains, accessible names are intact, and nested focus, Escape, and backdrop
dismissal behavior remain correct.

The broader acceptance evidence also covers the core-owned Event detail
capability projection; Jin and Google source disclosure; plain Event and Time
block semantics; Google/recurring read-only behavior; local-only context;
originating-task backlinks; removal with an opt-in, initially unchecked return
to Flexible; canonical refetch; locale switching; calendar return state; and
recoverable create/remove convergence with blocked divergent hashes.

## Mechanical verification

All commands were run at the exact verified commit.

- Focused modal regression: PASS, 33/33 tests.
- Full GUI suite: PASS, 1,628/1,628 tests.
- Production GUI build: PASS.
- CSS lint: PASS.
- Git diff/worktree checks: PASS and clean.
- Browser console: zero warnings and zero errors.

The preceding independent VIGIL passes also covered the complete Jin core and
bridge suites, formatting, linting, contention/recovery behavior, read-side
recovery, fail-closed conflict handling, and the complete headless interaction
matrix required by the M1 specification.

## Native visual verification

The owner/operator explicitly approved the native Tauri visual result on
2026-08-26. A final native computer-use rerun at the exact verified commit
confirmed the approved layout remained unchanged, the focused modal close `x`
was visible, and the removal checkbox retained its default unchecked state. The
native application then quit cleanly.

This native evidence is recorded separately from deterministic browser evidence;
browser checks are not represented as proof of native behavior.

## Architecture record gate

The ADR-0001 requirement is satisfied. Commit `177e1bd` amended
`docs/adr/0001-data-model-and-linking.md` with the narrow Calendar detail M1
scheduling exception: optional `agenda_bucket: flexible`, its create/remove and
inactive-state transitions, the recoverable-operation boundary, and the
preserved Task/Event identity and source-side edge rules. The final verified
implementation remains aligned with that amendment.

## Tonberry enforcement

`eidolons.mcp.lock` records Tonberry enforcement as `block`; the lifecycle
verification therefore runs in block mode. This chronicle and the sibling ECL
envelope are the checker evidence consumed before transition, drift check, and
archive.
