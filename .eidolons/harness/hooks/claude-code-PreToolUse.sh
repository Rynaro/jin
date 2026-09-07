#!/usr/bin/env bash
# Eidolons strict-tier shim — claude-code PreToolUse
# Stateless delegate-or-deny + protected-globs deny (anti-reward-hack).
# Rule order: (1) protected-glob check FIRST (denies in ALL contexts, including subagents);
#             (2) delegate-or-deny: agent_id ABSENT => main loop => deny.
# FAIL-OPEN: any error/malformed stdin => exit 0 empty (allow). ONLY deny paths emit deny.
# Deny shape (verified): hookSpecificOutput.permissionDecision:"deny" + permissionDecisionReason.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0

_deny() {
  jq -n --arg r "Eidolons strict tier: $1." \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
}

_main() {
  command -v jq >/dev/null 2>&1 || return 0
  _in="$(cat 2>/dev/null)" || return 0
  [[ -n "$_in" ]] || return 0
  _tool="$(printf '%s' "$_in" | jq -r '.tool_name // empty' 2>/dev/null)" || return 0
  case "$_tool" in Edit|Write|MultiEdit|NotebookEdit) : ;; *) return 0 ;; esac
  _fp="$(printf '%s' "$_in" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || _fp=""
  # 1) Protected-glob check FIRST (denies in ALL contexts — anti-reward-hack).
  if [[ -n "$_fp" ]]; then
    while IFS= read -r _g; do
      [[ -z "$_g" ]] && continue
      # Normalize /**  to /* so bash case * matches recursively (A4 verified).
      _gn="${_g%/**}/*"
      case "$_fp" in
        "$_g"|$_gn) _deny "$_fp matches protected glob $_g"; return 0 ;;
      esac
    done <<'GLOBS'
GLOBS
  fi
  # 2) Delegate-or-deny: agent_id ABSENT => main loop => deny.
  _aid="$(printf '%s' "$_in" | jq -r '.agent_id // empty' 2>/dev/null)" || _aid=""
  if [[ -z "$_aid" ]]; then
    _deny "direct edits from the main loop are denied. Delegate this edit to a coder Eidolon (Vivi) per the routing artifact. Re-issue the edit from within the delegated subagent"
    return 0
  fi
  return 0
}
_main 2>/dev/null || true
