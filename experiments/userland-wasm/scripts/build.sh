#!/usr/bin/env bash
# Builds experiments/userland-wasm/bin/terrarium-sh.wasm (Go -> WASI preview 1).
#
# Needs: Go >= 1.26 (mvdan/sh v3.14.1 says `go 1.26.0`), git, network access to GitHub only.
# The Go module proxy and golang.org are not needed: every dependency is cloned from its GitHub mirror and wired in
# with `replace` directives in a throw-away copy of go.mod (the committed go.mod stays clean).
#
# Env: GO (go binary, default: go), VENDOR (clone directory, default: experiments/userland-wasm/.vendor).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO="${GO:-go}"
VENDOR="${VENDOR:-$ROOT/.vendor}"
BUILD="$ROOT/.build"
OUT="$ROOT/bin"

SH_TAG="v3.14.1"      # mvdan.cc/sh  (BSD-3-Clause, LICENSE in the repository root)
AWK_TAG="v1.32.0"     # goawk        (MIT, LICENSE.txt in the repository root)
SYS_TAG="v0.47.0"     # golang.org/x/sys  (BSD-3-Clause)
TERM_TAG="v0.45.0"    # golang.org/x/term (BSD-3-Clause)

clone() { # name url tag
  if [ ! -d "$VENDOR/$1/.git" ]; then
    mkdir -p "$VENDOR"
    git clone --quiet --depth 1 --branch "$3" "$2" "$VENDOR/$1"
  fi
}
clone sh "https://github.com/mvdan/sh" "$SH_TAG"
clone goawk "https://github.com/benhoyt/goawk" "$AWK_TAG"
clone x-sys "https://github.com/golang/sys" "$SYS_TAG"
clone x-term "https://github.com/golang/term" "$TERM_TAG"

# Patches (small, kept as scripts so the clones stay pristine on disk until a build):
#   sh: WASI has no OS pipes, so use the in-process pipes of the js/wasm port (stdin_js.go) on wasip1 as well.
rm -rf "$BUILD"
mkdir -p "$BUILD/src" "$BUILD/mods"
cp -r "$VENDOR/sh" "$BUILD/mods/sh"
cp -r "$VENDOR/goawk" "$BUILD/mods/goawk"
# (the file name suffix _js is an implicit GOOS constraint, so the file is renamed as well)
mv "$BUILD/mods/sh/interp/stdin_js.go" "$BUILD/mods/sh/interp/stdin_inproc.go"
sed -i 's#^//go:build js$#//go:build js || wasip1#' "$BUILD/mods/sh/interp/stdin_inproc.go"
sed -i 's#^//go:build !js$#//go:build !js \&\& !wasip1#' "$BUILD/mods/sh/interp/stdin_os.go"
for p in "$ROOT"/patches/*.patch; do
  [ -e "$p" ] || continue
  (cd "$BUILD/mods/goawk" && patch -p1 --quiet < "$p")
done

cp "$ROOT"/go/*.go "$BUILD/src/"
cp "$ROOT/go/go.mod" "$BUILD/src/go.mod"
cat >> "$BUILD/src/go.mod" <<EOF

replace mvdan.cc/sh/v3 => $BUILD/mods/sh
replace github.com/benhoyt/goawk => $BUILD/mods/goawk
replace golang.org/x/sys => $VENDOR/x-sys
replace golang.org/x/term => $VENDOR/x-term
EOF

mkdir -p "$OUT"
cd "$BUILD/src"
export GOTOOLCHAIN=local GOWORK=off GOFLAGS=-mod=mod GOPROXY=off GONOSUMDB='*' GONOSUMCHECK=1 GOPRIVATE='*' GOSUMDB=off CGO_ENABLED=0
GOOS=wasip1 GOARCH=wasm "$GO" build -trimpath -ldflags="-s -w" -o "$OUT/terrarium-sh.wasm" .
ls -l "$OUT/terrarium-sh.wasm"
