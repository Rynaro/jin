//! ULID generation helpers.

use ulid::Ulid;

/// Generate a new ULID string.
pub fn new_ulid() -> String {
    Ulid::new().to_string()
}

/// Generate a new ULID string (alias).
pub fn generate() -> String {
    new_ulid()
}
