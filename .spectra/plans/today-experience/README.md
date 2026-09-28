# Today experience

Status: implemented-pending-native-review. Frontend implementation is complete in the managed worktree at `/Users/henrique/.codex/worktrees/today-spec/jin`, based on the source baseline below. Native Tauri owner sign-off is pending; the changes are not merged.

Source baseline: `public/main` at `30dfdd8ad1e9a1b12b34ac580802f48a9cc3926f` (`Unify calendar, notes, and task workflows`, 2026-09-28). The request’s “remote main” baseline is recorded as the checked-out `public/main` ref; `origin/main` remains an older SHA and was not substituted silently.

Artifacts:

- [research.md](research.md) — evidence levels, ATLAS findings, and external normative links.
- [spec.md](spec.md) — RAMZA product and interaction contract.
- [plan.md](plan.md) — concrete seams and proportional verification.
- [implementation.md](implementation.md) — implemented seams, preserved behavior, and verification evidence.
- [routing.json](routing.json) — selected Eidolons and standard-tier routing.

Evidence limits: browser evidence covers the frontend implementation and does not provide native WebKit proof or owner visual sign-off. The full frontend suite remains partial because its cross-language `dto_shapes` check filled the isolated Cargo target disk; the generated target was cleaned afterward. No PR or commit was created for this dossier.
