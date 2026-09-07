//! S8 — Export/backup sovereignty acceptance tests (VG2).
//!
//! All tests drive the real `jin` binary via `env!("CARGO_BIN_EXE_jin")` so
//! the full CLI path is exercised (not just `ops::export`).
//!
//! ## Isolation discipline
//! * Each test uses a fresh `TempDir` — no shared state.
//! * `token_backend = "file"` is forced in every root so subprocesses never
//!   touch the OS keyring (prevents races with a developer's real session).
//! * No `std::env::set_var / remove_var` — no global-env mutation.
//!
//! ## Coverage
//! 1. `s8_all_canonical_files_present_byte_identical`    — all .md files exported, byte-identical
//! 2. `s8_secrets_and_derived_caches_excluded`           — index/sync-state/tokens NOT in export
//! 3. `s8_round_trip_vg2`                               — export→fresh-init→rebuild→identical query results (VG2)
//! 4. `s8_audit_log_exported_and_human_readable`         — audit.jsonl exported, valid UTF-8
//! 5. `s8_empty_store_exports_cleanly`                   — empty store → exit 0
//! 6. `s8_dest_collision_refused_by_default`             — non-empty dest → non-zero exit without --force
//! 7. `s8_dest_collision_force_flag_succeeds`            — non-empty dest + --force → exit 0
//! 8. `s8_json_parity`                                   — --json envelope has per-type counts + dest
//! 9. `s8_google_source_event_included`                  — google-authority event included in export
//! 10. `s8_human_output_shows_breakdown`                  — human output shows per-type counts

use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

// ─── helpers ──────────────────────────────────────────────────────────────────

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

/// Initialise a fresh jin root with `token_backend = "file"` so the subprocess
/// never touches the OS keyring.
fn make_isolated_root() -> TempDir {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let out = Command::new(jin_bin())
        .args(["--root", root.to_str().unwrap(), "--json", "init"])
        .output()
        .expect("failed to spawn jin init");
    assert!(out.status.success(), "jin init failed");

    // Force file backend so subprocesses never race on the keyring.
    let mut cfg = jin_core::Config::load(root).expect("config must exist after init");
    cfg.token_backend = "file".to_string();
    cfg.save().expect("config must be saveable");

    tmp
}

/// Run `jin --root <root> --json <args…>` and return the parsed JSON envelope.
/// Panics with stderr on non-zero exit.
fn run_json(root: &Path, args: &[&str]) -> Value {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root).arg("--json");
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    if !out.status.success() {
        panic!(
            "jin exited {}\nargs: {:?}\nstderr: {}",
            out.status,
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "invalid JSON from jin: {}\nraw: {}",
            e,
            String::from_utf8_lossy(&out.stdout)
        )
    })
}

/// Run `jin --root <root> <args…>` in human mode.
/// Returns `(exit_code, stdout, stderr)`.
fn run_human(root: &Path, args: &[&str]) -> (i32, String, String) {
    let mut cmd = Command::new(jin_bin());
    cmd.arg("--root").arg(root);
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().expect("failed to spawn jin");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    )
}

/// Extract the `.data` field from the versioned envelope.
fn data(v: &Value) -> &Value {
    v.get("data").expect("envelope must have 'data' field")
}

/// Seed a Google-source event directly (no sync cycle needed).
/// Returns the event's ULID.
fn seed_google_event(root: &Path, title: &str, date: &str, wall_time: &str, tzid: &str) -> String {
    use chrono::NaiveDateTime;
    use jin_core::id::new_ulid;
    use jin_core::model::event::{
        Event, EventFrontmatter, EventSource, EventStatus, TemporalValue, ValueType,
    };
    use jin_core::store::fs::write_event;

    let id = new_ulid();
    let now = chrono::Local::now().fixed_offset();
    let start_str = format!("{}T{}", date, wall_time);
    let start_dt =
        NaiveDateTime::parse_from_str(&start_str, "%Y-%m-%dT%H:%M:%S").expect("valid datetime");
    let h: u32 = wall_time[..2].parse().unwrap_or(0);
    let end_str = format!(
        "{}T{:02}:{}:{}",
        date,
        h + 1,
        &wall_time[3..5],
        &wall_time[6..8]
    );
    let end_dt = NaiveDateTime::parse_from_str(&end_str, "%Y-%m-%dT%H:%M:%S").unwrap_or(start_dt);

    let fm = EventFrontmatter {
        id: id.clone(),
        kind: "event".to_string(),
        title: title.to_string(),
        description: None,
        location: None,
        start: TemporalValue::DateTime(start_dt),
        end: TemporalValue::DateTime(end_dt),
        start_value_type: ValueType::DateTime,
        end_value_type: ValueType::DateTime,
        is_all_day: false,
        start_tzid: Some(tzid.to_string()),
        end_tzid: Some(tzid.to_string()),
        floating: false,
        recurrence: vec![],
        recurring_event_id: None,
        original_start: None,
        master_id: None,
        recurrence_unexpanded: false,
        ical_uid: Some(format!("{}@google.com", id.to_lowercase())),
        sequence: 0,
        status: EventStatus::Confirmed,
        created: now,
        updated: now,
        transparency: None,
        visibility: None,
        organizer: None,
        attendees: None,
        attendees_omitted: None,
        conference_data: None,
        hangout_link: None,
        reminders: None,
        source: EventSource::Google,
        authority: EventSource::Google,
        calendar_id: "primary".to_string(),
        derived_from: None,
    };
    let event = Event {
        frontmatter: fm,
        body: String::new(),
    };
    write_event(&root.join("events"), &event).expect("write google event");
    jin_core::ops::api::refresh(root).expect("refresh after seeding google event");
    id
}

// ─── tests ────────────────────────────────────────────────────────────────────

/// AC-1 (byte-identical): All canonical `.md` files from notes/, tasks/, events/
/// are present in the export and byte-identical to the originals.
#[test]
fn s8_all_canonical_files_present_byte_identical() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    // Seed one of each type.
    run_json(src, &["note", "add", "Sovereignty note"]);
    run_json(src, &["task", "add", "Sovereignty task"]);
    run_json(
        src,
        &[
            "event",
            "add",
            "Sovereignty event",
            "--start",
            "2026-07-01T10:00:00",
            "--end",
            "2026-07-01T11:00:00",
            "--tz",
            "UTC",
        ],
    );

    // Export.
    let (code, _stdout, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code, 0, "export must exit 0; stderr: {}", stderr);

    // Every .md file in the source must be byte-identical in the export.
    // Wave 2A (VG-EXPORT): notes/ is walked recursively; tasks/ and events/ stay flat.
    for subdir in &["tasks", "events"] {
        let src_dir = src.join(subdir);
        let dst_dir = dst.join(subdir);
        let entries: Vec<_> = std::fs::read_dir(&src_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert!(
            !entries.is_empty(),
            "{} must have at least one file",
            subdir
        );

        for entry in entries {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let dst_file = dst_dir.join(entry.file_name());
                assert!(
                    dst_file.exists(),
                    "exported file must exist: {}",
                    dst_file.display()
                );
                let src_bytes = std::fs::read(&path).unwrap();
                let dst_bytes = std::fs::read(&dst_file).unwrap();
                assert_eq!(
                    src_bytes,
                    dst_bytes,
                    "exported file must be byte-identical: {}",
                    entry.file_name().to_string_lossy()
                );
            }
        }
    }

    // notes/ is walked recursively (Wave 2A): verify all note files are present and byte-identical.
    {
        let notes_src = src.join("notes");
        let notes_dst = dst.join("notes");
        let src_paths = jin_core::store::fs::list_note_paths(&notes_src).unwrap();
        assert!(!src_paths.is_empty(), "notes must have at least one file");
        for src_path in &src_paths {
            let rel = src_path.strip_prefix(&notes_src).unwrap();
            let dst_path = notes_dst.join(rel);
            assert!(
                dst_path.exists(),
                "exported note must exist: {}",
                dst_path.display()
            );
            let src_bytes = std::fs::read(src_path).unwrap();
            let dst_bytes = std::fs::read(&dst_path).unwrap();
            assert_eq!(
                src_bytes,
                dst_bytes,
                "exported note must be byte-identical: {}",
                rel.display()
            );
        }
    }
}

/// AC-2 (sovereignty guarantee): `index.sqlite`, `sync-state.sqlite`,
/// `outbox.jsonl`, and `tokens.enc` must be ABSENT from the export.
/// This is the hard sovereignty contract — zero secrets, zero derived caches.
#[test]
fn s8_secrets_and_derived_caches_excluded() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    // Seed minimal data so the export has something to do.
    run_json(src, &["note", "add", "Some note"]);

    // Write placeholder files that must NOT appear in the export.
    let jin_dir = src.join(".jin");
    let sync_dir = jin_dir.join("sync");
    std::fs::write(jin_dir.join("index.sqlite"), b"FAKE_SQLITE").unwrap();
    std::fs::write(sync_dir.join("sync-state.sqlite"), b"FAKE_SYNC").unwrap();
    std::fs::write(sync_dir.join("outbox.jsonl"), b"{}").unwrap();
    std::fs::write(sync_dir.join("tokens.enc"), b"FAKE_SECRET").unwrap();

    // Export.
    let (code, _stdout, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code, 0, "export must exit 0; stderr: {}", stderr);

    // These MUST NOT be present in the export.
    assert!(
        !dst.join(".jin").join("index.sqlite").exists(),
        "index.sqlite must NOT be exported (derived cache, not sovereign)"
    );
    assert!(
        !dst.join(".jin")
            .join("sync")
            .join("sync-state.sqlite")
            .exists(),
        "sync-state.sqlite must NOT be exported (volatile operational state)"
    );
    assert!(
        !dst.join(".jin").join("sync").join("outbox.jsonl").exists(),
        "outbox.jsonl must NOT be exported (volatile outbox)"
    );
    assert!(
        !dst.join(".jin").join("sync").join("tokens.enc").exists(),
        "tokens.enc must NOT be exported (secret — sovereignty guarantee: ZERO secrets)"
    );

    // audit.jsonl MUST be present (created by `jin init`, exported as sovereign log).
    assert!(
        dst.join(".jin").join("sync").join("audit.jsonl").exists(),
        "audit.jsonl must be exported (human-readable sovereign-adjacent log)"
    );
}

/// VG2 — Round-trip: export a populated store with notes, tasks, a promoted
/// event (note→event prep-for + event→task derived-from), and a Google-mirrored
/// event; import into a fresh `jin init`'d root; rebuild the index; assert
/// identical query results (IDs, counts, backlinks).
#[test]
fn s8_round_trip_vg2() {
    // ── 1. Build a populated original store ──────────────────────────────────
    let orig_tmp = make_isolated_root();
    let orig = orig_tmp.path();

    // Create a note.
    let note_env = run_json(orig, &["note", "add", "VG2 prep note"]);
    let note_id = data(&note_env)["id"].as_str().unwrap().to_string();

    // Create a task.
    let task_env = run_json(orig, &["task", "add", "VG2 task"]);
    let task_id = data(&task_env)["id"].as_str().unwrap().to_string();

    // Promote the task to an event (writes derived_from in event frontmatter).
    let event_env = run_json(
        orig,
        &[
            "promote",
            &task_id,
            "--when",
            "2026-08-01T09:00:00",
            "--tz",
            "UTC",
        ],
    );
    let event_id = data(&event_env)["id"].as_str().unwrap().to_string();

    // Attach the note to the event (writes prep-for in note frontmatter).
    run_json(orig, &["attach", &note_id, &event_id]);

    // Seed a google-source event.
    let google_event_id =
        seed_google_event(orig, "VG2 google mirror", "2026-08-01", "14:00:00", "UTC");

    // ── 2. Export ─────────────────────────────────────────────────────────────
    let export_tmp = TempDir::new().unwrap();
    let export_dest = export_tmp.path().join("vg2_export");
    let (code, _, stderr) = run_human(orig, &["export", export_dest.to_str().unwrap()]);
    assert_eq!(code, 0, "export must exit 0; stderr: {}", stderr);

    // ── 3. Fresh store: init + copy canonical files from export ───────────────
    let fresh_tmp = make_isolated_root();
    let fresh = fresh_tmp.path();

    // Wave 2A: copy notes recursively, preserving folder structure.
    {
        let notes_src = export_dest.join("notes");
        let notes_dst = fresh.join("notes");
        if notes_src.exists() {
            let note_paths = jin_core::store::fs::list_note_paths(&notes_src).unwrap();
            for src_path in note_paths {
                let rel = src_path.strip_prefix(&notes_src).unwrap();
                let dst_path = notes_dst.join(rel);
                if let Some(parent) = dst_path.parent() {
                    std::fs::create_dir_all(parent).unwrap();
                }
                std::fs::copy(&src_path, &dst_path).unwrap();
            }
        }
    }
    for subdir in &["tasks", "events"] {
        let src_dir = export_dest.join(subdir);
        let dst_dir = fresh.join(subdir);
        if src_dir.exists() {
            for entry in std::fs::read_dir(&src_dir).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    std::fs::copy(&path, dst_dir.join(entry.file_name())).unwrap();
                }
            }
        }
    }
    // Copy audit.jsonl if present.
    let audit_export = export_dest.join(".jin").join("sync").join("audit.jsonl");
    if audit_export.exists() {
        let fresh_sync = fresh.join(".jin").join("sync");
        std::fs::create_dir_all(&fresh_sync).unwrap();
        std::fs::copy(&audit_export, fresh_sync.join("audit.jsonl")).unwrap();
    }

    // ── 4. Rebuild the fresh index ────────────────────────────────────────────
    jin_core::ops::api::refresh(fresh).expect("rebuild index in fresh store");

    // ── 5a. Object counts and IDs must match ─────────────────────────────────
    // Notes.
    let orig_note_list = run_json(orig, &["note", "list"]);
    let fresh_note_list = run_json(fresh, &["note", "list"]);
    let mut orig_note_ids: Vec<String> = data(&orig_note_list)
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect();
    let mut fresh_note_ids: Vec<String> = data(&fresh_note_list)
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect();
    orig_note_ids.sort();
    fresh_note_ids.sort();
    assert_eq!(
        orig_note_ids, fresh_note_ids,
        "note IDs must be identical after round-trip"
    );

    // Tasks.
    let orig_task_list = run_json(orig, &["task", "list"]);
    let fresh_task_list = run_json(fresh, &["task", "list"]);
    let mut orig_task_ids: Vec<String> = data(&orig_task_list)
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect();
    let mut fresh_task_ids: Vec<String> = data(&fresh_task_list)
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect();
    orig_task_ids.sort();
    fresh_task_ids.sort();
    assert_eq!(
        orig_task_ids, fresh_task_ids,
        "task IDs must be identical after round-trip"
    );

    // Events (includes both promoted + google-mirrored).
    let orig_event_list = run_json(orig, &["event", "list"]);
    let fresh_event_list = run_json(fresh, &["event", "list"]);
    let mut orig_event_ids: Vec<String> = data(&orig_event_list)
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap().to_string())
        .collect();
    let mut fresh_event_ids: Vec<String> = data(&fresh_event_list)
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap().to_string())
        .collect();
    orig_event_ids.sort();
    fresh_event_ids.sort();
    assert_eq!(
        orig_event_ids, fresh_event_ids,
        "event IDs must be identical after round-trip (includes google-mirrored event)"
    );

    // ── 5b. Backlinks must survive the round-trip ─────────────────────────────
    //
    // Edge topology after setup:
    //   note  --[prep-for]-->    event  (stored in note frontmatter links[])
    //   event --[derived-from]--> task  (stored in event frontmatter derived_from)
    //
    // Backlinks (materialized on TARGET by the index):
    //   event.backlinks: note→event prep-for  (backlink_label = "prep-notes")
    //   task.backlinks:  event→task derived-from (backlink_label = "has-event")

    // Event should have 1 prep-for backlink from the note.
    let orig_event_show = run_json(orig, &["event", "show", &event_id]);
    let fresh_event_show = run_json(fresh, &["event", "show", &event_id]);
    let orig_event_bls = data(&orig_event_show)["backlinks"]
        .as_array()
        .expect("orig event backlinks must be array");
    let fresh_event_bls = data(&fresh_event_show)["backlinks"]
        .as_array()
        .expect("fresh event backlinks must be array");
    assert_eq!(
        orig_event_bls.len(),
        fresh_event_bls.len(),
        "event prep-for backlink count must match after round-trip"
    );
    // Verify the prep-for backlink is present in the fresh store.
    let fresh_prep_bl = fresh_event_bls
        .iter()
        .find(|b| b["edge_type"].as_str() == Some("prep-for"))
        .expect("prep-for backlink must survive round-trip on the event");
    assert_eq!(fresh_prep_bl["source_id"].as_str().unwrap(), note_id);
    assert_eq!(fresh_prep_bl["label"].as_str().unwrap(), "prep-notes");

    // Task should have 1 derived-from backlink from the promoted event.
    let orig_task_show = run_json(orig, &["task", "show", &task_id]);
    let fresh_task_show = run_json(fresh, &["task", "show", &task_id]);
    let orig_task_bls = data(&orig_task_show)["backlinks"]
        .as_array()
        .expect("orig task backlinks must be array");
    let fresh_task_bls = data(&fresh_task_show)["backlinks"]
        .as_array()
        .expect("fresh task backlinks must be array");
    assert_eq!(
        orig_task_bls.len(),
        fresh_task_bls.len(),
        "task derived-from backlink count must match after round-trip"
    );
    let fresh_task_bl = fresh_task_bls
        .iter()
        .find(|b| b["edge_type"].as_str() == Some("derived-from"))
        .expect("derived-from backlink must survive round-trip on the task");
    assert_eq!(fresh_task_bl["source_id"].as_str().unwrap(), event_id);
    assert_eq!(fresh_task_bl["label"].as_str().unwrap(), "has-event");

    // ── 5c. Google-source event flags survive the round-trip ─────────────────
    let fresh_google = run_json(fresh, &["event", "show", &google_event_id]);
    assert_eq!(
        data(&fresh_google)["source"].as_str().unwrap(),
        "google",
        "google event must carry source=google in fresh store after round-trip"
    );
    assert_eq!(
        data(&fresh_google)["authority"].as_str().unwrap(),
        "google",
        "google event must carry authority=google in fresh store after round-trip"
    );
}

/// AC-4 (audit log): `.jin/sync/audit.jsonl` is exported and every byte is
/// human-readable (valid UTF-8) — the sovereignty acceptance test.
#[test]
fn s8_audit_log_exported_and_human_readable() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    // Write realistic JSONL into the audit log.
    let audit_path = src.join(".jin").join("sync").join("audit.jsonl");
    std::fs::write(
        &audit_path,
        "{\"ts\":\"2026-07-01T09:00:00Z\",\"type\":\"pull-diverged\",\
         \"jin_id\":\"01J_FAKE\",\"winner\":\"jin\",\"policy\":\"lww-by-updated\"}\n",
    )
    .unwrap();

    let (code, _stdout, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code, 0, "export must exit 0; stderr: {}", stderr);

    let exported_audit = dst.join(".jin").join("sync").join("audit.jsonl");
    assert!(
        exported_audit.exists(),
        "audit.jsonl must be present in the export"
    );

    // Every byte must be human-readable (valid UTF-8 — no binary).
    let bytes = std::fs::read(&exported_audit).unwrap();
    let text = std::str::from_utf8(&bytes).expect(
        "audit.jsonl must be valid UTF-8 — sovereignty AC: every exported byte human-readable",
    );

    // Must contain the original JSONL content.
    assert!(
        text.contains("pull-diverged"),
        "exported audit.jsonl must contain the original log entries; got:\n{}",
        text
    );

    // Must be parseable as JSONL (each non-empty line is valid JSON).
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        serde_json::from_str::<serde_json::Value>(line).unwrap_or_else(|e| {
            panic!("audit.jsonl line is not valid JSON: {}\nline: {}", e, line)
        });
    }
}

/// AC-5 (empty store): Exporting an empty store exits 0 with a clean message.
#[test]
fn s8_empty_store_exports_cleanly() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    let (code, stdout, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(
        code, 0,
        "exporting an empty store must exit 0; stderr: {}",
        stderr
    );
    assert!(
        stdout.contains("Exported") || stdout.contains("notes") || stdout.contains("0"),
        "empty export must print a summary; got:\n{}",
        stdout
    );

    // The dest directory must be created.
    assert!(dst.exists(), "dest directory must be created by export");

    // Only audit.jsonl is exported from an empty store (init creates it).
    assert!(
        !dst.join("notes").exists()
            || std::fs::read_dir(dst.join("notes"))
                .map(|mut d| d.next().is_none())
                .unwrap_or(true),
        "notes/ in export must be empty or absent for an empty store"
    );
}

/// AC-6 (dest collision, safe default): Re-exporting to the same non-empty
/// destination without `--force` must fail with a non-zero exit code.
#[test]
fn s8_dest_collision_refused_by_default() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    run_json(src, &["note", "add", "Collision test note"]);

    // First export — must succeed.
    let (code, _, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code, 0, "first export must succeed; stderr: {}", stderr);

    // Second export to same non-empty dest — must FAIL without --force.
    let (code2, _stdout2, stderr2) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_ne!(
        code2, 0,
        "second export to non-empty dest must fail without --force; stderr: {}",
        stderr2
    );

    // Error must mention --force or the problem so the user knows what to do.
    assert!(
        stderr2.to_lowercase().contains("force")
            || stderr2.to_lowercase().contains("not empty")
            || stderr2.to_lowercase().contains("empty"),
        "error must mention --force or 'not empty'; got stderr: {}",
        stderr2
    );
}

/// AC-6 (dest collision, --force): Re-exporting with `--force` must succeed
/// even when the destination already has files.
#[test]
fn s8_dest_collision_force_flag_succeeds() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    run_json(src, &["note", "add", "Force test note"]);

    // First export — succeed.
    let (code1, _, _) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code1, 0, "first export must succeed");

    // Second export with --force — must succeed.
    let (code2, stdout2, stderr2) = run_human(src, &["export", "--force", dst.to_str().unwrap()]);
    assert_eq!(
        code2, 0,
        "export with --force must succeed over non-empty dest; stderr: {}",
        stderr2
    );
    assert!(
        stdout2.contains("Exported") || stdout2.contains("notes"),
        "export with --force must print a summary; got:\n{}",
        stdout2
    );
}

/// AC-3 (`--json` parity): The `--json` envelope must include per-type counts,
/// `audit_included`, `dest`, `files_exported`, and the `files` manifest.
#[test]
fn s8_json_parity() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    // Seed one of each type.
    run_json(src, &["note", "add", "JSON parity note"]);
    run_json(src, &["task", "add", "JSON parity task"]);
    run_json(
        src,
        &[
            "event",
            "add",
            "JSON parity event",
            "--start",
            "2026-09-01T10:00:00",
            "--end",
            "2026-09-01T11:00:00",
            "--tz",
            "UTC",
        ],
    );

    let env = run_json(src, &["export", dst.to_str().unwrap()]);

    // Envelope structure (VG3).
    assert_eq!(env["jin_dto_version"].as_str().unwrap(), "1");
    assert_eq!(env["kind"].as_str().unwrap(), "result");

    let d = data(&env);
    assert!(d["ok"].as_bool().unwrap());

    // Per-type counts.
    assert_eq!(d["notes"].as_u64().unwrap(), 1, "--json must report 1 note");
    assert_eq!(d["tasks"].as_u64().unwrap(), 1, "--json must report 1 task");
    assert_eq!(
        d["events"].as_u64().unwrap(),
        1,
        "--json must report 1 event"
    );

    // audit_included must be boolean.
    assert!(
        d["audit_included"].is_boolean(),
        "audit_included must be a boolean in --json output"
    );

    // files_exported must equal sum of per-type counts + audit.
    let expected_total = d["notes"].as_u64().unwrap()
        + d["tasks"].as_u64().unwrap()
        + d["events"].as_u64().unwrap()
        + if d["audit_included"].as_bool().unwrap() {
            1
        } else {
            0
        };
    assert_eq!(
        d["files_exported"].as_u64().unwrap(),
        expected_total,
        "files_exported must equal notes+tasks+events+audit"
    );

    // dest must be present and non-empty.
    assert!(
        d["dest"].as_str().map(|s| !s.is_empty()).unwrap_or(false),
        "dest must be a non-empty string in --json output"
    );

    // files must be an array with the right length.
    let files = d["files"].as_array().expect("files must be an array");
    assert_eq!(
        files.len() as u64,
        expected_total,
        "files array length must match files_exported"
    );

    // Every file path must start with notes/, tasks/, events/, or .jin/.
    for f in files {
        let s = f.as_str().unwrap();
        assert!(
            s.starts_with("notes/")
                || s.starts_with("tasks/")
                || s.starts_with("events/")
                || s.starts_with(".jin/"),
            "file path '{}' must be under notes/, tasks/, events/, or .jin/",
            s
        );
    }
}

/// AC (google-source event): A Google-mirrored event (source=google,
/// authority=google) is included in the export as a human-readable `.md` file,
/// with source/authority flags clearly present in the content.
#[test]
fn s8_google_source_event_included() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    // Seed a Google-source event.
    let google_id = seed_google_event(src, "Company standup", "2026-07-01", "09:00:00", "UTC");

    let (code, _, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code, 0, "export must exit 0; stderr: {}", stderr);

    // One .md file must be in events/ of the export.
    let events_dir = dst.join("events");
    assert!(events_dir.exists(), "events/ directory must be in export");
    let event_files: Vec<_> = std::fs::read_dir(&events_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()).unwrap_or("") == "md")
        .collect();
    assert_eq!(
        event_files.len(),
        1,
        "exactly 1 event file must be exported"
    );

    // The exported file must be human-readable (valid UTF-8).
    let exported_content = std::fs::read_to_string(event_files[0].path())
        .expect("exported event file must be valid UTF-8");

    // Must contain the ULID id.
    assert!(
        exported_content.contains(&google_id),
        "exported event file must contain the event's ULID id"
    );

    // Must contain source: google — clearly flagged as non-sovereign cache.
    assert!(
        exported_content.contains("source: google")
            || exported_content.contains("source: \"google\""),
        "exported google event must be flagged source: google; content:\n{}",
        exported_content
    );

    // Must contain authority: google.
    assert!(
        exported_content.contains("authority: google")
            || exported_content.contains("authority: \"google\""),
        "exported google event must be flagged authority: google; content:\n{}",
        exported_content
    );
}

/// Human output must show per-type breakdown (N notes, N tasks, N events).
#[test]
fn s8_human_output_shows_breakdown() {
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("export");

    run_json(src, &["note", "add", "Breakdown note"]);
    run_json(src, &["task", "add", "Breakdown task"]);

    let (code, stdout, stderr) = run_human(src, &["export", dst.to_str().unwrap()]);
    assert_eq!(code, 0, "export must exit 0; stderr: {}", stderr);

    // Human output must show per-type counts (notes/tasks/events).
    assert!(
        stdout.contains("notes") || stdout.contains("note"),
        "human output must mention notes; got:\n{}",
        stdout
    );
    assert!(
        stdout.contains("tasks") || stdout.contains("task"),
        "human output must mention tasks; got:\n{}",
        stdout
    );
    // Dest path must appear.
    assert!(
        stdout.contains(dst.to_str().unwrap()) || stdout.contains("Exported"),
        "human output must mention dest path; got:\n{}",
        stdout
    );
}

/// VG-EXPORT (Wave 2A, P0 blocking gate) — foldered note + empty folder round-trip.
///
/// Verifies that:
///   (a) A note in a folder (`notes/Work/`) is exported with its subpath preserved.
///   (b) The manifest `files` array contains `notes/Work/<filename>`.
///   (c) An empty folder (`notes/Empty/`) is preserved in the export dest.
///   (d) Re-`init` a fresh root from the export + `api::refresh` →
///       `list_notes(folder="Work")` returns the note with `folder_path="Work"`.
#[test]
fn s8_vg_export_foldered_note_and_empty_folder_round_trip() {
    use jin_core::ops::{api, notes};
    use jin_core::Config;

    // ── 1. Build a source store with a foldered note + empty folder. ──────────
    let src_tmp = make_isolated_root();
    let src = src_tmp.path();

    // Create the "Work" folder and a note inside it.
    {
        let cfg = Config::load(src).expect("load config");
        let notes_dir = cfg.notes_dir();

        // Create an empty "Empty" folder.
        std::fs::create_dir_all(notes_dir.join("Empty")).expect("create Empty folder");

        // Create a note in the "Work" folder.
        notes::create_note(
            &notes_dir,
            notes::CreateNoteParams {
                title: "Work Note".to_string(),
                body: "content in Work folder".to_string(),
                tags: vec![],
                folder: "Work".to_string(),
            },
        )
        .expect("create note in Work folder");

        api::refresh(src).expect("refresh after seeding");
    }

    // ── 2. Export. ────────────────────────────────────────────────────────────
    let dst_tmp = TempDir::new().unwrap();
    let dst = dst_tmp.path().join("vg_export");
    let env = run_json(src, &["export", dst.to_str().unwrap()]);
    let d = data(&env);
    assert!(d["ok"].as_bool().unwrap_or(false), "export must succeed");

    // (a) The exported note must be under notes/Work/.
    let notes_dst = dst.join("notes");
    let work_files: Vec<_> = {
        let work_dir = notes_dst.join("Work");
        assert!(work_dir.exists(), "notes/Work/ must exist in export");
        std::fs::read_dir(&work_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|x| x.to_str()).unwrap_or("") == "md")
            .collect()
    };
    assert_eq!(work_files.len(), 1, "exactly 1 note must be in notes/Work/");

    // (b) The manifest must contain notes/Work/<filename>.
    let files = d["files"].as_array().expect("files must be array");
    let work_in_manifest = files.iter().any(|f| {
        f.as_str()
            .map(|s| s.starts_with("notes/Work/"))
            .unwrap_or(false)
    });
    assert!(
        work_in_manifest,
        "manifest must contain notes/Work/<file>; files: {:?}",
        files
    );

    // (c) Empty folder must be preserved.
    assert!(
        dst.join("notes").join("Empty").exists(),
        "notes/Empty/ must be preserved in export (empty-dir sovereignty)"
    );

    // ── 3. Round-trip: init fresh store, copy exported files, rebuild, list. ──
    let fresh_tmp = make_isolated_root();
    let fresh = fresh_tmp.path();
    {
        let fresh_cfg = Config::load(fresh).expect("load fresh config");
        let fresh_notes = fresh_cfg.notes_dir();

        // Copy all notes recursively from export to fresh store.
        let src_notes = dst.join("notes");
        let note_paths = jin_core::store::fs::list_note_paths(&src_notes).unwrap();
        for src_path in note_paths {
            let rel = src_path.strip_prefix(&src_notes).unwrap();
            let dst_path = fresh_notes.join(rel);
            if let Some(parent) = dst_path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::copy(&src_path, &dst_path).unwrap();
        }
    }

    // Rebuild the index.
    api::refresh(fresh).expect("rebuild index in fresh store");

    // (d) list_notes(folder="Work") must return the note with folder_path="Work".
    let work_notes = api::list_notes(fresh, false, None, Some("Work"))
        .expect("list_notes with folder=Work must succeed");
    assert_eq!(
        work_notes.len(),
        1,
        "exactly 1 note must appear in list_notes(folder=Work) after round-trip"
    );
    assert_eq!(
        work_notes[0].folder_path.as_deref(),
        Some("Work"),
        "note must have folder_path=Work after round-trip"
    );
    assert_eq!(work_notes[0].title, "Work Note");
}
