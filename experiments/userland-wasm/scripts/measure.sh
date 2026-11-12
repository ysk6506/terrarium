#!/usr/bin/env bash
# Runs the measuring scripts under the shared heavy lock (nothing else heavy runs at the same time) and writes
# results/*.json|txt. Usage: measure.sh <what>   what: latency | roundtrip | memory | gaps | determinism | interrupt | semantics
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
R="$ROOT/experiments/userland-wasm/results"
B="experiments/userland-wasm/bench"
mkdir -p "$R"
cd "$ROOT"
locked() { timeout 1500 flock -w 900 /tmp/terrarium-heavy.lock "$@"; }
case "$1" in
  latency)
    locked env npx tsx $B/latency.ts 200 > "$R/latency-old.json"
    locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=1 TERRARIUM_WASM_WORKERS=2 npx tsx $B/latency.ts 200 > "$R/latency-wasm-pool2.json"
    locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=1 TERRARIUM_WASM_WORKERS=1 npx tsx $B/latency.ts 200 > "$R/latency-wasm-pool1.json"
    locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=0 TERRARIUM_WASM_WORKERS=1 npx tsx $B/latency.ts 200 > "$R/latency-wasm-fresh.json"
    ;;
  latency-think)
    locked env THINK_MS=40 TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=1 TERRARIUM_WASM_WORKERS=2 npx tsx $B/latency.ts 200 > "$R/latency-wasm-pool2-think.json"
    locked env THINK_MS=40 TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=1 TERRARIUM_WASM_WORKERS=1 npx tsx $B/latency.ts 200 > "$R/latency-wasm-pool1-think.json"
    locked env THINK_MS=40 TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=0 TERRARIUM_WASM_WORKERS=1 npx tsx $B/latency.ts 200 > "$R/latency-wasm-fresh-think.json"
    ;;
  roundtrip) locked npx tsx $B/roundtrip.ts > "$R/roundtrip.json" ;;
  memory) locked node --expose-gc --import tsx $B/memory.ts > "$R/memory.json" ;;
  gaps)
    locked env npx tsx $B/gaps.ts old
    locked env TERRARIUM_SHELL=wasm npx tsx $B/gaps.ts wasm
    locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_AWK=ts npx tsx $B/gaps.ts wasm-awkts
    ;;
  determinism)
    locked env TERRARIUM_SHELL=wasm npx tsx $B/determinism.ts > "$R/det-1.txt"
    locked env TERRARIUM_SHELL=wasm npx tsx $B/determinism.ts > "$R/det-2.txt"
    locked env TERRARIUM_SHELL=wasm TZ=Asia/Seoul LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8 npx tsx $B/determinism.ts > "$R/det-3-locale.txt"
    locked env TERRARIUM_SHELL=wasm TZ=America/Los_Angeles LC_ALL=tr_TR.UTF-8 node --max-old-space-size=300 --jitless --import tsx $B/determinism.ts > "$R/det-4-jitless.txt"
    locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=0 TERRARIUM_WASM_WORKERS=1 npx tsx $B/determinism.ts > "$R/det-5-fresh.txt"
    locked env npx tsx $B/determinism.ts > "$R/det-old-1.txt"
    locked env npx tsx $B/determinism.ts > "$R/det-old-2.txt"
    ;;
  interrupt) locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_TIMEOUT_MS=2000 npx tsx $B/interrupt.ts > "$R/interrupt.txt" 2>&1 ;;
  semantics)
    locked env TERRARIUM_SHELL=wasm npx tsx $B/semantics.ts > "$R/semantics-wasm.txt" 2>&1
    locked env TERRARIUM_SHELL=wasm TERRARIUM_WASM_SLEEP=advance npx tsx $B/semantics.ts > "$R/semantics-wasm-advance.txt" 2>&1
    locked env npx tsx $B/semantics.ts > "$R/semantics-old.txt" 2>&1
    ;;
esac
echo "done $1"
