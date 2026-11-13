#!/usr/bin/env bash
# Builds bin/terrarium-sh.wasm (Go -> WASI preview 1) from the pinned sources (ADR-0200).
#
# Normal CI and normal work do not run this: the .wasm is in the repository, and `node scripts/lock.mjs check` says it
# belongs to the sources. Run it after changing go/, patches/ or the pins; then `node scripts/lock.mjs write`.
#
# Needs: Go of the pinned version (GO=<binary>; default: go on PATH), the version control tool, and network access to
# GitHub only. The Go module proxy is not used: every dependency is cloned from GitHub at a pinned commit and wired in
# with `replace` directives in a throw-away copy of go.mod.
#
# Env: GO (go binary), VENDOR (clone directory, default: .vendor next to this folder).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO="${GO:-go}"
VENDOR="${VENDOR:-$HERE/.vendor}"
BUILD="$HERE/.build"
OUT="$HERE/bin"
VCS=git
pin() { node "$HERE/scripts/lock.mjs" pin "$1"; }

want_go="$(pin go\|version)"
have_go="$(GOTOOLCHAIN=local "$GO" env GOVERSION)"
if [ "$have_go" != "go$want_go" ]; then
  echo "build.sh: the pinned Go is go$want_go, but $GO is $have_go" >&2
  exit 1
fi

clone() { # name module-path
  local repo tag commit got
  repo="$(pin "modules|$2|repo")"; tag="$(pin "modules|$2|tag")"; commit="$(pin "modules|$2|commit")"
  if [ ! -d "$VENDOR/$1" ]; then
    mkdir -p "$VENDOR"
    $VCS clone --quiet --depth 1 --branch "$tag" "$repo" "$VENDOR/$1"
  fi
  got="$($VCS -C "$VENDOR/$1" rev-parse HEAD)"
  if [ "$got" != "$commit" ]; then
    echo "build.sh: $2 $tag is $got, the lock pins $commit" >&2
    exit 1
  fi
}
clone sh mvdan.cc/sh/v3
clone goawk github.com/benhoyt/goawk
clone x-sys golang.org/x/sys
clone x-term golang.org/x/term

# The clones stay pristine; patches go on copies (without the clones' own history folder).
rm -rf "$BUILD"
mkdir -p "$BUILD/src" "$BUILD/mods"
for m in sh goawk; do
  cp -r "$VENDOR/$m" "$BUILD/mods/$m"
  rm -rf "$BUILD/mods/$m/.$VCS"
done
(cd "$BUILD/mods/sh" && patch -p1 --quiet < "$HERE/patches/mvdan-sh.patch")
(cd "$BUILD/mods/goawk" && patch -p1 --quiet < "$HERE/patches/goawk.patch")

cp "$HERE"/go/*.go "$BUILD/src/"
cp "$HERE/go/go.mod" "$BUILD/src/go.mod"
cat >> "$BUILD/src/go.mod" <<EOT

replace mvdan.cc/sh/v3 => $BUILD/mods/sh
replace github.com/benhoyt/goawk => $BUILD/mods/goawk
replace golang.org/x/sys => $VENDOR/x-sys
replace golang.org/x/term => $VENDOR/x-term
EOT

mkdir -p "$OUT"
cd "$BUILD/src"
export GOTOOLCHAIN=local GOWORK=off GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off GONOSUMCHECK=1 GOPRIVATE='*' CGO_ENABLED=0
GOOS=wasip1 GOARCH=wasm "$GO" build -trimpath -buildvcs=false -ldflags="-s -w -buildid=" -o "$OUT/terrarium-sh.wasm" .
ls -l "$OUT/terrarium-sh.wasm"
