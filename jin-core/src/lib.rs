pub mod config;
pub mod dto;
pub mod error;
pub mod google;
pub mod id;
pub(crate) mod index; // VG4: index internals are private to jin-core
pub mod model;
pub mod notification_center;
pub mod ops;
pub mod order;
pub mod recurrence;
pub mod reminders;
pub mod store;
pub mod sync;
pub mod time;

/// Shared test-infrastructure utilities (mutexes, env-var RAII guards).
/// Compiled only during `cargo test` — never included in production builds.
#[cfg(test)]
pub(crate) mod test_support;

pub use config::Config;
pub use error::{JinError, Result};
