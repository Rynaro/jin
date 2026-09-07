use std::path::Path;

use crate::config::Config;
use crate::{JinError, Result};

/// Initialize a jin root at `root`. Idempotent — re-running does not clobber
/// existing data (only creates missing dirs/files).
///
/// K1: On every call, opens the index and applies the schema (which includes the
/// idempotent ALTER for the `excerpt` column, D5 R1).  When the index schema
/// sentinel is absent or outdated, runs a full rebuild to populate new columns
/// (e.g. `excerpt`) for pre-existing notes (one-time, version-gated).
pub fn init(root: &Path) -> Result<Config> {
    if Config::config_path(root).exists() {
        let cfg = Config::load(root)?;
        // K1: schema apply + version-gated one-time rebuild.
        version_gate_rebuild(root, &cfg)?;
        return Ok(cfg);
    }

    // Fresh install: create canonical dirs.
    let dirs = [
        root.to_path_buf(),
        root.join("notes"),
        root.join("collections"),
        root.join("tasks"),
        root.join("events"),
        root.join(".jin"),
        root.join(".jin").join("assets").join("sha256"),
        root.join(".jin").join("sync"),
    ];
    for dir in &dirs {
        std::fs::create_dir_all(dir)?;
    }

    // Write config.toml
    let config = Config::new(root.to_path_buf());
    config.save()?;

    // Create a stub .jin/sync/audit.jsonl (empty)
    let audit_path = root.join(".jin").join("sync").join("audit.jsonl");
    if !audit_path.exists() {
        std::fs::write(&audit_path, "")?;
    }

    // K1: set initial version sentinel on fresh index (no rebuild needed — empty).
    version_gate_rebuild(root, &config)?;

    Ok(config)
}

/// K1 implementation: open the index (which applies the schema migration),
/// and if the schema version sentinel is missing or outdated run a full rebuild
/// to populate the `excerpt` column for pre-existing notes, then set the sentinel.
fn version_gate_rebuild(root: &Path, cfg: &Config) -> Result<()> {
    use crate::index;
    use crate::index::schema;

    let conn = index::open(&cfg.index_path())?;
    if schema::is_current_version(&conn).map_err(JinError::Index)? {
        // Already up-to-date; nothing to do.
        return Ok(());
    }

    // Drop the connection before rebuild (rebuild opens its own connection).
    drop(conn);

    // Rebuild must succeed before the version is acknowledged. In particular,
    // a blocked canonical operation keeps the old/missing sentinel so startup
    // retries the upgrade after explicit conflict resolution.
    super::api::refresh(root)?;

    // Set the sentinel so this runs only once per schema version.
    let conn2 = index::open(&cfg.index_path())?;
    schema::set_version(&conn2).map_err(JinError::Index)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn init_creates_layout() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let cfg = init(root).unwrap();
        assert_eq!(cfg.schema_version, 1);
        assert!(root.join("notes").is_dir());
        assert!(root.join("tasks").is_dir());
        assert!(root.join("events").is_dir());
        assert!(root.join(".jin").is_dir());
        assert!(root.join(".jin").join("sync").is_dir());
        assert!(root.join(".jin").join("config.toml").is_file());
    }

    #[test]
    fn init_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Write a file to notes/; it must survive second init
        init(root).unwrap();
        let sentinel = root.join("notes").join("sentinel.txt");
        std::fs::write(&sentinel, "keep me").unwrap();

        // Second init
        init(root).unwrap();
        assert!(
            sentinel.exists(),
            "sentinel should not be deleted by re-init"
        );
    }

    #[test]
    fn version_gate_preserves_old_sentinel_when_recovery_is_blocked() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let cfg = init(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', 'old')",
            [],
        )
        .unwrap();
        drop(conn);

        let target = root.join("tasks/version-conflict.md");
        crate::store::fs::atomic_write(&target, b"before").unwrap();
        crate::ops::recoverable_operations::stage_test_operation(
            root,
            "blocked-upgrade",
            "event-1",
            vec![crate::ops::recoverable_operations::TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        crate::store::fs::atomic_write(&target, b"external").unwrap();

        assert!(init(root).is_err());
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let stored: String = conn
            .query_row(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "old");
        drop(conn);

        std::fs::remove_dir_all(root.join(".jin/operations/blocked-upgrade")).unwrap();
        init(root).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        assert!(crate::index::schema::is_current_version(&conn).unwrap());
    }

    /// VG-K1: pre-existing notes get their excerpt populated after one init call.
    #[test]
    fn vg_k1_pre_existing_notes_get_excerpt_populated() {
        use crate::index;
        use crate::index::schema;
        use rusqlite::OptionalExtension;

        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // 1. Perform a first init so the root + index exist.
        let cfg = init(root).unwrap();
        let index_path = cfg.index_path();

        // 2. Create a note file directly (simulates a pre-existing note).
        let note_body = "This is the pre-existing note body.";
        let note_id = "01TESTPRE000000000000000001";
        let note_path = root.join("notes").join(format!("{}.md", note_id));
        let note_content = format!(
            "---\nid: {}\ntype: note\ntitle: Pre-Existing\ncreated: 2026-01-01T00:00:00+00:00\nupdated: 2026-01-01T00:00:00+00:00\nstatus: active\n---\n{}",
            note_id, note_body
        );
        std::fs::write(&note_path, &note_content).unwrap();

        // 3. Reset the version sentinel so init thinks it's on an old schema.
        {
            let conn = index::open(&index_path).unwrap();
            conn.execute("DELETE FROM schema_meta WHERE key = 'schema_version'", [])
                .unwrap();
        }

        // 4. Call init again — it should detect the missing sentinel and rebuild.
        init(root).unwrap();

        // 5. Open the index and verify the note has a populated excerpt.
        let conn = index::open(&index_path).unwrap();
        let excerpt: Option<String> = conn
            .query_row(
                "SELECT excerpt FROM notes WHERE id = ?1",
                rusqlite::params![note_id],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(excerpt.is_some(), "note must appear in index after rebuild");
        let excerpt = excerpt.unwrap();
        assert!(
            !excerpt.is_empty(),
            "excerpt must be populated (non-empty) after version-gated rebuild"
        );
        assert!(
            excerpt.contains("pre-existing note body"),
            "excerpt must contain content from the note body"
        );

        // 6. Version sentinel must now be set.
        assert!(
            schema::is_current_version(&conn).unwrap(),
            "schema version sentinel must be set after version-gated rebuild"
        );
    }

    /// VG-K1-FOLDER (Issue 6): a note placed in a SUBFOLDER before the version-gate
    /// rebuild must have its `folder_path` column populated correctly — NOT left as "".
    ///
    /// This mirrors the Wave-1 `vg_k1_pre_existing_notes_get_excerpt_populated` test
    /// but proves the folder_path column (Wave 2A) is also populated during rebuild.
    #[test]
    fn vg_k1_foldered_note_gets_folder_path_populated_on_rebuild() {
        use crate::index;
        use crate::index::schema;
        use rusqlite::OptionalExtension;

        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // 1. Perform a first init so the root + index + notes/ dir exist.
        let cfg = init(root).unwrap();
        let index_path = cfg.index_path();
        let notes_dir = cfg.notes_dir();

        // 2. Create a subfolder and place a note file inside it directly
        //    (simulates a note that existed before the version-gate rebuild).
        let subfolder = notes_dir.join("ProjectX");
        std::fs::create_dir_all(&subfolder).unwrap();

        let note_id = "01TESTFOLDER00000000000001";
        let note_body = "This note lives in ProjectX.";
        let note_path = subfolder.join(format!("{}--my-foldered-note.md", note_id));
        let note_content = format!(
            "---\nid: {}\ntype: note\ntitle: My Foldered Note\ncreated: 2026-01-01T00:00:00+00:00\nupdated: 2026-01-01T00:00:00+00:00\nstatus: active\ntags: []\nlinks: []\n---\n{}",
            note_id, note_body
        );
        std::fs::write(&note_path, &note_content).unwrap();

        // 3. Reset the version sentinel so init thinks the schema is stale
        //    (forcing a full rebuild on the next init call).
        {
            let conn = index::open(&index_path).unwrap();
            conn.execute("DELETE FROM schema_meta WHERE key = 'schema_version'", [])
                .unwrap();
        }

        // 4. Call init again — it must detect the stale sentinel and rebuild.
        init(root).unwrap();

        // 5. Open the index and verify the note's folder_path is "ProjectX" (not "").
        let conn = index::open(&index_path).unwrap();
        let folder_path: Option<String> = conn
            .query_row(
                "SELECT folder_path FROM notes WHERE id = ?1",
                rusqlite::params![note_id],
                |r| r.get(0),
            )
            .optional()
            .unwrap();

        assert!(
            folder_path.is_some(),
            "VG-K1-FOLDER: note must appear in index after version-gated rebuild"
        );
        let folder_path = folder_path.unwrap();
        assert_eq!(
            folder_path, "ProjectX",
            "VG-K1-FOLDER: folder_path must be 'ProjectX' (not '') after rebuild; got: {:?}",
            folder_path
        );

        // 6. Version sentinel must now be set.
        assert!(
            schema::is_current_version(&conn).unwrap(),
            "VG-K1-FOLDER: schema version sentinel must be set after version-gated rebuild"
        );
    }
}
