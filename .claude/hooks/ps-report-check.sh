#!/usr/bin/env bash
# Prosjektsentral Stop hook (PS-REPORT v1).
#   check (default): read the Stop hook JSON on stdin. Ask Claude once to report this
#                    session to Prosjektsentral unless the marker says it already did
#                    for this session and this commit.
#   mark [session]:  write the marker after reporting.
# Safety: never blocks twice in a row (stop_hook_active), and exits 0 on any internal
# error so it can never break a session. Set PS_REPORT_DISABLE=1 to turn it off.

MARK_REL=".claude/.ps-reported"

repo_root() {
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then printf '%s' "$CLAUDE_PROJECT_DIR"; return; fi
  git rev-parse --show-toplevel 2>/dev/null || pwd
}
head_sha() { git -C "$1" rev-parse HEAD 2>/dev/null || printf 'nogit'; }

do_mark() {
  local root sid
  root=$(repo_root) || return 0
  sid="${1:-${CLAUDE_CODE_SESSION_ID:-unknown}}"
  mkdir -p "$root/.claude" 2>/dev/null || return 0
  printf '%s %s\n' "$sid" "$(head_sha "$root")" > "$root/$MARK_REL" 2>/dev/null || return 0
  printf 'Prosjektsentral: marked as reported (session %s).\n' "$sid"
}

do_check() {
  [ "${PS_REPORT_DISABLE:-}" = "1" ] && return 0
  local input sid root cur msid mhead
  input=$(cat 2>/dev/null) || return 0
  # Not a Stop hook payload (empty or foreign input): do nothing.
  printf '%s' "$input" | grep -q '"session_id"' || return 0
  # Already continuing because of a stop hook: never block again (no loops).
  if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then return 0; fi
  sid=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_.:-]*\)".*/\1/p' | head -n 1)
  [ -n "$sid" ] || sid="unknown"
  root=$(repo_root) || return 0
  cur=$(head_sha "$root")
  if [ -f "$root/$MARK_REL" ]; then
    read -r msid mhead < "$root/$MARK_REL" 2>/dev/null || true
    if [ "$msid" = "$sid" ] && [ "$mhead" = "$cur" ]; then return 0; fi
  fi
  printf '{"decision":"block","reason":"Prosjektsentral: rapporter denne økta før du avslutter / report this session to Prosjektsentral before you finish. Follow PS-REPORT v1 (section \\"Prosjektsentral reporting\\" in CLAUDE.md): read projects + this item, then one batch write. Afterwards run: bash .claude/hooks/ps-report-check.sh mark %s . If this session did no meaningful work, or this work is already reported, only run the mark command."}\n' "$sid"
}

case "${1:-check}" in
  mark) do_mark "${2:-}" || true ;;
  *) do_check || true ;;
esac
exit 0
