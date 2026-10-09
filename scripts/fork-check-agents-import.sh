#!/usr/bin/env bash
# scripts/fork-check-agents-import.sh — fork-only heal check for the FORK-AGENTS.md import.
#
# Upstream owns CLAUDE.md. The fork appends ONE line (`@FORK-AGENTS.md`) so Claude Code
# loads FORK-AGENTS.md. An upstream sync can drop that line; this restores it and then
# regenerates llms-full.txt (it inlines CLAUDE.md), then runs upstream's CLAUDE.md size cap so a re-append can never silently break CI.
#
# Usage: bash scripts/fork-check-agents-import.sh [--check]
#   --check   report only, do not modify CLAUDE.md (exit 3 if the line is missing)
#
# Env: GBRAIN_DOC_GUARD_ROOT overrides the repo root (same as the upstream guard).
#
# Exit: 0 healthy (line present or restored, cap ok) | 1 size cap failed
#       2 FORK-AGENTS.md missing | 3 --check and import line missing

set -uo pipefail

ROOT="${GBRAIN_DOC_GUARD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LINE="@FORK-AGENTS.md"
mode="${1:-fix}"

[ -f "$ROOT/FORK-AGENTS.md" ] || { echo "FAIL: FORK-AGENTS.md missing at $ROOT" >&2; exit 2; }
[ -f "$ROOT/CLAUDE.md" ] || { echo "FAIL: CLAUDE.md missing at $ROOT" >&2; exit 2; }

if ! grep -qxF "$LINE" "$ROOT/CLAUDE.md"; then
  if [ "$mode" = "--check" ]; then
    echo "MISSING: '$LINE' not in CLAUDE.md" >&2
    exit 3
  fi
  # Ensure the file ends in a newline, then append the import on its own line.
  [ -n "$(tail -c1 "$ROOT/CLAUDE.md")" ] && printf '\n' >> "$ROOT/CLAUDE.md"
  printf '\n%s\n' "$LINE" >> "$ROOT/CLAUDE.md"
  echo "RESTORED: re-appended '$LINE' to CLAUDE.md (commit this change)"
  # llms-full.txt inlines CLAUDE.md and a test pins it to the generator output.
  if command -v bun >/dev/null 2>&1; then
    (cd "$ROOT" && bun run build:llms >/dev/null) && echo "REGENERATED: llms.txt / llms-full.txt"
  else
    echo "WARN: bun not found; run 'bun run build:llms' before committing" >&2
  fi
fi

bash "$ROOT/scripts/check-key-files-current-state.sh" || exit 1
echo "fork-check-agents-import: ok"
