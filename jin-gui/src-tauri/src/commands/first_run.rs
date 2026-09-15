//! First-run bridge commands.
//!
//! They intentionally operate only on the small OS-config state file until
//! `complete_first_run` has validated and initialized the selected root. The
//! normal Jin command surface stays dormant in `FirstRun` mode.

use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

use crate::{
    error::JinErrorDto,
    root_resolver::{
        read_first_run_state, validate_first_run_root, write_first_run_state, write_persisted_root,
        FirstRunState, FirstRunStatus, FirstRunStep, LaunchState,
    },
    state::AppState,
};

fn bootstrap_error(message: impl Into<String>, retriable: bool) -> JinErrorDto {
    JinErrorDto {
        code: 1,
        kind: "other".to_string(),
        message: message.into(),
        retriable,
        details: None,
    }
}

fn usage_error(message: impl Into<String>) -> JinErrorDto {
    JinErrorDto {
        code: 2,
        kind: "usage".to_string(),
        message: message.into(),
        retriable: false,
        details: None,
    }
}

fn config_dir_or_err() -> Result<PathBuf, JinErrorDto> {
    dirs::config_dir()
        .ok_or_else(|| bootstrap_error("Cannot determine the OS configuration folder.", false))
}

fn first_run_state(
    state: &AppState,
    config_dir: &std::path::Path,
) -> Result<FirstRunState, JinErrorDto> {
    match &state.launch {
        LaunchState::FirstRun { state, .. } => Ok(read_first_run_state(config_dir)
            .filter(|saved| saved.status == FirstRunStatus::InProgress)
            .unwrap_or_else(|| state.clone())),
        LaunchState::Ready { .. } => Err(usage_error("Jin is already set up.")),
        LaunchState::RootUnavailable {
            reason, env_locked, ..
        } if *env_locked => Err(bootstrap_error(reason, true)),
        // A disappeared persisted root can be replaced through the same
        // durable wizard. JIN_ROOT remains deliberately read-only.
        LaunchState::RootUnavailable { .. } => Ok(read_first_run_state(config_dir)
            .filter(|saved| saved.status == FirstRunStatus::InProgress)
            .unwrap_or_default()),
    }
}

fn parse_step(step: &str) -> Result<FirstRunStep, JinErrorDto> {
    match step {
        "welcome" => Ok(FirstRunStep::Welcome),
        "storage" => Ok(FirstRunStep::Storage),
        "functions" => Ok(FirstRunStep::Functions),
        "settings" => Ok(FirstRunStep::Settings),
        "review" => Ok(FirstRunStep::Review),
        _ => Err(usage_error("Unknown setup step.")),
    }
}

fn can_move_between(from: FirstRunStep, to: FirstRunStep) -> bool {
    let index = |step| match step {
        FirstRunStep::Welcome => 0_i8,
        FirstRunStep::Storage => 1,
        FirstRunStep::Functions => 2,
        FirstRunStep::Settings => 3,
        FirstRunStep::Review => 4,
    };
    (index(from) - index(to)).abs() <= 1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootRetryOutcome {
    RestartRequired,
}

fn root_retry_outcome(launch: &LaunchState) -> Result<RootRetryOutcome, JinErrorDto> {
    if matches!(launch, LaunchState::Ready { .. }) {
        Ok(RootRetryOutcome::RestartRequired)
    } else {
        Err(bootstrap_error(
            "Jin still cannot open the selected storage folder. Restore it or choose a replacement.",
            true,
        ))
    }
}

/// The durable write ordering for Finish. Kept independent of Tauri so the
/// interruption boundaries can be tested without a process restart.
fn finalize_first_run_with<SaveState, Initialize, SaveRoot>(
    first_run: &mut FirstRunState,
    root: &std::path::Path,
    mut save_state: SaveState,
    mut initialize: Initialize,
    mut save_root: SaveRoot,
) -> Result<(), JinErrorDto>
where
    SaveState: FnMut(&FirstRunState) -> Result<(), String>,
    Initialize: FnMut(&std::path::Path) -> Result<(), String>,
    SaveRoot: FnMut(&std::path::Path) -> Result<(), String>,
{
    first_run.status = FirstRunStatus::InProgress;
    first_run.step = FirstRunStep::Review;
    save_state(first_run).map_err(|error| bootstrap_error(error, true))?;
    initialize(root).map_err(|error| bootstrap_error(error, true))?;
    save_root(root).map_err(|error| bootstrap_error(error, true))?;
    first_run.status = FirstRunStatus::Completed;
    save_state(first_run).map_err(|error| bootstrap_error(error, true))?;
    Ok(())
}

fn finalize_recovery_with<Initialize, SaveRoot, SaveState>(
    root: &std::path::Path,
    mut initialize: Initialize,
    mut save_root: SaveRoot,
    mut save_state: SaveState,
) -> Result<FirstRunState, JinErrorDto>
where
    Initialize: FnMut(&std::path::Path) -> Result<(), String>,
    SaveRoot: FnMut(&std::path::Path) -> Result<(), String>,
    SaveState: FnMut(&FirstRunState) -> Result<(), String>,
{
    initialize(root).map_err(|error| bootstrap_error(error, true))?;
    save_root(root).map_err(|error| bootstrap_error(error, true))?;
    let completed = FirstRunState {
        schema_version: 1,
        status: FirstRunStatus::Completed,
        step: FirstRunStep::Review,
        selected_root: Some(root.display().to_string()),
    };
    save_state(&completed).map_err(|error| bootstrap_error(error, true))?;
    Ok(completed)
}

#[tauri::command]
pub async fn get_launch_state(
    state: tauri::State<'_, AppState>,
) -> Result<LaunchState, JinErrorDto> {
    let _ = state;
    Ok(crate::root_resolver::resolve_launch_state(
        std::env::var("JIN_ROOT").ok().as_deref(),
        dirs::home_dir().as_deref(),
        dirs::config_dir().as_deref(),
    )
    .1)
}

/// Open the platform's real directory picker. Closing it returns `None` and
/// leaves the saved candidate untouched.
#[tauri::command]
pub async fn choose_first_run_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, JinErrorDto> {
    if matches!(state.launch, LaunchState::Ready { .. })
        || matches!(
            state.launch,
            LaunchState::RootUnavailable {
                env_locked: true,
                ..
            }
        )
    {
        return Err(usage_error(
            "Storage selection is only available during first-run setup.",
        ));
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path.map(|path| path.to_string()));
    });
    receiver
        .await
        .map_err(|_| bootstrap_error("The folder picker closed unexpectedly. Try again.", true))
}

#[tauri::command]
pub async fn select_first_run_root(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<FirstRunState, JinErrorDto> {
    let _serial = state
        .bootstrap_gate
        .lock()
        .map_err(|_| bootstrap_error("Setup state is unavailable.", true))?;
    let config_dir = config_dir_or_err()?;
    let mut first_run = first_run_state(&state, &config_dir)?;
    let root = PathBuf::from(path.trim());
    validate_first_run_root(&root).map_err(usage_error)?;
    first_run.status = FirstRunStatus::InProgress;
    first_run.selected_root = Some(root.display().to_string());
    first_run.step = FirstRunStep::Storage;
    write_first_run_state(&config_dir, &first_run).map_err(|error| {
        bootstrap_error(format!("Could not save setup progress: {error}"), true)
    })?;
    Ok(first_run)
}

#[tauri::command]
pub async fn save_first_run_step(
    step: String,
    state: tauri::State<'_, AppState>,
) -> Result<FirstRunState, JinErrorDto> {
    let _serial = state
        .bootstrap_gate
        .lock()
        .map_err(|_| bootstrap_error("Setup state is unavailable.", true))?;
    let config_dir = config_dir_or_err()?;
    let mut first_run = first_run_state(&state, &config_dir)?;
    let requested = parse_step(&step)?;
    if !can_move_between(first_run.step, requested) {
        return Err(usage_error("Complete the setup steps in order."));
    }
    if !matches!(requested, FirstRunStep::Welcome | FirstRunStep::Storage)
        && first_run.selected_root.is_none()
    {
        return Err(usage_error("Choose a storage folder before continuing."));
    }
    first_run.step = requested;
    write_first_run_state(&config_dir, &first_run).map_err(|error| {
        bootstrap_error(format!("Could not save setup progress: {error}"), true)
    })?;
    Ok(first_run)
}

/// Revalidate and initialize the candidate. Root persistence is written only
/// after init succeeds, then the app restarts into the regular immutable-root
/// launch path.
#[tauri::command]
pub async fn complete_first_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), JinErrorDto> {
    let _serial = state
        .bootstrap_gate
        .lock()
        .map_err(|_| bootstrap_error("Setup state is unavailable.", true))?;
    let config_dir = config_dir_or_err()?;
    let mut first_run = first_run_state(&state, &config_dir)?;
    let selected = first_run
        .selected_root
        .clone()
        .ok_or_else(|| usage_error("Choose a storage folder before finishing setup."))?;
    let root = PathBuf::from(&selected);
    if first_run.step != FirstRunStep::Review {
        return Err(usage_error("Review setup before finishing."));
    }
    validate_first_run_root(&root).map_err(usage_error)?;

    finalize_first_run_with(
        &mut first_run,
        &root,
        |next| {
            write_first_run_state(&config_dir, next)
                .map_err(|error| format!("Could not save setup progress: {error}"))
        },
        |candidate| {
            jin_core::ops::init(candidate)
                .map(|_| ())
                .map_err(|error| format!("Could not prepare the selected folder: {error}"))
        },
        |candidate| {
            write_persisted_root(&config_dir, &candidate.display().to_string())
                .map_err(|error| format!("Could not save the selected folder: {error}"))
        },
    )?;

    app.request_restart();
    Ok(())
}

/// Replace a missing previously-selected root without replaying the tutorial.
/// This is deliberately separate from first-run selection: recovery has
/// already completed the user's guided choices.
#[tauri::command]
pub async fn recover_store_root(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), JinErrorDto> {
    let LaunchState::RootUnavailable { env_locked, .. } = &state.launch else {
        return Err(usage_error("Storage recovery is not available right now."));
    };
    if *env_locked {
        return Err(usage_error(
            "JIN_ROOT is set. Update JIN_ROOT, then restart Jin.",
        ));
    }
    let _serial = state
        .bootstrap_gate
        .lock()
        .map_err(|_| bootstrap_error("Setup state is unavailable.", true))?;
    let config_dir = config_dir_or_err()?;
    let root = PathBuf::from(path.trim());
    validate_first_run_root(&root).map_err(usage_error)?;
    finalize_recovery_with(
        &root,
        |candidate| {
            jin_core::ops::init(candidate)
                .map(|_| ())
                .map_err(|error| format!("Could not prepare the replacement folder: {error}"))
        },
        |candidate| {
            write_persisted_root(&config_dir, &candidate.display().to_string())
                .map_err(|error| format!("Could not save the replacement folder: {error}"))
        },
        |completed| {
            write_first_run_state(&config_dir, completed).map_err(|error| {
                format!(
                    "The replacement folder is ready, but completion could not be saved: {error}"
                )
            })
        },
    )?;
    app.request_restart();
    Ok(())
}

/// Recheck a restored persisted root from a `RootUnavailable` process. A
/// restart is mandatory: scheduler and normal services were intentionally not
/// started for this process, so a WebView-only reload would be split-brain.
#[tauri::command]
pub async fn retry_root_unavailable(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), JinErrorDto> {
    let LaunchState::RootUnavailable { env_locked, .. } = &state.launch else {
        return Err(usage_error("Storage recovery is not available right now."));
    };
    if *env_locked {
        return Err(usage_error(
            "JIN_ROOT is set. Update JIN_ROOT, then restart Jin.",
        ));
    }
    let launch = crate::root_resolver::resolve_launch_state(
        std::env::var("JIN_ROOT").ok().as_deref(),
        dirs::home_dir().as_deref(),
        dirs::config_dir().as_deref(),
    )
    .1;
    match root_retry_outcome(&launch)? {
        RootRetryOutcome::RestartRequired => app.request_restart(),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn restored_root_requires_native_restart_before_ready_services_attach() {
        assert!(matches!(
            root_retry_outcome(&LaunchState::Ready {
                root: "/tmp/Jin".to_string(),
            }),
            Ok(RootRetryOutcome::RestartRequired)
        ));
        let error = root_retry_outcome(&LaunchState::RootUnavailable {
            root: "/tmp/Missing".to_string(),
            reason: "missing".to_string(),
            env_locked: false,
        })
        .expect_err("an unavailable root cannot reveal Ready in this process");
        assert!(error.retriable);
    }

    #[test]
    fn finish_persists_pending_then_initializes_then_persists_root_then_completes() {
        let events = RefCell::new(Vec::new());
        let saved = RefCell::new(Vec::new());
        let root = std::path::Path::new("/tmp/Jin");
        let mut state = FirstRunState {
            schema_version: 1,
            status: FirstRunStatus::InProgress,
            step: FirstRunStep::Review,
            selected_root: Some(root.display().to_string()),
        };
        finalize_first_run_with(
            &mut state,
            root,
            |next| {
                saved.borrow_mut().push(next.status.clone());
                events.borrow_mut().push("state");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("init");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("root");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(&*events.borrow(), &["state", "init", "root", "state"]);
        assert_eq!(
            &*saved.borrow(),
            &[FirstRunStatus::InProgress, FirstRunStatus::Completed]
        );
        assert_eq!(state.status, FirstRunStatus::Completed);
    }

    #[test]
    fn finish_failure_keeps_pending_state_for_a_later_retry() {
        let root = std::path::Path::new("/tmp/Jin");
        let mut state = FirstRunState {
            schema_version: 1,
            status: FirstRunStatus::InProgress,
            step: FirstRunStep::Review,
            selected_root: Some(root.display().to_string()),
        };
        let error = finalize_first_run_with(
            &mut state,
            root,
            |_| Ok(()),
            |_| Ok(()),
            |_| Err("pointer write failed".to_string()),
        )
        .expect_err("pointer failure must keep setup retryable");
        assert!(error.retriable);
        assert_eq!(state.status, FirstRunStatus::InProgress);

        finalize_first_run_with(&mut state, root, |_| Ok(()), |_| Ok(()), |_| Ok(())).unwrap();
        assert_eq!(state.status, FirstRunStatus::Completed);
    }

    #[test]
    fn recovery_initializes_and_persists_replacement_before_completion() {
        let events = RefCell::new(Vec::new());
        let root = std::path::Path::new("/tmp/Replacement");
        let completed = finalize_recovery_with(
            root,
            |_| {
                events.borrow_mut().push("init");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("root");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("complete");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(&*events.borrow(), &["init", "root", "complete"]);
        assert_eq!(completed.status, FirstRunStatus::Completed);
        assert_eq!(completed.selected_root.as_deref(), Some("/tmp/Replacement"));
    }
}
