#!/usr/bin/env python3
"""Rebuild dmtf-schemas.json.gz: add schemas to the bundle the Redfish validator checks against.

    git clone --depth 1 --filter=blob:none --sparse https://github.com/DMTF/Redfish-Publications /tmp/rf/pub
    git -C /tmp/rf/pub sparse-checkout set json-schema
    python3 tests/spec/redfish-schemas/build-bundle.py /tmp/rf/pub Circuit PowerDistribution ...
    python3 tests/spec/redfish-schemas/build-bundle.py /tmp/rf/pub ServiceRoot.v1_16_0   # one exact version

Each name adds its newest versioned schema (`Name.vX_Y_Z.json`) and the plain `Name.json` beside it: the
plain file defines the enumerations the versioned one points to, so without it a wrong enum value would pass.
Files already in the bundle stay, at the version they have, unless `--upgrade` is given.
"""
import gzip
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
BUNDLE = HERE / "dmtf-schemas.json.gz"


def newest(directory: Path, name: str) -> Path:
    versioned = []
    for p in directory.glob(f"{name}.v*.json"):
        m = re.fullmatch(re.escape(name) + r"\.v(\d+)_(\d+)_(\d+)\.json", p.name)
        if m:
            versioned.append((tuple(int(x) for x in m.groups()), p))
    if versioned:
        return max(versioned)[1]
    plain = directory / f"{name}.json"
    if plain.exists():
        return plain
    sys.exit(f"{name}: no schema in {directory}")


def base(file: str) -> str:
    return re.sub(r"(\.v\d+_\d+_\d+)?\.json$", "", file)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    upgrade = "--upgrade" in sys.argv
    clone, names = Path(args[0]), args[1:]
    directory = clone / "json-schema"
    bundle = json.loads(gzip.open(BUNDLE).read()) if BUNDLE.exists() else {"files": {}}
    files = bundle["files"]
    names = names + sorted({base(f) for f in files})
    for exact in [n for n in names if re.search(r"\.v\d+_\d+_\d+$", n)]:
        files[f"{exact}.json"] = json.loads((directory / f"{exact}.json").read_text(encoding="utf-8"))
        print(f"+ {exact}.json")
    names = [n for n in names if not re.search(r"\.v\d+_\d+_\d+$", n)]
    for name in names:
        plain = directory / f"{name}.json"
        if plain.exists() and plain.name not in files:
            files[plain.name] = json.loads(plain.read_text(encoding="utf-8"))
            print(f"+ {plain.name}")
        has = any(f == f"{name}.json" or re.fullmatch(re.escape(name) + r"\.v\d+_\d+_\d+\.json", f) for f in files)
        versioned = any(re.fullmatch(re.escape(name) + r"\.v\d+_\d+_\d+\.json", f) for f in files)
        if has and not upgrade and (versioned or not any(directory.glob(f"{name}.v*.json"))):
            continue
        path = newest(directory, name)
        for old in [f for f in files if re.fullmatch(re.escape(name) + r"\.v\d+_\d+_\d+\.json", f)]:
            del files[old]
        files[path.name] = json.loads(path.read_text(encoding="utf-8"))
        print(f"+ {path.name}")
    bundle["source"] = "https://github.com/DMTF/Redfish-Publications"
    bundle["commit"] = subprocess.check_output(["git", "-C", str(clone), "rev-parse", "HEAD"], text=True).strip()
    bundle["date"] = subprocess.check_output(["git", "-C", str(clone), "log", "-1", "--format=%cs"], text=True).strip()
    bundle["license"] = "BSD-3-Clause"
    bundle["files"] = dict(sorted(files.items()))
    with gzip.GzipFile(BUNDLE, "wb", mtime=0) as out:
        out.write(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    print(f"{len(files)} files, {BUNDLE.stat().st_size // 1024} KiB")


main()
