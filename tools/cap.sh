#!/usr/bin/env bash
set -euo pipefail
[ "$#" -ge 2 ] || { echo "usage: cap.sh <verb> <cmd> [args...]" >&2; exit 2; }
VERB="$1"; shift
LOG_DIR="${TMPDIR:-$PWD/.prism-cache/tmp}/loupe"
mkdir -p "$LOG_DIR"
LOG="$(mktemp "$LOG_DIR/${VERB}-XXXXXX.log")"
if [[ "${LOUPE_LOG_FD:-}" =~ ^([3-9]|[1-9][0-9]+)$ ]]; then
  printf '%s\n' "$LOG" >&"$LOUPE_LOG_FD"
fi
set +e; "$@" >"$LOG" 2>&1; RC=$?; set -e
if [ "${LOUPE_FULL_OUTPUT:-0}" = "1" ]; then cat "$LOG"; exit "$RC"; fi
[ "$RC" -ne 0 ] || exit 0
set +o pipefail
FOOTER="full log: $LOG"
FOOTER_B=$(LC_ALL=C printf '%s' "$FOOTER" | wc -c)
BYTES=$(wc -c <"$LOG"); LINES=$(wc -l <"$LOG"); UNTERM=0
if [ "$BYTES" -gt 0 ] && [ "$(tail -c 1 "$LOG" | wc -l)" -eq 0 ]; then
  UNTERM=1; LINES=$((LINES + 1))
fi
BUDGET=$((3072 - FOOTER_B - 1 - UNTERM))
if [ "$LINES" -le 23 ] && [ "$BYTES" -le "$BUDGET" ] && [ "$BUDGET" -ge 0 ]; then
  cat "$LOG"
  [ "$UNTERM" -eq 0 ] || printf '\n'
  printf '%s\n' "$FOOTER"
else
  SEP="... (truncated) ..."
  AVAIL=$((3072 - FOOTER_B - ${#SEP} - 4))
  if [ "$AVAIL" -ge 2 ]; then
    HEAD_B=$((AVAIL * 2 / 3)); TAIL_B=$((AVAIL - HEAD_B))
    head -c "$HEAD_B" "$LOG" | head -n 14
    printf '\n%s\n' "$SEP"
    tail -c "$TAIL_B" "$LOG" | tail -n 5
    printf '\n%s\n' "$FOOTER"
  else
    LC_ALL=C printf '%s' "$FOOTER" | head -c 3071
    printf '\n'
  fi
fi
exit "$RC"
