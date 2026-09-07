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
    /// Load credentials from env vars (priority) or config.
    ///
    /// Returns `JinError::Auth` with actionable instructions if neither source has them.
    pub fn load(cfg: &crate::Config) -> crate::Result<Self> {
        let client_id = std::env::var("JIN_GOOGLE_CLIENT_ID")
            .ok()
            .or_else(|| cfg.google.client_id.clone())
            .ok_or_else(|| {
                JinError::Auth(
                    "Google client_id not configured. \
                     Add [google] client_id = \"<YOUR_CLIENT_ID>\" to .jin/config.toml \
                     or set the JIN_GOOGLE_CLIENT_ID environment variable. \
                     Run 'jin auth login' for full setup instructions."
                        .to_string(),
                )
            })?;

        let client_secret = std::env::var("JIN_GOOGLE_CLIENT_SECRET")
            .ok()
            .or_else(|| cfg.google.client_secret.clone())
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
}
