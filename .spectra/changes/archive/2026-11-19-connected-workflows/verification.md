# Connected workflows verification

VIGIL independently checked this change on 2026-11-19. Product source remained owned by Vivi. The checker wrote lifecycle records only.

## Independent checks

- The final focused GUI checks passed 233 tests across Notes (209), linked creation (6), scheduling (7), and Find (11). Notes and linked creation were rerun after the external-body divergence and locale corrections. Logs: `a temporary local evidence file` and `a temporary local evidence files-last.log`.
- Core linked creation passed six tests covering stale or deleted sources, payload identity, interrupted multi-file recovery, bidirectional links after index rebuild, and local event prep notes. Log: `a temporary local evidence file`.
- Core promotion passed five tests covering chosen duration, preserved existing blocks, retries, invalid durations, DST ambiguity and elapsed-time behavior. Log: `a temporary local evidence file`.
- An actual Tauri dispatcher test passed with the frontend's snake_case request, proving a reviewed 45-minute schedule reaches the command and returns the correct task relationship and 14:15–15:00 event. Log: `a temporary local evidence file`.
- Targeted diff whitespace validation passed. Git emitted its existing fsmonitor connection diagnostic.

## Source review and corrected issues

The checker reviewed canonical writes and projection refresh, vault locking of source-note mutations, stable operation identity, exact selected prose, source revision handling, resolved outgoing titles, recurrence scope, guarded cross-object navigation, stale Find requests, partial request failures, keyboard selection, and focus restoration.

Direct note edits refresh the index. Fresh note detail resolves linked destination titles and kinds from stable IDs and excludes deleted destinations. Task creation updates outgoing relationships without rebuilding the live editor. The keep-writing path preserves editor identity, selection and next-save revision. A changed external source body returned during replay enters conflict recovery instead of adopting a revision that could overwrite that body.

Two review concerns were corrected and covered by regressions. Note navigation now checks for a metadata conflict after awaiting the mutation queue and before destroying the editor. Scheduling freezes its reviewed payload after the first submission and waits for destination and existing-block discovery, so retry cannot silently substitute a different duration or calendar.

The native smoke initially exposed a real Tauri command mismatch: the frontend sent snake_case top-level arguments while the command macro defaulted to camelCase. Two native attempts failed before a promotion journal or event existed. The command now explicitly declares snake_case arguments and the actual dispatcher regression passes. The rebuilt native application subsequently persisted the reviewed event successfully. The new Find and linked-creation routes were also inspected for argument casing: they use single-word keys or typed nested input objects. Pre-existing optional include_deleted casing inconsistencies are not used by the new Find calls, which rely on the false default.

## Execution-team evidence

- The final broad frontend rerun passed 2251 tests in 77 files. Complete core Rust integration coverage passed 547 tests and the GUI Rust package passed 150 tests. TypeScript, production build, CSS lint, Clippy and Rust formatting passed.
- Browser verification exercised the complete event-to-prep-note-to-selected-task-to-scheduled-event roundtrip and return to the source at desktop width. At 390 pixels, keep-writing preserved the same live editor and focus. No page overflow or console errors were observed.
- The production roundtrip smoke passed with a São Paulo host and a reviewed UTC schedule. The complete existing layout matrix and Notes writing smoke passed.
- All three visual references compared cleanly, and the visual self-test passed.
- The rebuilt native app passed its ad-hoc macOS signature check and ran against a disposable vault. It found a task saved before relaunch, displayed its titled source note, scheduled 2026-11-20 14:15 UTC for 45 minutes, opened the persisted event and originating task, and offered Open time block on repeat scheduling. The source note displayed both event and task links. Canonical files confirmed 14:15–15:00 UTC and exactly one event derived from the task.

## Coverage boundary

Browser checks use the deterministic fixture bridge. Native verification above exercised real IPC and canonical persistence in a disposable vault. These checks establish functional and layout behavior; the owner's aesthetic acceptance remains a separate judgment and is not claimed. This checker inherited the parent context, so no fresh-context attestation is claimed.

No remaining blocking discrepancy was found against the recorded acceptance criteria.

Tonberry block verification returned exit code zero with every MUST check passing. The optional C8 fresh-context advisory remains unsatisfied because this checker inherited the parent context. The distinct checker recorded no spec drift and archived the change on 2026-11-19.
