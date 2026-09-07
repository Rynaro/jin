//! Command bridge — #[tauri::command] wrappers over jin-core public API.
//!
//! Architecture invariants enforced here (GUI-S0 / ADR-0003):
//!
//!   1. Every command is a THIN marshalling layer — no business logic.
//!   2. jin-gui never imports rusqlite (VG4 / VG-GUI-1).
//!   3. All data crosses the boundary as existing jin-core DTOs.
//!   4. Errors map to JinErrorDto using the exit-code taxonomy (§4.1).
//!
//! Each module exposes:
//!   • A `*_fn(root, ...)` function — directly callable from tests without
//!     the Tauri runtime (the headless-testable surface).
//!   • A `#[tauri::command] async fn *` wrapper that extracts AppState and
//!     delegates to the `*_fn`.

pub mod agenda;
pub mod assets;
pub mod attach;
pub mod auth;
mod blocking;
pub mod capture;
pub mod collections;
pub mod events;
pub mod export;
pub mod folders;
pub mod google_accounts;
pub mod link;
pub mod lists;
pub mod notes;
pub mod notification_center;
pub mod promote;
pub mod store_root;
pub mod sync_cmd;
pub mod tags;
pub mod tasks;
