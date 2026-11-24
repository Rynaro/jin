//! Google OAuth client credentials for owner-configured and official builds.
//!
//! Priority order:
//!   1. Owner overrides from `JIN_GOOGLE_CLIENT_ID` / `JIN_GOOGLE_CLIENT_SECRET`
//!      and the per-vault `[google]` config. Existing per-field override behavior
//!      is retained for these two owner sources.
//!   2. The complete publisher-owned Desktop OAuth pair injected into an official
//!      build with `JIN_PUBLISHER_GOOGLE_CLIENT_ID` and
//!      `JIN_PUBLISHER_GOOGLE_CLIENT_SECRET` at compile time.
//!
//! The client secret is non-confidential for Desktop/Installed-app OAuth clients (RFC 8252);
//! PKCE removes reliance on it. Storing an owner-provided pair in config.toml is
//! supported for personal use. Official builds may contain publisher-owned
//! Desktop-client metadata, but must never contain user access or refresh tokens.

use crate::JinError;

/// Resolved OAuth client credentials (client_id + client_secret).
#[derive(Debug, Clone)]
pub struct GoogleCredentials {
    pub client_id: String,
    pub client_secret: String,
}

impl GoogleCredentials {
    /// Validate and store credentials from Google's downloaded Desktop OAuth
    /// client JSON. The contents stay in the native process and are never a
    /// GUI DTO, log message, or audit entry.
    pub fn import_desktop_client_json(cfg: &mut crate::Config, content: &str) -> crate::Result<()> {
        #[derive(serde::Deserialize)]
        struct ClientFile {
            installed: Option<DesktopClient>,
        }
        #[derive(serde::Deserialize)]
        struct DesktopClient {
            #[serde(default)]
            client_id: String,
            #[serde(default)]
            client_secret: String,
        }

        let parsed: ClientFile = serde_json::from_str(content).map_err(|_| {
            JinError::Auth("This file is not a Google OAuth client JSON file.".to_string())
        })?;
        let installed = parsed.installed.ok_or_else(|| JinError::Auth(
            "Choose a Desktop app OAuth client JSON file. Web and service-account credentials cannot connect Jin.".to_string(),
        ))?;
        let missing_id = installed.client_id.trim().is_empty();
        let missing_secret = installed.client_secret.trim().is_empty();
        if missing_id || missing_secret {
            let missing = match (missing_id, missing_secret) {
                (true, true) => "client ID and client secret",
                (true, false) => "client ID",
                (false, true) => "client secret",
                (false, false) => unreachable!(),
            };
            return Err(JinError::Auth(format!(
                "The Desktop app OAuth client JSON is missing its {missing}."
            )));
        }
        if !installed.client_id.ends_with(".apps.googleusercontent.com") {
            return Err(JinError::Auth(
                "The selected OAuth client ID is not a Google Desktop app client.".to_string(),
            ));
        }
        cfg.google.client_id = Some(installed.client_id);
        cfg.google.client_secret = Some(installed.client_secret);
        Ok(())
    }

    /// Load credentials from owner overrides or the official-build fallback.
    ///
    /// Returns `JinError::Auth` with actionable instructions if neither source has them.
    pub fn load(cfg: &crate::Config) -> crate::Result<Self> {
        resolve_credentials(
            cfg,
            option_env!("JIN_PUBLISHER_GOOGLE_CLIENT_ID"),
            option_env!("JIN_PUBLISHER_GOOGLE_CLIENT_SECRET"),
        )
    }
}

fn resolve_credentials(
    cfg: &crate::Config,
    publisher_client_id: Option<&str>,
    publisher_client_secret: Option<&str>,
) -> crate::Result<GoogleCredentials> {
    let owner_client_id = nonempty_env("JIN_GOOGLE_CLIENT_ID")
        .or_else(|| nonempty_config_value(&cfg.google.client_id));
    let owner_client_secret = nonempty_env("JIN_GOOGLE_CLIENT_SECRET")
        .or_else(|| nonempty_config_value(&cfg.google.client_secret));

    match (owner_client_id, owner_client_secret) {
        (Some(client_id), Some(client_secret)) => Ok(GoogleCredentials {
            client_id,
            client_secret,
        }),
        (Some(_), None) => Err(missing_owner_credential("client_secret")),
        (None, Some(_)) => Err(missing_owner_credential("client_id")),
        (None, None) => {
            match validate_publisher_pair(publisher_client_id, publisher_client_secret)? {
                Some((client_id, client_secret)) => {
                    Ok(publisher_credentials(client_id, client_secret))
                }
                None => Err(JinError::Auth(
                    "Google OAuth is not configured for this build. \
                 Import a Desktop OAuth client JSON in Settings or set \
                 JIN_GOOGLE_CLIENT_ID and JIN_GOOGLE_CLIENT_SECRET."
                        .to_string(),
                )),
            }
        }
    }
}

fn missing_owner_credential(field: &str) -> JinError {
    JinError::Auth(format!(
        "Google {field} not configured. Complete the owner-provided OAuth pair in \
         .jin/config.toml or set both JIN_GOOGLE_CLIENT_ID and JIN_GOOGLE_CLIENT_SECRET."
    ))
}

fn publisher_credentials(client_id: &str, client_secret: &str) -> GoogleCredentials {
    GoogleCredentials {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
    }
}

fn validate_publisher_pair<'a>(
    client_id: Option<&'a str>,
    client_secret: Option<&'a str>,
) -> crate::Result<Option<(&'a str, &'a str)>> {
    match (
        client_id.and_then(nonempty_value),
        client_secret.and_then(nonempty_value),
    ) {
        (Some(client_id), Some(client_secret))
            if client_id.ends_with(".apps.googleusercontent.com") =>
        {
            Ok(Some((client_id, client_secret)))
        }
        (Some(_), Some(_)) => Err(JinError::Auth(
            "Official build publisher OAuth client ID must be a Google Desktop client ID."
                .to_string(),
        )),
        (None, None) => Ok(None),
        _ => Err(JinError::Auth(
            "Official build publisher OAuth configuration is incomplete. \
             The release must supply both JIN_PUBLISHER_GOOGLE_CLIENT_ID and \
             JIN_PUBLISHER_GOOGLE_CLIENT_SECRET."
                .to_string(),
        )),
    }
}

fn nonempty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn nonempty_config_value(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .and_then(|value| nonempty_value(value).map(str::to_owned))
}

fn nonempty_value(value: &str) -> Option<&str> {
    (!value.trim().is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GoogleConfig;
    use crate::test_support::{EnvGuard, CREDENTIALS_ENV_LOCK};

    fn make_config_with_google(client_id: &str, client_secret: &str) -> crate::Config {
        let mut cfg = crate::Config::new(std::path::PathBuf::from("/tmp/test-jin"));
        cfg.google = GoogleConfig {
            client_id: Some(client_id.to_string()),
            client_secret: Some(client_secret.to_string()),
        };
        cfg
    }

    #[test]
    fn credentials_load_from_config() {
        // Serialise env access; ensure both vars are absent so only the config is consulted.
        let _g1 = EnvGuard::remove("JIN_GOOGLE_CLIENT_ID", &CREDENTIALS_ENV_LOCK);
        // Temporarily hold the lock for the second var without acquiring a separate lock.
        std::env::remove_var("JIN_GOOGLE_CLIENT_SECRET");

        let cfg = make_config_with_google(
            "test-client-id.apps.googleusercontent.com",
            "test-client-secret",
        );
        let creds = GoogleCredentials::load(&cfg).expect("credentials should load");
        assert_eq!(creds.client_id, "test-client-id.apps.googleusercontent.com");
        assert_eq!(creds.client_secret, "test-client-secret");
    }

    #[test]
    fn credentials_missing_returns_auth_error() {
        let _g1 = EnvGuard::remove("JIN_GOOGLE_CLIENT_ID", &CREDENTIALS_ENV_LOCK);
        std::env::remove_var("JIN_GOOGLE_CLIENT_SECRET");

        let cfg = crate::Config::new(std::path::PathBuf::from("/tmp/test-jin"));
        let err = resolve_credentials(&cfg, None, None).unwrap_err();
        assert!(
            matches!(err, crate::JinError::Auth(_)),
            "expected JinError::Auth, got: {err}"
        );
        let msg = err.to_string();
        assert!(
            msg.contains("not configured for this build"),
            "error should identify the missing build credentials: {msg}"
        );
        assert!(
            msg.contains("Import a Desktop OAuth client JSON"),
            "error should give the Settings recovery path: {msg}"
        );
    }

    #[test]
    fn complete_publisher_pair_connects_a_fresh_root_without_owner_state() {
        with_no_owner_environment(|| {
            let config = crate::Config::new(std::path::PathBuf::from("/tmp/fresh-jin"));

            let credentials = resolve_credentials(
                &config,
                Some("publisher.apps.googleusercontent.com"),
                Some("publisher-client-secret"),
            )
            .expect("complete publisher pair should resolve");

            assert_eq!(
                credentials.client_id,
                "publisher.apps.googleusercontent.com"
            );
            assert_eq!(credentials.client_secret, "publisher-client-secret");
            assert!(config.google.client_id.is_none());
            assert!(config.google.client_secret.is_none());
        });
    }

    #[test]
    fn owner_pair_overrides_the_publisher_pair() {
        with_no_owner_environment(|| {
            let config =
                make_config_with_google("owner.apps.googleusercontent.com", "owner-client-secret");

            let credentials = resolve_credentials(
                &config,
                Some("publisher.apps.googleusercontent.com"),
                Some("publisher-client-secret"),
            )
            .expect("owner pair should resolve");

            assert_eq!(credentials.client_id, "owner.apps.googleusercontent.com");
            assert_eq!(credentials.client_secret, "owner-client-secret");
        });
    }

    #[test]
    fn incomplete_owner_pair_does_not_borrow_a_publisher_value() {
        with_no_owner_environment(|| {
            let config = make_config_with_google("owner.apps.googleusercontent.com", "");

            let error = resolve_credentials(
                &config,
                Some("publisher.apps.googleusercontent.com"),
                Some("publisher-client-secret"),
            )
            .expect_err("publisher fallback must not complete an owner pair");

            assert!(error.to_string().contains("client_secret"));
        });
    }

    #[test]
    fn incomplete_publisher_pair_is_not_a_fallback() {
        with_no_owner_environment(|| {
            let config = crate::Config::new(std::path::PathBuf::from("/tmp/fresh-jin"));

            let error = resolve_credentials(
                &config,
                Some("publisher.apps.googleusercontent.com"),
                Some("  "),
            )
            .expect_err("partial publisher pair must not resolve");

            assert!(error.to_string().contains("configuration is incomplete"));
        });
    }

    #[test]
    fn partial_compiled_publisher_pair_fails_before_credential_resolution() {
        let error = validate_publisher_pair(Some("publisher.apps.googleusercontent.com"), None)
            .expect_err("a release must compile both publisher values");

        assert!(error.to_string().contains("configuration is incomplete"));
        assert!(!error
            .to_string()
            .contains("publisher.apps.googleusercontent.com"));
    }

    #[test]
    fn compiled_publisher_artifact_respects_the_fallback_contract() {
        with_no_owner_environment(|| {
            let config = crate::Config::new(std::path::PathBuf::from("/tmp/fresh-jin"));
            let expected = validate_publisher_pair(
                option_env!("JIN_PUBLISHER_GOOGLE_CLIENT_ID"),
                option_env!("JIN_PUBLISHER_GOOGLE_CLIENT_SECRET"),
            );
            let resolved = GoogleCredentials::load(&config);

            match expected {
                Ok(Some(_)) => assert!(
                    resolved.is_ok(),
                    "a complete compiled publisher pair must resolve on a fresh root"
                ),
                Ok(None) | Err(_) => assert!(
                    resolved.is_err(),
                    "an absent or incomplete compiled publisher pair must not resolve"
                ),
            }
            assert!(config.google.client_id.is_none());
            assert!(config.google.client_secret.is_none());
        });
    }

    #[test]
    fn each_nonempty_environment_value_overrides_its_configured_counterpart() {
        let _lock = CREDENTIALS_ENV_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let original_id = std::env::var("JIN_GOOGLE_CLIENT_ID").ok();
        let original_secret = std::env::var("JIN_GOOGLE_CLIENT_SECRET").ok();

        std::env::set_var("JIN_GOOGLE_CLIENT_ID", "env.apps.googleusercontent.com");
        std::env::remove_var("JIN_GOOGLE_CLIENT_SECRET");
        let config = make_config_with_google("config.apps.googleusercontent.com", "config-secret");
        let credentials = GoogleCredentials::load(&config).expect("mixed credentials resolve");
        assert_eq!(credentials.client_id, "env.apps.googleusercontent.com");
        assert_eq!(credentials.client_secret, "config-secret");

        std::env::set_var("JIN_GOOGLE_CLIENT_ID", "   ");
        std::env::set_var("JIN_GOOGLE_CLIENT_SECRET", "env-secret");
        let credentials = GoogleCredentials::load(&config).expect("blank environment is ignored");
        assert_eq!(credentials.client_id, "config.apps.googleusercontent.com");
        assert_eq!(credentials.client_secret, "env-secret");

        restore_env("JIN_GOOGLE_CLIENT_ID", original_id);
        restore_env("JIN_GOOGLE_CLIENT_SECRET", original_secret);
    }

    #[test]
    fn imports_only_installed_desktop_client_json() {
        let mut config = crate::Config::new(std::path::PathBuf::from("/tmp/test-jin"));
        GoogleCredentials::import_desktop_client_json(
            &mut config,
            r#"{
          "installed": {"client_id":"desktop.apps.googleusercontent.com", "client_secret":"secret"}
        }"#,
        )
        .unwrap();
        assert_eq!(
            config.google.client_id.as_deref(),
            Some("desktop.apps.googleusercontent.com")
        );

        let error = GoogleCredentials::import_desktop_client_json(&mut config, r#"{"web": {}}"#)
            .unwrap_err();
        assert!(error.to_string().contains("Desktop app"));
        let error =
            GoogleCredentials::import_desktop_client_json(&mut config, r#"{"installed": {}}"#)
                .unwrap_err();
        assert!(error.to_string().contains("client ID and client secret"));
    }

    fn restore_env(key: &str, value: Option<String>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    fn with_no_owner_environment(run: impl FnOnce()) {
        let _lock = CREDENTIALS_ENV_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let client_id = std::env::var("JIN_GOOGLE_CLIENT_ID").ok();
        let client_secret = std::env::var("JIN_GOOGLE_CLIENT_SECRET").ok();
        std::env::remove_var("JIN_GOOGLE_CLIENT_ID");
        std::env::remove_var("JIN_GOOGLE_CLIENT_SECRET");
        run();
        restore_env("JIN_GOOGLE_CLIENT_ID", client_id);
        restore_env("JIN_GOOGLE_CLIENT_SECRET", client_secret);
    }
}
