//! Google Calendar subsystem (S6.1 + S6.2).
//!
//! Sub-modules:
//! - `config`  — loads owner-provisioned OAuth client credentials
//! - `auth`    — PKCE + loopback redirect + token exchange/refresh
//! - `secrets` — token persistence (OS keyring primary; AEAD-encrypted file fallback)
//! - `client`  — injectable HTTP abstraction (GET/POST/PATCH/DELETE) + CalendarClient
//! - `mapping` — DEC-S4 field mapping: Google events resource ↔ Jin EventFrontmatter (VG5)
//! - `sync`    — BOOTSTRAP/INCREMENTAL/PUSH sync loop state machine (VG7)

pub mod account;
pub mod auth;
pub mod client;
pub mod config;
pub mod mapping;
pub mod migration;
pub mod multi_sync;
pub mod route_ownership;
pub mod secrets;
pub mod sync;
