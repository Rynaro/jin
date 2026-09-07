//! Private SQLite index — accessible only within jin-core (VG4).
//! External consumers use ops::api; no consumer may open index.sqlite directly.

pub(crate) mod query;
pub(crate) mod rebuild;
pub(crate) mod schema;

use rusqlite::Connection;
use std::path::Path;

use crate::{JinError, Result};

/// Open (or create) the index database at the given path.
/// Applies the schema on first open.
pub(crate) fn open(index_path: &Path) -> Result<Connection> {
    let conn = Connection::open(index_path).map_err(JinError::Index)?;
    schema::apply(&conn).map_err(JinError::Index)?;
    Ok(conn)
}
