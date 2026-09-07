//! Boundary for synchronous core work invoked by async Tauri commands.

use crate::error::JinErrorDto;

/// Run a synchronous command implementation on Tokio's blocking worker pool.
///
/// The inner `Result` is flattened so callers receive the original domain DTO,
/// while a worker cancellation or panic becomes a serializable bridge error.
pub(crate) async fn run<T, F>(operation: &'static str, task: F) -> Result<T, JinErrorDto>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, JinErrorDto> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| JinErrorDto {
            code: 1,
            kind: "other".to_string(),
            message: format!("{operation} blocking worker failed: {error}"),
            retriable: false,
            details: None,
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_successful_worker_value() {
        let result = tauri::async_runtime::block_on(run("test operation", || Ok(42)));

        assert_eq!(result.expect("worker should succeed"), 42);
    }

    #[test]
    fn preserves_domain_error() {
        let expected = JinErrorDto {
            code: 5,
            kind: "auth".to_string(),
            message: "reauth required".to_string(),
            retriable: false,
            details: None,
        };
        let worker_error = expected.clone();

        let result = tauri::async_runtime::block_on(run("test operation", move || {
            Err::<(), _>(worker_error)
        }));

        let actual = result.expect_err("domain error should be returned");
        assert_eq!(actual.code, expected.code);
        assert_eq!(actual.kind, "auth");
        assert_eq!(actual.message, "reauth required");
        assert!(!actual.retriable);
    }

    #[test]
    fn maps_worker_panic_to_bridge_error() {
        let result = tauri::async_runtime::block_on(run("calendar sync", || -> Result<(), _> {
            panic!("simulated worker panic")
        }));

        let error = result.expect_err("panic should be mapped");
        assert_eq!(error.code, 1);
        assert_eq!(error.kind, "other");
        assert!(error
            .message
            .contains("calendar sync blocking worker failed"));
        assert!(!error.retriable);
    }
}
