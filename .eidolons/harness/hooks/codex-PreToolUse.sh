#!/usr/bin/env bash
# Eidolons strict-tier shim — codex PreToolUse
# Protected-globs ONLY. Delegate-or-deny REFUSED (Codex PreToolUse has no agent_id;
# subagent firing is undocumented — cannot discriminate main-loop vs subagent).
# [ASSUMPTION A5]: apply_patch path in tool_input.file_path OR tool_input.path;
#                  shim tries both; fails open if neither resolves.
# FAIL-OPEN: any error/malformed stdin => exit 0 empty (allow). Only glob path denies.
# Deny shape (codex): {"decision":"block","reason":"..."} exit 0.
set -euo pipefail

_deny_codex() {
  jq -n --arg r "Eidolons strict: $1." '{decision:"block",reason:$r}'
}

_main() {
  command -v jq >/dev/null 2>&1 || return 0
  _in="$(cat 2>/dev/null)" || return 0
  [[ -n "$_in" ]] || return 0
  # Extract the edit target: try file_path first, then path (A5 — both fields tried).
  _fp="$(printf '%s' "$_in" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)" || _fp=""
  [[ -n "$_fp" ]] || return 0
  # Protected-glob check (denies in ALL contexts — the only check for codex).
  while IFS= read -r _g; do
    [[ -z "$_g" ]] && continue
    _gn="${_g%/**}/*"
    case "$_fp" in
      "$_g"|$_gn) _deny_codex "$_fp matches protected glob $_g"; return 0 ;;
    esac
  done <<'GLOBS'
GLOBS
  return 0
}
_main 2>/dev/null || true
