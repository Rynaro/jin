//! Output helpers: human-readable and --json emission.

use jin_core::dto::Envelope;
use serde_json::Value;

pub fn print_json(envelope: &Envelope) {
    println!(
        "{}",
        serde_json::to_string_pretty(envelope)
            .unwrap_or_else(|e| { format!(r#"{{"error":"serialize failed: {}"}}"#, e) })
    );
}

#[allow(dead_code)]
pub fn print_error_json(code: &str, message: &str) {
    let env = Envelope::error(code, message);
    print_json(&env);
}

#[allow(dead_code)]
pub fn json_ok(kind: &str, data: Value) -> Envelope {
    Envelope::ok(kind, data)
}
