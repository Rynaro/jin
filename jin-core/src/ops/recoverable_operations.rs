//! Recoverable multi-file Task/Event operations.
//!
//! Canonical Markdown remains authoritative. Complete before/post images and
//! hashes are durably staged before the first canonical replacement. Index
//! refresh and provider enqueue are journaled post-convergence effects so a
//! crash cannot make canonical success observable without replaying them.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::store::fs;
use crate::{JinError, Result};

const OPERATIONS_DIR: &str = "operations";
const LOCK_FILE: &str = "operations.lock";

// Journal path contract: the caller-provided vault root is the trust boundary.
// Every descendant journal directory is checked with lstat semantics before
// and after creation and again immediately around reads/writes. This rejects
// pre-existing and app-visible replacement symlinks on every platform. Without
// openat-style directory handles, a privileged actor racing directory swaps
// inside a single filesystem syscall remains outside Jin's threat model.

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryDecision {
    RollForward,
    RollBack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum OperationState {
    Staged,
    SideEffectsPending,
    #[serde(alias = "converged")]
    Completed,
    RolledBack,
    Blocked,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct OperationEffects {
    rebuild_index: bool,
    enqueue_event: bool,
}

impl OperationEffects {
    pub const fn event() -> Self {
        Self {
            rebuild_index: true,
            enqueue_event: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StagedImage {
    exists: bool,
    path: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StagedTarget {
    canonical_path: String,
    before: StagedImage,
    post: StagedImage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OperationRecord {
    operation_id: String,
    kind: String,
    state: OperationState,
    decision: RecoveryDecision,
    result_event_id: String,
    targets: Vec<StagedTarget>,
    conflict_path: Option<String>,
    #[serde(default)]
    effects: OperationEffects,
    #[serde(default)]
    index_done: bool,
    #[serde(default)]
    sync_done: bool,
}

#[derive(Debug, Clone)]
pub struct TargetPlan {
    pub canonical_path: PathBuf,
    pub before: Option<Vec<u8>>,
    pub post: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationOutcome {
    pub result_event_id: String,
    pub newly_converged: bool,
    /// Whether the semantic operation contains canonical targets. This remains
    /// true on an idempotent replay, unlike `newly_converged`.
    pub had_targets: bool,
    /// Staged Event post-image. Replays use this instead of later canonical state.
    pub result_event_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct OperationRecoveryReport {
    pub completed: usize,
    pub rolled_back: usize,
    pub blocked: usize,
    pub blocking_operation_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OperationFailpoint {
    FinalRenameBeforeConvergenceRecord,
    ConvergenceBeforeIndex,
    IndexBeforeSync,
}

struct OperationLock {
    _file: std::fs::File,
}

fn acquire_lock(root: &Path) -> Result<OperationLock> {
    acquire_lock_with_mode(root, false)
}

fn acquire_lock_for_read(root: &Path) -> Result<OperationLock> {
    acquire_lock_with_mode(root, true)
}

fn acquire_lock_with_mode(root: &Path, wait: bool) -> Result<OperationLock> {
    ensure_jin_dir(root)?;
    let path = root.join(".jin").join(LOCK_FILE);
    if matches!(std::fs::symlink_metadata(&path), Ok(metadata) if metadata.file_type().is_symlink())
    {
        return Err(JinError::Integrity(format!(
            "operation lock is a symlink: {}",
            path.display()
        )));
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(JinError::Io)?;
    if wait {
        // Startup controllers issue independent reads concurrently. Reads must
        // wait for the current recovery/mutation boundary, then re-run recovery,
        // rather than exposing transient lock contention as invalid user input.
        file.lock().map_err(JinError::Io)?;
    } else {
        file.try_lock().map_err(|_| {
            JinError::InvalidInput("another canonical operation is in progress".to_string())
        })?;
    }
    file.set_len(0)?;
    writeln!(file, "{}", std::process::id())?;
    file.sync_all()?;
    ensure_jin_dir(root)?;
    Ok(OperationLock { _file: file })
}

pub fn validate_operation_id(operation_id: &str) -> Result<()> {
    if operation_id.is_empty()
        || !operation_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(JinError::Validation {
            field: "operation_id".to_string(),
            reason: "required; may contain only ASCII letters, digits, '-' or '_'".to_string(),
        });
    }
    Ok(())
}

fn real_directory(path: &Path) -> Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(JinError::Integrity(format!(
            "operation journal directory is a symlink: {}",
            path.display()
        ))),
        Ok(metadata) if !metadata.is_dir() => Err(JinError::Integrity(format!(
            "operation journal path is not a directory: {}",
            path.display()
        ))),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(JinError::Io(error)),
    }
}

fn ensure_real_directory(path: &Path) -> Result<()> {
    if !real_directory(path)? {
        std::fs::create_dir(path)?;
    }
    if !real_directory(path)? {
        return Err(JinError::Integrity(format!(
            "operation journal directory disappeared after creation: {}",
            path.display()
        )));
    }
    Ok(())
}

fn ensure_jin_dir(root: &Path) -> Result<PathBuf> {
    let path = root.join(".jin");
    ensure_real_directory(&path)?;
    Ok(path)
}

fn ensure_operations_dir(root: &Path, create: bool) -> Result<Option<PathBuf>> {
    let jin = ensure_jin_dir(root)?;
    let path = jin.join(OPERATIONS_DIR);
    if create {
        ensure_real_directory(&path)?;
        ensure_jin_dir(root)?;
        return Ok(Some(path));
    }
    if !real_directory(&path)? {
        return Ok(None);
    }
    ensure_jin_dir(root)?;
    Ok(Some(path))
}

fn ensure_operation_dir(root: &Path, operation_id: &str, create: bool) -> Result<Option<PathBuf>> {
    validate_operation_id(operation_id)?;
    let Some(operations) = ensure_operations_dir(root, create)? else {
        return Ok(None);
    };
    let path = operations.join(operation_id);
    if create {
        ensure_real_directory(&path)?;
        ensure_operations_dir(root, false)?;
        return Ok(Some(path));
    }
    if !real_directory(&path)? {
        return Ok(None);
    }
    ensure_operations_dir(root, false)?;
    Ok(Some(path))
}

fn confined_relative(root: &Path, value: &str) -> Result<PathBuf> {
    let relative = Path::new(value);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(JinError::Integrity(format!(
            "operation path escaped vault: {value}"
        )));
    }
    let mut cursor = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            unreachable!()
        };
        cursor.push(part);
        if cursor.exists() && std::fs::symlink_metadata(&cursor)?.file_type().is_symlink() {
            return Err(JinError::Integrity(format!(
                "operation path traverses a symlink: {value}"
            )));
        }
    }
    Ok(cursor)
}

fn record_path(root: &Path, operation_id: &str) -> Result<Option<PathBuf>> {
    Ok(ensure_operation_dir(root, operation_id, false)?
        .map(|directory| directory.join("operation.json")))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn relative(root: &Path, path: &Path) -> Result<String> {
    let value = path.strip_prefix(root).map_err(|_| {
        JinError::Integrity(format!("operation path escaped vault: {}", path.display()))
    })?;
    let value = value.to_string_lossy().replace('\\', "/");
    confined_relative(root, &value)?;
    Ok(value)
}

fn persist_record(root: &Path, record: &OperationRecord) -> Result<()> {
    validate_operation_id(&record.operation_id)?;
    persist_record_for_id(root, &record.operation_id, record)
}

fn persist_record_for_id(root: &Path, operation_id: &str, record: &OperationRecord) -> Result<()> {
    validate_operation_id(operation_id)?;
    let directory = ensure_operation_dir(root, operation_id, false)?.ok_or_else(|| {
        JinError::Integrity(format!("operation directory is missing: {operation_id}"))
    })?;
    let bytes = serde_json::to_vec_pretty(record)
        .map_err(|err| JinError::Integrity(format!("serialize operation record: {err}")))?;
    let path = directory.join("operation.json");
    if matches!(std::fs::symlink_metadata(&path), Ok(metadata) if metadata.file_type().is_symlink())
    {
        return Err(JinError::Integrity(format!(
            "operation record is a symlink: {}",
            path.display()
        )));
    }
    fs::atomic_write(&path, &bytes)?;
    ensure_operation_dir(root, operation_id, false)?;
    Ok(())
}

fn load_record(root: &Path, operation_id: &str) -> Result<Option<OperationRecord>> {
    validate_operation_id(operation_id)?;
    let Some(path) = record_path(root, operation_id)? else {
        return Ok(None);
    };
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(JinError::Integrity(format!(
                "operation record is a symlink: {}",
                path.display()
            )))
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err(JinError::Integrity(format!(
                "operation record is not a file: {}",
                path.display()
            )))
        }
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(JinError::Io(error)),
    };
    let bytes = std::fs::read(&path)?;
    let after = std::fs::symlink_metadata(&path)?;
    if after.file_type().is_symlink() || !after.is_file() || after.len() != metadata.len() {
        return Err(JinError::Integrity(format!(
            "operation record changed during read: {}",
            path.display()
        )));
    }
    let mut record: OperationRecord = serde_json::from_slice(&bytes)
        .map_err(|err| JinError::Integrity(format!("parse operation record: {err}")))?;
    if validate_operation_id(&record.operation_id).is_err() || record.operation_id != operation_id {
        let found = record.operation_id.clone();
        record.operation_id = operation_id.to_string();
        record.state = OperationState::Blocked;
        record.conflict_path = Some(format!(
            "operation record id mismatch: expected {operation_id}, found {found}"
        ));
        persist_record_for_id(root, operation_id, &record)?;
    }
    ensure_operation_dir(root, operation_id, false)?;
    Ok(Some(record))
}

fn staged_image(
    root: &Path,
    operation_id: &str,
    index: usize,
    label: &str,
    bytes: Option<&[u8]>,
) -> Result<StagedImage> {
    let directory = ensure_operation_dir(root, operation_id, false)?.ok_or_else(|| {
        JinError::Integrity(format!("operation directory is missing: {operation_id}"))
    })?;
    let path = directory.join(format!("{index}.{label}"));
    let content = bytes.unwrap_or_default();
    fs::atomic_write(&path, content)?;
    ensure_operation_dir(root, operation_id, false)?;
    Ok(StagedImage {
        exists: bytes.is_some(),
        path: relative(root, &path)?,
        sha256: sha256(content),
    })
}

fn stage_operation(
    root: &Path,
    operation_id: &str,
    kind: &str,
    result_event_id: &str,
    decision: RecoveryDecision,
    effects: OperationEffects,
    plans: Vec<TargetPlan>,
) -> Result<OperationRecord> {
    validate_operation_id(operation_id)?;
    ensure_operation_dir(root, operation_id, true)?;
    let mut targets = Vec::with_capacity(plans.len());
    for (index, plan) in plans.into_iter().enumerate() {
        targets.push(StagedTarget {
            canonical_path: relative(root, &plan.canonical_path)?,
            before: staged_image(root, operation_id, index, "before", plan.before.as_deref())?,
            post: staged_image(root, operation_id, index, "post", plan.post.as_deref())?,
        });
    }
    let record = OperationRecord {
        operation_id: operation_id.to_string(),
        kind: kind.to_string(),
        state: OperationState::Staged,
        decision,
        result_event_id: result_event_id.to_string(),
        targets,
        conflict_path: None,
        effects,
        index_done: false,
        sync_done: false,
    };
    // This durable record is written only after every complete image exists,
    // and before recovery performs the first canonical replacement.
    persist_record(root, &record)?;
    Ok(record)
}

fn image_matches(image: &StagedImage, canonical: &Path) -> Result<bool> {
    if !canonical.exists() {
        return Ok(!image.exists);
    }
    if !image.exists {
        return Ok(false);
    }
    Ok(sha256(&std::fs::read(canonical)?) == image.sha256)
}

fn verified_image_bytes(root: &Path, image: &StagedImage) -> Result<Vec<u8>> {
    let path = confined_relative(root, &image.path)?;
    let metadata = std::fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(JinError::Integrity(format!(
            "staged image is not a regular file: {}",
            image.path
        )));
    }
    let bytes = std::fs::read(&path)?;
    let after_path = confined_relative(root, &image.path)?;
    let after = std::fs::symlink_metadata(after_path)?;
    if after.file_type().is_symlink() || !after.is_file() || after.len() != metadata.len() {
        return Err(JinError::Integrity(format!(
            "staged image changed during read: {}",
            image.path
        )));
    }
    if sha256(&bytes) != image.sha256 {
        return Err(JinError::Integrity(format!(
            "staged image hash mismatch: {}",
            image.path
        )));
    }
    Ok(bytes)
}

fn validate_record(root: &Path, record: &OperationRecord) -> Result<()> {
    validate_operation_id(&record.operation_id)?;
    for (index, target) in record.targets.iter().enumerate() {
        confined_relative(root, &target.canonical_path)?;
        let expected_before = format!(
            ".jin/{OPERATIONS_DIR}/{}/{index}.before",
            record.operation_id
        );
        let expected_post = format!(".jin/{OPERATIONS_DIR}/{}/{index}.post", record.operation_id);
        if target.before.path != expected_before || target.post.path != expected_post {
            return Err(JinError::Integrity(format!(
                "operation image path mismatch for target {index}"
            )));
        }
        verified_image_bytes(root, &target.before)?;
        verified_image_bytes(root, &target.post)?;
    }
    Ok(())
}

fn apply_image(root: &Path, image: &StagedImage, canonical: &Path) -> Result<()> {
    if image.exists {
        fs::atomic_write(canonical, &verified_image_bytes(root, image)?)
    } else if canonical.exists() {
        std::fs::remove_file(canonical).map_err(JinError::Io)
    } else {
        Ok(())
    }
}

fn block_record(root: &Path, record: &mut OperationRecord, reason: String) -> Result<()> {
    record.state = OperationState::Blocked;
    record.conflict_path = Some(reason);
    persist_record(root, record)
}

fn recover_record(
    root: &Path,
    mut record: OperationRecord,
    failpoint: Option<OperationFailpoint>,
) -> Result<OperationRecord> {
    if record.state == OperationState::Blocked
        || record.state == OperationState::Completed
        || record.state == OperationState::RolledBack
    {
        return Ok(record);
    }

    if let Err(error) = validate_record(root, &record) {
        block_record(root, &mut record, error.to_string())?;
        return Ok(record);
    }

    if record.state == OperationState::Staged {
        for target in &record.targets {
            let canonical = confined_relative(root, &target.canonical_path)?;
            let before = image_matches(&target.before, &canonical)?;
            let post = image_matches(&target.post, &canonical)?;
            if !before && !post {
                let conflict_path = target.canonical_path.clone();
                block_record(root, &mut record, conflict_path)?;
                return Ok(record);
            }
        }
        for target in &record.targets {
            let canonical = confined_relative(root, &target.canonical_path)?;
            let image = match record.decision {
                RecoveryDecision::RollForward => &target.post,
                RecoveryDecision::RollBack => &target.before,
            };
            if !image_matches(image, &canonical)? {
                apply_image(root, image, &canonical)?;
            }
        }
        if failpoint == Some(OperationFailpoint::FinalRenameBeforeConvergenceRecord) {
            return Err(JinError::Integrity(
                "injected crash after final canonical rename".to_string(),
            ));
        }
        if record.decision == RecoveryDecision::RollBack {
            record.state = OperationState::RolledBack;
            persist_record(root, &record)?;
            return Ok(record);
        }
        record.state = if record.effects.rebuild_index || record.effects.enqueue_event {
            OperationState::SideEffectsPending
        } else {
            OperationState::Completed
        };
        persist_record(root, &record)?;
        if failpoint == Some(OperationFailpoint::ConvergenceBeforeIndex) {
            return Err(JinError::Integrity(
                "injected crash after canonical convergence".to_string(),
            ));
        }
    }

    if record.state == OperationState::SideEffectsPending {
        if record.effects.rebuild_index && !record.index_done {
            let cfg = crate::Config::load(root)?;
            let mut conn = crate::index::open(&cfg.index_path())?;
            crate::index::rebuild::rebuild(&mut conn, root)?;
            record.index_done = true;
            persist_record(root, &record)?;
            if failpoint == Some(OperationFailpoint::IndexBeforeSync) {
                return Err(JinError::Integrity(
                    "injected crash after index refresh".to_string(),
                ));
            }
        }
        if record.effects.enqueue_event && !record.sync_done {
            let cfg = crate::Config::load(root)?;
            let conn = crate::sync::state::open_sync_db(&cfg.sync_dir())?;
            crate::sync::state::enqueue_dirty(&conn, &record.result_event_id)?;
            record.sync_done = true;
            persist_record(root, &record)?;
        }
        record.state = OperationState::Completed;
        persist_record(root, &record)?;
    }
    Ok(record)
}

fn recover_locked(root: &Path) -> Result<OperationRecoveryReport> {
    let mut report = OperationRecoveryReport::default();
    let Some(dir) = ensure_operations_dir(root, false)? else {
        return Ok(report);
    };
    let mut records = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let operation_id = entry.file_name().to_string_lossy().to_string();
        let Some(record) = load_record(root, &operation_id)? else {
            continue;
        };
        if record.state == OperationState::Blocked {
            report.blocked += 1;
            if report
                .blocking_operation_id
                .as_ref()
                .is_none_or(|current| record.operation_id < *current)
            {
                report.blocking_operation_id = Some(record.operation_id.clone());
            }
        }
        records.push(record);
    }
    // Persisted conflicts are a vault-wide fail-closed gate. Do not replay any
    // other pending index or sync effect while one remains unresolved.
    if report.blocked > 0 {
        return Ok(report);
    }
    for record in records {
        let prior_state = record.state.clone();
        let recovered = recover_record(root, record, None)?;
        match recovered.state {
            OperationState::Completed if prior_state != OperationState::Completed => {
                report.completed += 1
            }
            OperationState::Completed => {}
            OperationState::RolledBack => report.rolled_back += 1,
            OperationState::Blocked => {
                report.blocked += 1;
                report.blocking_operation_id = Some(recovered.operation_id);
                break;
            }
            OperationState::Staged | OperationState::SideEffectsPending => {}
        }
    }
    Ok(report)
}

pub fn recover_incomplete_operations(root: &Path) -> Result<OperationRecoveryReport> {
    let _lock = acquire_lock(root)?;
    recover_locked(root)
}

/// Recover before an application read. Unlike a new compound mutation, a read
/// waits for the current exclusive operation boundary and then observes the
/// converged state. Persisted blocked records still fail closed in the caller.
pub(crate) fn recover_incomplete_operations_for_read(
    root: &Path,
) -> Result<OperationRecoveryReport> {
    let _lock = acquire_lock_for_read(root)?;
    recover_locked(root)
}

/// Run a canonical read while holding the same vault boundary used by Event
/// mutations. This provides a coherent Event/detail/token snapshot.
pub(crate) fn with_canonical_read_lock<T, F>(
    root: &Path,
    rebuild_before_read: bool,
    read: F,
) -> Result<T>
where
    F: FnOnce() -> Result<T>,
{
    let _lock = acquire_lock_for_read(root)?;
    let operations = recover_locked(root)?;
    if operations.blocked > 0 {
        return Err(JinError::OperationBlocked {
            operation_id: operations
                .blocking_operation_id
                .unwrap_or_else(|| "unknown".to_string()),
            reason: "canonical recovery is blocked by divergent content".to_string(),
        });
    }
    if rebuild_before_read || operations.rolled_back > 0 {
        let cfg = crate::Config::load(root)?;
        let mut conn = crate::index::open(&cfg.index_path())?;
        crate::index::rebuild::rebuild(&mut conn, root)?;
    }
    read()
}

#[cfg(test)]
pub(crate) fn stage_test_operation(
    root: &Path,
    operation_id: &str,
    result_event_id: &str,
    plans: Vec<TargetPlan>,
) -> Result<()> {
    let _lock = acquire_lock(root)?;
    stage_operation(
        root,
        operation_id,
        "failure_injection",
        result_event_id,
        RecoveryDecision::RollForward,
        OperationEffects {
            rebuild_index: true,
            enqueue_event: false,
        },
        plans,
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn stage_test_event_operation(
    root: &Path,
    operation_id: &str,
    result_event_id: &str,
    plans: Vec<TargetPlan>,
) -> Result<()> {
    let _lock = acquire_lock(root)?;
    stage_operation(
        root,
        operation_id,
        "edit_event",
        result_event_id,
        RecoveryDecision::RollForward,
        OperationEffects::event(),
        plans,
    )?;
    Ok(())
}

/// Execute one idempotent recoverable operation. Preconditions and complete
/// target plans are built while the per-vault operation lock is held.
pub fn execute_operation<F>(
    root: &Path,
    operation_id: &str,
    kind: &str,
    build: F,
) -> Result<OperationOutcome>
where
    F: FnOnce() -> Result<(String, Vec<TargetPlan>)>,
{
    execute_operation_inner(
        root,
        operation_id,
        kind,
        OperationEffects::default(),
        false,
        None,
        build,
    )
}

pub fn execute_event_operation<F>(
    root: &Path,
    operation_id: &str,
    kind: &str,
    build: F,
) -> Result<OperationOutcome>
where
    F: FnOnce() -> Result<(String, Vec<TargetPlan>)>,
{
    execute_operation_inner(
        root,
        operation_id,
        kind,
        OperationEffects::event(),
        false,
        None,
        build,
    )
}

/// Event mutation variant whose validated empty target set is a semantic no-op.
pub fn execute_event_operation_allow_noop<F>(
    root: &Path,
    operation_id: &str,
    kind: &str,
    build: F,
) -> Result<OperationOutcome>
where
    F: FnOnce() -> Result<(String, Vec<TargetPlan>)>,
{
    execute_operation_inner(
        root,
        operation_id,
        kind,
        OperationEffects::event(),
        true,
        None,
        build,
    )
}

pub(crate) fn execute_event_operation_with_failpoint<F>(
    root: &Path,
    operation_id: &str,
    kind: &str,
    failpoint: OperationFailpoint,
    build: F,
) -> Result<OperationOutcome>
where
    F: FnOnce() -> Result<(String, Vec<TargetPlan>)>,
{
    execute_operation_inner(
        root,
        operation_id,
        kind,
        OperationEffects::event(),
        false,
        Some(failpoint),
        build,
    )
}

fn execute_operation_inner<F>(
    root: &Path,
    operation_id: &str,
    kind: &str,
    effects: OperationEffects,
    empty_is_noop: bool,
    failpoint: Option<OperationFailpoint>,
    build: F,
) -> Result<OperationOutcome>
where
    F: FnOnce() -> Result<(String, Vec<TargetPlan>)>,
{
    validate_operation_id(operation_id)?;
    let _lock = acquire_lock(root)?;
    let recovered = recover_locked(root)?;
    if recovered.blocked > 0 {
        return Err(JinError::OperationBlocked {
            operation_id: recovered
                .blocking_operation_id
                .unwrap_or_else(|| "unknown".to_string()),
            reason: "divergent canonical content requires repair".to_string(),
        });
    }
    if let Some(record) = load_record(root, operation_id)? {
        if record.kind != kind {
            return Err(JinError::OperationConflict {
                operation_id: operation_id.to_string(),
                reason: format!("already belongs to operation kind {}", record.kind),
            });
        }
        return match record.state {
            OperationState::Completed => Ok(OperationOutcome {
                result_event_bytes: result_event_bytes(root, &record)?,
                result_event_id: record.result_event_id,
                newly_converged: false,
                had_targets: !record.targets.is_empty(),
            }),
            OperationState::Blocked => Err(JinError::OperationBlocked {
                operation_id: operation_id.to_string(),
                reason: format!(
                    "divergent canonical content at {}",
                    record
                        .conflict_path
                        .unwrap_or_else(|| "unknown target".to_string())
                ),
            }),
            OperationState::RolledBack => Err(JinError::Integrity(format!(
                "operation {operation_id} was rolled back; resolve it before retry"
            ))),
            OperationState::Staged | OperationState::SideEffectsPending => {
                Err(JinError::Integrity(format!(
                    "operation {operation_id} did not reach a terminal recovery state"
                )))
            }
        };
    }
    let (result_event_id, plans) = build()?;
    // A validated semantic no-op must not create a journal entry or trigger
    // derived effects. The caller has still benefited from recovery, policy,
    // and optimistic-token checks under this lock.
    if empty_is_noop && plans.is_empty() {
        return Ok(OperationOutcome {
            result_event_id,
            newly_converged: false,
            had_targets: false,
            result_event_bytes: None,
        });
    }
    let record = stage_operation(
        root,
        operation_id,
        kind,
        &result_event_id,
        RecoveryDecision::RollForward,
        effects,
        plans,
    )?;
    let record = recover_record(root, record, failpoint)?;
    match record.state {
        OperationState::Completed => Ok(OperationOutcome {
            result_event_bytes: result_event_bytes(root, &record)?,
            result_event_id: record.result_event_id,
            newly_converged: true,
            had_targets: !record.targets.is_empty(),
        }),
        OperationState::Blocked => Err(JinError::OperationBlocked {
            operation_id: operation_id.to_string(),
            reason: "blocked before convergence".to_string(),
        }),
        OperationState::Staged
        | OperationState::SideEffectsPending
        | OperationState::RolledBack => Err(JinError::Integrity(format!(
            "operation {operation_id} did not converge"
        ))),
    }
}

fn result_event_bytes(root: &Path, record: &OperationRecord) -> Result<Option<Vec<u8>>> {
    let suffix = format!("events/{}.md", record.result_event_id);
    record
        .targets
        .iter()
        .find(|target| target.canonical_path.ends_with(&suffix))
        .map(|target| verified_image_bytes(root, &target.post))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> TempDir {
        let vault = TempDir::new().unwrap();
        crate::ops::init(vault.path()).unwrap();
        vault
    }

    #[test]
    fn operation_id_idempotent() {
        let vault = setup();
        let target = vault.path().join("tasks/idempotent.md");
        let first = execute_operation(vault.path(), "same-id", "test", || {
            Ok((
                "event-1".to_string(),
                vec![TargetPlan {
                    canonical_path: target.clone(),
                    before: None,
                    post: Some(b"post".to_vec()),
                }],
            ))
        })
        .unwrap();
        let second = execute_operation(vault.path(), "same-id", "test", || {
            panic!("completed operation must not rebuild targets")
        })
        .unwrap();
        assert!(first.newly_converged);
        assert!(!second.newly_converged);
        assert_eq!(second.result_event_id, "event-1");
        assert_eq!(std::fs::read(target).unwrap(), b"post");
    }

    #[test]
    fn cross_kind_operation_id_reuse_is_a_typed_conflict() {
        let vault = setup();
        execute_operation(vault.path(), "shared-id", "create_time_block", || {
            Ok(("event-1".to_string(), Vec::new()))
        })
        .unwrap();

        let error = execute_operation(vault.path(), "shared-id", "remove_time_block", || {
            panic!("cross-kind reuse must fail before rebuilding targets")
        })
        .unwrap_err();
        assert!(matches!(
            error,
            JinError::OperationConflict {
                ref operation_id,
                ..
            } if operation_id == "shared-id"
        ));
    }

    #[test]
    fn invalid_operation_id_has_typed_validation_metadata() {
        assert!(matches!(
            validate_operation_id("../escape"),
            Err(JinError::Validation { ref field, .. }) if field == "operation_id"
        ));
    }

    #[test]
    fn stages_under_lock_before_write() {
        let vault = setup();
        let target = vault.path().join("tasks/staged.md");
        execute_operation(vault.path(), "staged-id", "test", || {
            assert!(vault.path().join(".jin/operations.lock").exists());
            assert!(!target.exists());
            Ok((
                "event-1".to_string(),
                vec![TargetPlan {
                    canonical_path: target.clone(),
                    before: None,
                    post: Some(b"post bytes".to_vec()),
                }],
            ))
        })
        .unwrap();
        let record = load_record(vault.path(), "staged-id").unwrap().unwrap();
        assert_eq!(record.targets.len(), 1);
        assert!(vault.path().join(&record.targets[0].before.path).exists());
        assert!(vault.path().join(&record.targets[0].post.path).exists());
    }

    #[test]
    fn known_hash_recovery_matrix() {
        let vault = setup();
        let target = vault.path().join("tasks/matrix.md");
        fs::atomic_write(&target, b"before").unwrap();
        let record = stage_operation(
            vault.path(),
            "matrix-forward",
            "test",
            "event-1",
            RecoveryDecision::RollForward,
            OperationEffects::default(),
            vec![TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        recover_record(vault.path(), record, None).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"post");

        let record = stage_operation(
            vault.path(),
            "matrix-back",
            "test",
            "event-1",
            RecoveryDecision::RollBack,
            OperationEffects::default(),
            vec![TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        recover_record(vault.path(), record, None).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"before");
    }

    #[test]
    fn divergent_hash_blocks() {
        let vault = setup();
        let target = vault.path().join("tasks/conflict.md");
        fs::atomic_write(&target, b"before").unwrap();
        let record = stage_operation(
            vault.path(),
            "blocked-id",
            "test",
            "event-1",
            RecoveryDecision::RollForward,
            OperationEffects::default(),
            vec![TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        fs::atomic_write(&target, b"newer external bytes").unwrap();
        let recovered = recover_record(vault.path(), record, None).unwrap();
        assert_eq!(recovered.state, OperationState::Blocked);
        assert_eq!(std::fs::read(target).unwrap(), b"newer external bytes");
    }

    #[test]
    fn recover_before_read() {
        let vault = setup();
        let tasks_dir = vault.path().join("tasks");
        let task = crate::ops::tasks::create_task(
            &tasks_dir,
            crate::ops::tasks::CreateTaskParams {
                title: "Before".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        crate::ops::api::refresh(vault.path()).unwrap();
        let target = fs::find_task_path(&tasks_dir, task.id()).unwrap();
        let before = std::fs::read(&target).unwrap();
        let mut post_task = task.clone();
        post_task.frontmatter.title = "After recovery".to_string();
        let post = crate::store::frontmatter::render(&post_task.frontmatter, &post_task.body)
            .unwrap()
            .into_bytes();
        stage_operation(
            vault.path(),
            "read-recovery",
            "test",
            "event-1",
            RecoveryDecision::RollForward,
            OperationEffects {
                rebuild_index: true,
                enqueue_event: false,
            },
            vec![TargetPlan {
                canonical_path: target,
                before: Some(before),
                post: Some(post),
            }],
        )
        .unwrap();

        let dto = crate::ops::api::get_task(vault.path(), task.id()).unwrap();
        assert_eq!(dto.title, "After recovery");
    }

    #[test]
    fn concurrent_read_waits_for_operation_lock_then_observes_canonical_state() {
        use std::sync::mpsc;
        use std::time::Duration;

        let vault = setup();
        let operation = acquire_lock(vault.path()).unwrap();
        let root = vault.path().to_path_buf();
        let (started_tx, started_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            result_tx
                .send(crate::ops::api::list_events(&root, false))
                .unwrap();
        });

        started_rx.recv().unwrap();
        assert!(matches!(
            result_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        drop(operation);

        assert!(result_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .is_ok());
        reader.join().unwrap();
    }

    #[test]
    fn concurrent_compound_mutation_remains_fail_fast() {
        let vault = setup();
        let operation = acquire_lock(vault.path()).unwrap();

        let error = execute_operation(vault.path(), "contending-write", "test", || {
            panic!("a contending mutation must not build canonical targets")
        })
        .unwrap_err();

        assert!(matches!(
            error,
            JinError::InvalidInput(ref message)
                if message == "another canonical operation is in progress"
        ));
        drop(operation);
    }

    #[test]
    fn tampered_before_and_post_images_block_without_canonical_write() {
        for label in ["before", "post"] {
            let vault = setup();
            let target = vault.path().join(format!("tasks/tampered-{label}.md"));
            fs::atomic_write(&target, b"before").unwrap();
            stage_test_operation(
                vault.path(),
                &format!("tampered-{label}"),
                "event-1",
                vec![TargetPlan {
                    canonical_path: target.clone(),
                    before: Some(b"before".to_vec()),
                    post: Some(b"post".to_vec()),
                }],
            )
            .unwrap();
            let record = load_record(vault.path(), &format!("tampered-{label}"))
                .unwrap()
                .unwrap();
            let image = if label == "before" {
                &record.targets[0].before
            } else {
                &record.targets[0].post
            };
            fs::atomic_write(&vault.path().join(&image.path), b"tampered").unwrap();

            let report = recover_incomplete_operations(vault.path()).unwrap();
            assert_eq!(report.blocked, 1);
            assert_eq!(std::fs::read(&target).unwrap(), b"before");
        }
    }

    #[test]
    fn traversal_and_operation_id_tampering_persist_blocked() {
        let vault = setup();
        let target = vault.path().join("tasks/safe.md");
        fs::atomic_write(&target, b"before").unwrap();
        stage_test_operation(
            vault.path(),
            "traversal-id",
            "event-1",
            vec![TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        let outside_name = format!("jin-outside-{}.md", crate::id::new_ulid());
        let outside = vault.path().parent().unwrap().join(&outside_name);
        fs::atomic_write(&outside, b"external").unwrap();
        let mut record = load_record(vault.path(), "traversal-id").unwrap().unwrap();
        record.targets[0].canonical_path = format!("../{outside_name}");
        persist_record(vault.path(), &record).unwrap();

        let report = recover_incomplete_operations(vault.path()).unwrap();
        assert_eq!(report.blocked, 1);
        assert_eq!(std::fs::read(&target).unwrap(), b"before");
        assert_eq!(std::fs::read(&outside).unwrap(), b"external");
        std::fs::remove_file(outside).unwrap();

        let vault = setup();
        let target = vault.path().join("tasks/id-safe.md");
        fs::atomic_write(&target, b"before").unwrap();
        stage_test_operation(
            vault.path(),
            "record-id",
            "event-1",
            vec![TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        let mut record = load_record(vault.path(), "record-id").unwrap().unwrap();
        record.operation_id = "../forged".to_string();
        persist_record_for_id(vault.path(), "record-id", &record).unwrap();
        let report = recover_incomplete_operations(vault.path()).unwrap();
        assert_eq!(report.blocked, 1);
        assert_eq!(std::fs::read(target).unwrap(), b"before");

        let vault = setup();
        let target = vault.path().join("tasks/image-safe.md");
        fs::atomic_write(&target, b"before").unwrap();
        stage_test_operation(
            vault.path(),
            "image-path",
            "event-1",
            vec![TargetPlan {
                canonical_path: target.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        let outside_name = format!("jin-image-{}.md", crate::id::new_ulid());
        let outside = vault.path().parent().unwrap().join(&outside_name);
        fs::atomic_write(&outside, b"external image").unwrap();
        let mut record = load_record(vault.path(), "image-path").unwrap().unwrap();
        record.targets[0].post.path = format!("../{outside_name}");
        persist_record(vault.path(), &record).unwrap();
        let report = recover_incomplete_operations(vault.path()).unwrap();
        assert_eq!(report.blocked, 1);
        assert_eq!(std::fs::read(target).unwrap(), b"before");
        assert_eq!(std::fs::read(&outside).unwrap(), b"external image");
        std::fs::remove_file(outside).unwrap();
    }

    #[test]
    fn blocked_records_fail_closed_on_repeated_reads_and_unrelated_operations() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let vault = setup();
        let events_dir = vault.path().join("events");
        let event = crate::ops::events::create_event(
            &events_dir,
            crate::ops::events::CreateEventParams {
                title: "Indexed title".to_string(),
                body: String::new(),
                start: crate::model::TemporalValue::DateTime(
                    chrono::NaiveDateTime::parse_from_str(
                        "2026-08-26T09:00:00",
                        "%Y-%m-%dT%H:%M:%S",
                    )
                    .unwrap(),
                ),
                end: crate::model::TemporalValue::DateTime(
                    chrono::NaiveDateTime::parse_from_str(
                        "2026-08-26T10:00:00",
                        "%Y-%m-%dT%H:%M:%S",
                    )
                    .unwrap(),
                ),
                start_value_type: crate::model::ValueType::DateTime,
                end_value_type: crate::model::ValueType::DateTime,
                is_all_day: false,
                start_tzid: None,
                end_tzid: None,
                floating: true,
                ical_uid: None,
                description: None,
                location: None,
                attendees: None,
                conference_data: None,
                reminders: None,
            },
        )
        .unwrap();
        crate::ops::api::refresh(vault.path()).unwrap();

        let event_path = fs::find_event_path(&events_dir, event.id()).unwrap();
        let event_before = std::fs::read(&event_path).unwrap();
        let mut event_post = event.clone();
        event_post.frontmatter.title = "Pending title".to_string();
        let event_post =
            crate::store::frontmatter::render(&event_post.frontmatter, &event_post.body)
                .unwrap()
                .into_bytes();
        assert!(execute_event_operation_with_failpoint(
            vault.path(),
            "pending-effects",
            "test",
            OperationFailpoint::ConvergenceBeforeIndex,
            || {
                Ok((
                    event.id().to_string(),
                    vec![TargetPlan {
                        canonical_path: event_path,
                        before: Some(event_before),
                        post: Some(event_post),
                    }],
                ))
            },
        )
        .is_err());

        let conflict = vault.path().join("tasks/conflict.md");
        fs::atomic_write(&conflict, b"before").unwrap();
        stage_test_operation(
            vault.path(),
            "durable-blocked",
            event.id(),
            vec![TargetPlan {
                canonical_path: conflict.clone(),
                before: Some(b"before".to_vec()),
                post: Some(b"post".to_vec()),
            }],
        )
        .unwrap();
        fs::atomic_write(&conflict, b"external").unwrap();
        let mut blocked = load_record(vault.path(), "durable-blocked")
            .unwrap()
            .unwrap();
        blocked.state = OperationState::Blocked;
        blocked.conflict_path = Some("tasks/conflict.md".to_string());
        persist_record(vault.path(), &blocked).unwrap();

        assert_eq!(
            recover_incomplete_operations(vault.path()).unwrap().blocked,
            1
        );
        assert_eq!(
            recover_incomplete_operations(vault.path()).unwrap().blocked,
            1
        );
        assert!(matches!(
            crate::ops::api::get_event(vault.path(), event.id()),
            Err(JinError::OperationBlocked {
                ref operation_id,
                ..
            }) if operation_id == "durable-blocked"
        ));
        assert!(matches!(
            crate::ops::events::event_detail_capabilities(vault.path(), event.id()),
            Err(JinError::OperationBlocked {
                ref operation_id,
                ..
            }) if operation_id == "durable-blocked"
        ));

        let cfg = crate::Config::load(vault.path()).unwrap();
        let conn = crate::index::open(&cfg.index_path()).unwrap();
        let indexed = crate::index::query::get_event(&conn, event.id())
            .unwrap()
            .unwrap();
        assert_eq!(indexed.title, "Indexed title");
        drop(conn);

        let build_called = AtomicBool::new(false);
        let unrelated = execute_event_operation(vault.path(), "unrelated", "test", || {
            build_called.store(true, Ordering::SeqCst);
            Ok(("other-event".to_string(), Vec::new()))
        })
        .unwrap_err();
        assert!(matches!(
            unrelated,
            JinError::OperationBlocked {
                ref operation_id,
                ..
            } if operation_id == "durable-blocked"
        ));
        assert!(!build_called.load(Ordering::SeqCst));
        let sync = crate::sync::state::open_sync_db(&cfg.sync_dir()).unwrap();
        assert!(crate::sync::state::list_dirty(&sync).unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn operations_directory_symlink_never_stages_outside_vault() {
        use std::os::unix::fs::symlink;
        use std::sync::atomic::{AtomicBool, Ordering};

        let vault = setup();
        let outside = TempDir::new().unwrap();
        let sentinel = outside.path().join("sentinel");
        fs::atomic_write(&sentinel, b"outside-safe").unwrap();
        symlink(outside.path(), vault.path().join(".jin/operations")).unwrap();

        let build_called = AtomicBool::new(false);
        let result = execute_operation(vault.path(), "symlinked-operations", "test", || {
            build_called.store(true, Ordering::SeqCst);
            Ok((
                "event-1".to_string(),
                vec![TargetPlan {
                    canonical_path: vault.path().join("events/private.md"),
                    before: None,
                    post: Some(b"private event bytes".to_vec()),
                }],
            ))
        });
        assert!(matches!(result, Err(JinError::Integrity(_))));
        assert!(!build_called.load(Ordering::SeqCst));
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"outside-safe");
        assert!(!outside.path().join("symlinked-operations").exists());
        assert!(!outside.path().join("0.before").exists());
        assert!(!outside.path().join("0.post").exists());
    }

    #[cfg(unix)]
    #[test]
    fn operation_id_directory_symlink_never_stages_outside_vault() {
        use std::os::unix::fs::symlink;

        let vault = setup();
        let outside = TempDir::new().unwrap();
        let sentinel = outside.path().join("sentinel");
        fs::atomic_write(&sentinel, b"outside-safe").unwrap();
        std::fs::create_dir(vault.path().join(".jin/operations")).unwrap();
        symlink(
            outside.path(),
            vault.path().join(".jin/operations/symlinked-id"),
        )
        .unwrap();

        let result = execute_operation(vault.path(), "symlinked-id", "test", || {
            Ok((
                "event-1".to_string(),
                vec![TargetPlan {
                    canonical_path: vault.path().join("events/private.md"),
                    before: None,
                    post: Some(b"private event bytes".to_vec()),
                }],
            ))
        });
        assert!(matches!(result, Err(JinError::Integrity(_))));
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"outside-safe");
        assert!(!outside.path().join("operation.json").exists());
        assert!(!outside.path().join("0.before").exists());
        assert!(!outside.path().join("0.post").exists());
    }
}
