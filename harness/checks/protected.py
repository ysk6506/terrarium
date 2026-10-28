"""Protected paths (REQ-021, REQ-023): guardrails cannot be loosened quietly.

Rules:
- PROT001 a protected path changed (vs ``--base``) without an ADR, added in the same change, that
  lists it in ``touches_protected``
- PROT002 the ADR that authorizes the change is not sealed
- PROT003 ``.github/CODEOWNERS`` does not cover every protected path

Without ``--base`` only PROT003 is checked (there is no diff to judge).
"""

from __future__ import annotations

import argparse
import fnmatch
import sys
from collections.abc import Sequence
from pathlib import Path

from harness.checks.docprint import body_fingerprint
from harness.common import Violation, find_root, finish, git, split_front_matter

PATTERNS_PATH = Path("harness/config/protected-paths.txt")
CODEOWNERS_PATH = Path(".github/CODEOWNERS")
ADR_DIR = "docs/design-docs/adr/"

# Ratchet files live under a protected path but change routinely in one safe direction.
# Each is guarded by its own check against the base ref instead of needing an ADR.
RATCHET_FILES = {
    "harness/config/test-lock.json": "testguard TLOCK005 (changes only via amendment ADR)",
    "harness/config/debt-baseline.json": "debt DEBT033 (entries may only be removed or lowered)",
    "harness/config/coverage-floor.json": "coverage COV003 (floors may only go up)",
}


def load_patterns(root: Path) -> list[str]:
    lines = (root / PATTERNS_PATH).read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def matches(path: str, pattern: str) -> bool:
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-2])
    return fnmatch.fnmatchcase(path, pattern)


def changed_files(root: Path, base: str) -> list[tuple[str, str]]:
    """(status, path) of files changed between ``base`` and the working tree (incl. untracked)."""
    out = git(root, "diff", "--name-status", "--no-renames", base) or ""
    changes = [tuple(line.split("\t", 1)) for line in out.splitlines() if "\t" in line]
    untracked = git(root, "ls-files", "--others", "--exclude-standard") or ""
    changes += [("A", path) for path in untracked.splitlines() if path]
    return [(status, path) for status, path in changes]


def authorizations(
    root: Path, changes: list[tuple[str, str]]
) -> tuple[dict[str, str], list[Violation]]:
    """Map pattern -> ADR for ADRs *added* in this change."""
    granted: dict[str, str] = {}
    problems: list[Violation] = []
    for status, path in changes:
        if status != "A" or not path.startswith(ADR_DIR) or not path.endswith(".md"):
            continue
        file = root / path
        if not file.exists():
            continue
        data, body = split_front_matter(file.read_text(encoding="utf-8"))
        touches = list((data or {}).get("touches_protected") or [])
        if not touches:
            continue
        if (data or {}).get("decision_hash") != body_fingerprint(body):
            problems.append(
                Violation(
                    "PROT002",
                    path,
                    1,
                    "ADR authorizing protected changes is not sealed",
                    f"Seal it: python -m harness.checks.docs seal-adr {path}",
                )
            )
            continue
        for item in touches:
            granted[str(item)] = path
    return granted, problems


def check_diff(root: Path, base: str) -> list[Violation]:
    patterns = load_patterns(root)
    changes = changed_files(root, base)
    granted, out = authorizations(root, changes)
    for status, path in changes:
        if status == "A" and path.startswith(ADR_DIR):
            continue  # adding a new ADR is how decisions are made; editing old ones is DOC070
        if path in RATCHET_FILES:
            continue
        hit = next((p for p in patterns if matches(path, p)), None)
        if hit is None:
            continue
        if not any(matches(path, g) or g == hit for g in granted):
            out.append(
                Violation(
                    "PROT001",
                    path,
                    0,
                    f"protected path changed (matches '{hit}') without authorization",
                    "Guardrails change only by decision: add a sealed ADR in this change whose "
                    f"touches_protected lists '{path}' (or '{hit}') and explains why the guard "
                    "must change.",
                )
            )
    return out


def check_codeowners(root: Path) -> list[Violation]:
    path = root / CODEOWNERS_PATH
    owned = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                owned.append(line.split()[0].lstrip("/"))
    missing = [p for p in load_patterns(root) if p not in owned]
    if not missing:
        return []
    return [
        Violation(
            "PROT003",
            CODEOWNERS_PATH.as_posix(),
            0,
            f"CODEOWNERS misses: {', '.join(missing)}",
            "Add a line '/<pattern> @owner' for each protected path.",
        )
    ]


def run(root: Path, base: str | None = None) -> list[Violation]:
    violations = check_codeowners(root)
    if base:
        violations.extend(check_diff(root, base))
    return violations


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Protected path changes need an ADR")
    parser.add_argument("--root", type=Path, default=None)
    parser.add_argument("--base", default=None)
    args = parser.parse_args(argv)
    return finish("protected-paths", run(find_root(args.root), args.base))


if __name__ == "__main__":
    sys.exit(main())
