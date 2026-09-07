//! jin-gui — Tauri 2.x app library.
//!
//! This is the library target used by both:
//!   1. `main.rs` → the runnable Tauri application.
//!   2. `tests/bridge.rs` → headless integration tests calling command functions
//!      directly without the Tauri runtime (VG-GUI-8).
//!
//! Architecture: jin-gui is a PURE CONSUMER of jin-core (ADR-0003 / VG4).
//! It imports jin-core's PUBLIC API only — never rusqlite, never the index module.

pub mod commands;
pub mod error;
pub mod notifications;
pub mod root_resolver;
pub mod scheduler;
pub mod state;

/// Build and run the Tauri application.
///
/// `root` — path to the jin root directory (the one containing `.jin/config.toml`).
/// The caller is responsible for calling `jin_core::ops::init(&root)` before `run()`
/// so the root is guaranteed to exist and be initialized.
pub fn run(root: std::path::PathBuf) {
    let notification_delegate = notifications::install_notification_center_delegate();
    match notification_delegate {
        notifications::NotificationDelegateInstallOutcome::PreservedExisting => eprintln!(
            "notification capability warning: preserving an existing macOS Notification Center delegate; notification requests remain enabled, but the existing delegate controls foreground presentation"
        ),
        notifications::NotificationDelegateInstallOutcome::SkippedOffMainThread => eprintln!(
            "notification capability error: macOS notification delegate installation was not on the main thread; notification requests remain enabled, but foreground presentation is unavailable"
        ),
        _ => {}
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::new(root))
        .setup(|app| {
            use tauri::Manager;

            let state = app.state::<state::AppState>();
            scheduler::spawn(
                app.handle().clone(),
                state.root.clone(),
                state.reminder_wake.clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Agenda (hero view — VG-GUI-2)
            commands::agenda::today_agenda,
            // Vault-managed content-addressed attachments
            commands::assets::import_attachment,
            commands::assets::list_attachments,
            commands::assets::repair_attachments,
            // Declarative Notes Collections
            commands::collections::list_collections,
            commands::collections::create_collection,
            commands::collections::rename_collection,
            commands::collections::update_collection_query,
            commands::collections::delete_collection,
            commands::collections::evaluate_collection,
            // Notes
            commands::notes::list_notes,
            commands::notes::get_note,
            commands::notes::search_notes,
            commands::notes::list_note_revisions,
            commands::notes::preview_note_revision,
            commands::notes::create_note,
            commands::notes::edit_note,
            commands::notes::set_note_properties,
            commands::notes::delete_note,
            commands::notes::move_note,
            commands::notes::restore_note_revision,
            // Folders (Wave 2A + folder-mgmt)
            commands::folders::list_folders,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::delete_folder,
            // Tasks
            commands::tasks::list_tasks,
            commands::tasks::get_task,
            commands::tasks::create_task,
            commands::tasks::edit_task,
            commands::tasks::set_task_status,
            commands::tasks::delete_task,
            // Tasks P9: drag/drop reorder
            commands::tasks::move_task,
            commands::tasks::reseed_positions,
            // Jin's durable Notification Center
            commands::notification_center::list_notification_items,
            commands::notification_center::get_notification_item,
            commands::notification_center::notification_center_summary,
            commands::notification_center::set_notification_read,
            commands::notification_center::defer_notification_item,
            commands::notification_center::dismiss_notification_item,
            commands::notification_center::respond_calendar_invitation,
            commands::notification_center::retry_calendar_invitation,
            commands::notification_center::complete_notification_task,
            // Lists (P3)
            commands::lists::list_lists,
            commands::lists::create_list,
            commands::lists::edit_list,
            commands::lists::reorder_list,
            commands::lists::delete_list,
            // Sections (P5)
            commands::lists::create_section,
            commands::lists::rename_section,
            commands::lists::reorder_section,
            commands::lists::delete_section,
            // Tags (P4)
            commands::tags::list_tags,
            commands::tags::set_tag_color,
            // Events
            commands::events::list_events,
            commands::events::get_event,
            commands::events::get_event_detail,
            commands::events::create_event,
            commands::events::delete_event,
            commands::events::edit_event,
            commands::events::remove_time_block,
            commands::events::create_routed_event,
            commands::events::preview_recurrence,
            commands::events::edit_routed_event,
            commands::events::delete_routed_event,
            // Linking / promotion
            commands::promote::promote_task,
            commands::attach::attach_note,
            commands::link::link,
            // Capture
            commands::capture::capture,
            // Sync / auth / export
            commands::sync_cmd::run_sync,
            commands::auth::auth_status,
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::google_accounts::list_google_accounts,
            commands::google_accounts::add_google_account,
            commands::google_accounts::connect_google_account,
            commands::google_accounts::rename_google_account,
            commands::google_accounts::disconnect_google_account,
            commands::google_accounts::refresh_google_calendars,
            commands::google_accounts::set_google_calendar_enabled,
            commands::google_accounts::list_quarantined_sync_operations,
            commands::google_accounts::review_quarantined_sync_operation,
            commands::export::export_files,
            commands::export::app_config,
            notifications::notification_status,
            notifications::request_notification_permission,
            notifications::open_notification_settings,
            notifications::send_test_notification,
            // Store root (P1 sovereignty — user controls store location)
            commands::store_root::set_store_root,
            commands::store_root::get_store_root,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
