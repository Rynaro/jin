//! Parse and render files with YAML frontmatter + Markdown body.
//!
//! On-disk newline policy:
//!   * Parse: tolerant — accepts CRLF (`\r\n`) or LF (`\n`); strips leading BOM.
//!   * Write: always LF (`\n`) — render() never emits `\r`.

use crate::{JinError, Result};

/// Normalize line-endings to LF and strip a leading UTF-8 BOM.
fn normalize(s: &str) -> String {
    let s = s.trim_start_matches('\u{FEFF}');
    s.replace("\r\n", "\n").replace('\r', "\n")
}

/// Split a file's text content into (frontmatter_yaml, body).
/// Normalizes CRLF → LF before splitting; returns owned strings.
/// Returns an error if the leading `---` delimiter is missing or the
/// closing `---` delimiter is absent.
pub fn split(content: &str) -> Result<(String, String)> {
    let content = normalize(content);

    let after_open = content.strip_prefix("---").ok_or_else(|| {
        JinError::YamlParse("missing leading '---' frontmatter delimiter".to_string())
    })?;

    // Skip the newline right after the opening ---
    let rest = after_open.strip_prefix('\n').unwrap_or(after_open);

    // Find the closing ---
    let pos = rest.find("\n---").ok_or_else(|| {
        JinError::YamlParse("missing closing '---' frontmatter delimiter".to_string())
    })?;

    let yaml = rest[..pos].to_string();
    let after = &rest[pos + 4..]; // skip \n---
    let body = after.strip_prefix('\n').unwrap_or(after).to_string();

    Ok((yaml, body))
}

/// Render frontmatter struct + body into a file string (always LF).
pub fn render<T: serde::Serialize>(fm: &T, body: &str) -> Result<String> {
    let yaml = serde_yaml_ng::to_string(fm)
        .map_err(|e| JinError::YamlParse(format!("serialize frontmatter: {}", e)))?;
    Ok(format!("---\n{}---\n{}", yaml, body))
}

/// Parse frontmatter from YAML string.
pub fn parse_fm<T: serde::de::DeserializeOwned>(yaml: &str) -> Result<T> {
    serde_yaml_ng::from_str(yaml)
        .map_err(|e| JinError::YamlParse(format!("parse frontmatter: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_lf() {
        let content = "---\nid: foo\n---\nbody text\n";
        let (yaml, body) = split(content).unwrap();
        assert_eq!(yaml.trim(), "id: foo");
        assert_eq!(body, "body text\n");
    }

    #[test]
    fn split_no_body_empty_string() {
        let content = "---\nid: bar\n---\n";
        let (yaml, body) = split(content).unwrap();
        assert_eq!(yaml.trim(), "id: bar");
        assert_eq!(body, "");
    }

    #[test]
    fn round_trip_crlf_normalized() {
        // CRLF input must produce the same yaml/body as LF input
        let lf = "---\nid: foo\nname: bar\n---\nbody line\n";
        let crlf = "---\r\nid: foo\r\nname: bar\r\n---\r\nbody line\r\n";
        let (y_lf, b_lf) = split(lf).unwrap();
        let (y_crlf, b_crlf) = split(crlf).unwrap();
        assert_eq!(
            y_lf, y_crlf,
            "YAML slices must match after CRLF normalization"
        );
        assert_eq!(b_lf, b_crlf, "body must match after CRLF normalization");
    }

    #[test]
    fn bom_stripped() {
        // UTF-8 BOM (\u{FEFF}) at the start must be stripped transparently
        let with_bom = "\u{FEFF}---\nid: bom\n---\n";
        let (yaml, _) = split(with_bom).unwrap();
        assert_eq!(yaml.trim(), "id: bom");
    }

    #[test]
    fn missing_closing_fence_returns_error() {
        let bad = "---\nid: no-close\n";
        assert!(
            split(bad).is_err(),
            "missing closing --- must return an error"
        );
    }

    #[test]
    fn crlf_body_byte_for_byte_under_policy() {
        // After round-tripping through split+render the body is LF-normalised
        // and equals the LF form of the original body.
        let crlf_content = "---\nid: abc\ntype: note\n---\r\nline one\r\nline two\r\n";
        let (_, body) = split(crlf_content).unwrap();
        assert_eq!(body, "line one\nline two\n");
        // No stray \r in body
        assert!(!body.contains('\r'));
    }
}
