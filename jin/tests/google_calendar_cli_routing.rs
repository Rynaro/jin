use std::process::Command;

use jin_core::google::account::{DiscoveredCalendar, GoogleAccessRole, GOOGLE_ISSUER};
use jin_core::sync::state::{self, OutboxOperationKind, ScopedEventSyncEntry, SyncDestination};
use tempfile::TempDir;

fn jin_bin() -> &'static str {
    env!("CARGO_BIN_EXE_jin")
}

#[test]
fn legacy_cli_add_and_remove_use_the_scoped_mutation_service() {
    let root = TempDir::new().unwrap();
    assert!(Command::new(jin_bin())
        .args(["--root", root.path().to_str().unwrap(), "init"])
        .status()
        .unwrap()
        .success());
    let mut config = jin_core::Config::load(root.path()).unwrap();
    let account_id = config
        .google_registry
        .add_pending_account("Personal")
        .unwrap();
    config
        .google_registry
        .account_mut(&account_id)
        .unwrap()
        .bind_subject(GOOGLE_ISSUER, "personal-subject", None)
        .unwrap();
    config
        .google_registry
        .reconcile_calendars(
            &account_id,
            vec![DiscoveredCalendar {
                calendar_id: "primary".into(),
                name: "Personal".into(),
                primary: true,
                access_role: GoogleAccessRole::Owner,
            }],
        )
        .unwrap();
    config.google_sync_schema_version = Some(jin_core::config::GOOGLE_SYNC_SCHEMA_VERSION);
    config.write_google_v2_guard().unwrap();
    config.save().unwrap();

    let output = Command::new(jin_bin())
        .args([
            "--root",
            root.path().to_str().unwrap(),
            "--json",
            "event",
            "add",
            "--title",
            "CLI routed",
            "--start",
            "2026-08-28T09:00:00",
            "--end",
            "2026-08-28T10:00:00",
            "--account-id",
            account_id.as_str(),
            "--calendar-id",
            "primary",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let envelope: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let event_id = envelope["data"]["id"].as_str().unwrap().to_string();

    let config = jin_core::Config::load(root.path()).unwrap();
    let conn = state::open_sync_db(&config.sync_dir()).unwrap();
    let route = SyncDestination::google(account_id.as_str(), "primary");
    state::upsert_scoped_entry(
        &conn,
        &ScopedEventSyncEntry {
            destination: route.clone(),
            jin_id: event_id.clone(),
            recurrence_key: state::MASTER_RECURRENCE_KEY.into(),
            google_event_id: Some("remote-cli-event".into()),
            ical_uid: None,
            etag: Some("etag-cli".into()),
            google_updated: None,
            last_synced_at: None,
        },
    )
    .unwrap();
    let removed = Command::new(jin_bin())
        .args([
            "--root",
            root.path().to_str().unwrap(),
            "--json",
            "event",
            "rm",
            &event_id,
        ])
        .output()
        .unwrap();
    assert!(
        removed.status.success(),
        "{}",
        String::from_utf8_lossy(&removed.stderr)
    );

    let pending = state::list_route_outbox(&conn, &route, "pending").unwrap();
    assert!(pending
        .iter()
        .any(|item| item.operation == OutboxOperationKind::Insert));
    assert!(pending
        .iter()
        .any(|item| item.operation == OutboxOperationKind::Delete));
    assert!(pending.iter().all(|item| item.jin_id == event_id));
}
