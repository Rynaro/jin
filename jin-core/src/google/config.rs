//! Owner-provisioned Google OAuth client credentials.
//!
//! Priority order (first wins):
//!   1. `JIN_GOOGLE_CLIENT_ID` / `JIN_GOOGLE_CLIENT_SECRET` env vars
//!   2. `[google]` section in `.jin/config.toml`
//!
//! The client secret is non-confidential for Desktop/Installed-app OAuth clients (RFC 8252);
//! PKCE removes reliance on it.  Storing it in config.toml is safe for personal use.
//! **Never ship a baked-in secret in the jin binary or repository.**

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

    /// Load credentials from env vars (priority) or config.
    ///
    /// Returns `JinError::Auth` with actionable instructions if neither source has them.
    pub fn load(cfg: &crate::Config) -> crate::Result<Self> {
        let client_id = nonempty_env("JIN_GOOGLE_CLIENT_ID")
            .or_else(|| nonempty_config_value(&cfg.google.client_id))
            .ok_or_else(|| {
                JinError::Auth(
                    "Google client_id not configured. \
                     Add [google] client_id = \"<YOUR_CLIENT_ID>\" to .jin/config.toml \
                     or set the JIN_GOOGLE_CLIENT_ID environment variable. \
                     Run 'jin auth login' for full setup instructions."
                        .to_string(),
                )
            })?;

        let client_secret = nonempty_env("JIN_GOOGLE_CLIENT_SECRET")
            .or_else(|| nonempty_config_value(&cfg.google.client_secret))
            .ok_or_else(|| {
                JinError::Auth(
                    "Google client_secret not configured. \
                     Add [google] client_secret = \"<YOUR_CLIENT_SECRET>\" to .jin/config.toml \
                     or set the JIN_GOOGLE_CLIENT_SECRET environment variable. \
                     Run 'jin auth login' for full setup instructions."
                        .to_string(),
                )
            })?;

        Ok(Self {
            client_id,
            client_secret,
        })
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
        .filter(|value| !value.trim().is_empty())
        .cloned()
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
        let err = GoogleCredentials::load(&cfg).unwrap_err();
        assert!(
            matches!(err, crate::JinError::Auth(_)),
            "expected JinError::Auth, got: {err}"
        );
        let msg = err.to_string();
        assert!(
            msg.contains("client_id"),
            "error should mention client_id: {msg}"
        );
        assert!(
            msg.contains("jin auth login"),
            "error should mention 'jin auth login': {msg}"
        );
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
}
