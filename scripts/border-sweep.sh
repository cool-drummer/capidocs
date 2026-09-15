#!/usr/bin/env bash
set -euo pipefail

target="${1:-apps/site/assets/css}"
baseline="${BORDER_BASELINE:-scripts/border-baseline.txt}"
pattern='border[a-zA-Z-]*[[:space:]]*:[[:space:]]*[^;"'"'"']*(#[0-9a-fA-F]{3}|rgb|hsl|var\(--)|border-(t|r|b|l|x|y)?-?\[#|border-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)|borderColor|borderWidth'

control=$(printf 'a { border-color: #ff0000; }\nb { border: 1px solid var(--x); }\n' | grep -cE "$pattern" || true)
if [ "$control" != "2" ]; then
  echo "border-sweep: the pattern failed its control case (matched $control of 2); fix the pattern before trusting any result" >&2
  exit 2
fi

hits=$(git grep -InE "$pattern" -- "$target" | grep -vE 'border-radius|--radius|border-color: transparent|border: 0;|border: none' || true)
current=$(printf '%s\n' "$hits" | grep -c . || true)

if [ "${2:-}" = "--record" ]; then
  printf '%s\n' "$hits" > "$baseline"
  echo "border-sweep: recorded $current existing hits in $baseline"
  exit 0
fi

if [ ! -f "$baseline" ]; then
  echo "border-sweep: no baseline; $current hits in $target"
  printf '%s\n' "$hits"
  exit 1
fi

previous=$(grep -c . "$baseline" || true)
added=$(comm -13 <(cut -d: -f1,3- "$baseline" | sort) <(printf '%s\n' "$hits" | cut -d: -f1,3- | sort) || true)

if [ -n "$added" ]; then
  echo "border-sweep: new decorative borders (justify each against the allowed exceptions or use a tinted surface)"
  printf '%s\n' "$added"
  exit 1
fi

echo "border-sweep: no new borders ($current hits, baseline $previous)"
