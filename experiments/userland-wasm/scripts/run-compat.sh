#!/usr/bin/env bash
# Runs the given spec files one at a time, under the shared heavy lock, with the wasm shell switched on, and writes one
# JSON report per file to results/<label>/. Usage: run-compat.sh <label> <file>...   (env TERRARIUM_* pass through)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LABEL="$1"; shift
OUT="$ROOT/experiments/userland-wasm/results/$LABEL"
mkdir -p "$OUT"
cd "$ROOT"
for f in "$@"; do
  name="$(basename "$f" .test.ts)"
  start=$(date +%s)
  TERRARIUM_SHELL="${TERRARIUM_SHELL:-wasm}" timeout 1500 flock -w 900 /tmp/terrarium-heavy.lock \
    npx vitest run "$f" --reporter=json --outputFile="$OUT/$name.json" > "$OUT/$name.log" 2>&1
  echo "$name rc=$? $(( $(date +%s) - start ))s"
done
