//! One validated OS-browser opener and an exact top-level main-webview policy.

use tauri::Url;

use crate::error::JinErrorDto;

pub fn normalized_external_url(raw: &str) -> Option<Url> {
    if raw.trim() != raw || raw.chars().any(char::is_control) {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url)
}

#[derive(Clone, Debug)]
pub struct MainNavigationPolicy {
    allowed: Url,
}

impl MainNavigationPolicy {
    pub fn new(allowed: Url) -> Self {
        Self { allowed }
    }

    pub fn allows(&self, candidate: &Url) -> bool {
        // Comparing Url::origin() is unsafe for `tauri:` because Rust URL gives
        // every opaque origin a fresh identity. Compare the exact URL tuple.
        candidate.scheme() == self.allowed.scheme()
            && candidate.host_str() == self.allowed.host_str()
            && candidate.port_or_known_default() == self.allowed.port_or_known_default()
            && candidate.username().is_empty()
            && candidate.password().is_none()
            && candidate.host_str().is_some()
    }
}

pub fn configured_main_url(config: &tauri::Config, dev: bool) -> Result<Url, String> {
    if dev {
        return config
            .build
            .dev_url
            .clone()
            .ok_or_else(|| "Missing configured dev URL".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let https = config
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .map(|window| window.use_https_scheme)
            .unwrap_or(false);
        return Url::parse(if https {
            "https://tauri.localhost"
        } else {
            "http://tauri.localhost"
        })
        .map_err(|err| err.to_string());
    }
    #[cfg(not(target_os = "windows"))]
    Url::parse("tauri://localhost").map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), JinErrorDto> {
    let normalized = normalized_external_url(&url).ok_or_else(|| JinErrorDto {
        code: 2,
        kind: "usage".into(),
        message: "Only complete http or https addresses can open in a browser.".into(),
        retriable: false,
        details: None,
    })?;
    tokio::task::spawn_blocking(move || launch_system_browser(normalized.as_str()))
        .await
        .map_err(|_| launch_error())?
        .map_err(|_| launch_error())
}

fn launch_error() -> JinErrorDto {
    JinErrorDto {
        code: 1,
        kind: "other".into(),
        message: "The default browser could not open this address.".into(),
        retriable: false,
        details: None,
    }
}

fn launch_system_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = std::process::Command::new("rundll32.exe");
        value.arg("url.dll,FileProtocolHandler");
        value
    };
    let status = command.arg(url).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(
            "Default browser rejected the address",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_opening_rejects_schemes_credentials_and_controls() {
        for raw in [
            "mailto:a@b.test",
            "file:///tmp/x",
            "javascript:alert(1)",
            "//example.com",
            "https://u:p@example.com",
            "https://example.com\n",
        ] {
            assert!(normalized_external_url(raw).is_none(), "{raw:?}");
        }
        assert_eq!(
            normalized_external_url("https://example.com/a?x=1&y=2#f")
                .unwrap()
                .as_str(),
            "https://example.com/a?x=1&y=2#f"
        );
    }

    #[test]
    fn main_navigation_accepts_only_the_exact_app_tuple() {
        let policy = MainNavigationPolicy::new(Url::parse("http://localhost:1420").unwrap());
        for allowed in ["http://localhost:1420/", "http://localhost:1420/#notes"] {
            assert!(policy.allows(&Url::parse(allowed).unwrap()));
        }
        for denied in [
            "http://localhost:1421/",
            "http://127.0.0.1:1420/",
            "https://localhost:1420/",
            "http://u@localhost:1420/",
            "blob:http://localhost:1420/id",
            "data:text/html,x",
        ] {
            assert!(!policy.allows(&Url::parse(denied).unwrap()), "{denied}");
        }
        let native = MainNavigationPolicy::new(Url::parse("tauri://localhost").unwrap());
        assert!(native.allows(&Url::parse("tauri://localhost/index.html#notes").unwrap()));
        assert!(!native.allows(&Url::parse("tauri://other/index.html").unwrap()));
        assert!(!native.allows(&Url::parse("tauri://localhost:123/index.html").unwrap()));
    }
}
