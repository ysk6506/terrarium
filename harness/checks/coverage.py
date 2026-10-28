"""Coverage ratchet (REQ-023).

Coverage is measured per package (each layer of ``src/terrarium`` plus ``harness``). Every package
has a floor in ``harness/config/coverage-floor.json``. Floors only go up.

- COV001 package coverage below its floor
- COV002 package has no floor (new package) or floor below the global minimum
- COV003 (with --base) a floor was lowered or removed
- COV004 coverage report missing (run ``make test`` first)
- COV005 ``# pragma: no cover`` over budget, or used without a reason
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
import tokenize
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from harness.common import Violation, find_root, finish, git, load_yaml, rel

CONFIG_PATH = Path("harness/config/tests.yaml")
PRAGMA = "pragma: no cover"


def package_of(path: str) -> str | None:
    parts = Path(path).parts
    if len(parts) >= 3 and parts[0] == "src" and parts[1] == "terrarium":
        return f"terrarium.{parts[2]}" if len(parts) > 3 else "terrarium"
    if parts and parts[0] == "harness":
        return "harness"
    return None


def per_package(report: dict[str, Any], root: Path) -> dict[str, float]:
    """Combined line+branch percentage per package (same formula as coverage.py)."""
    totals: dict[str, list[int]] = {}
    for filename, data in report.get("files", {}).items():
        path = Path(filename)
        name = rel(root, path) if path.is_absolute() else path.as_posix()
        package = package_of(name)
        if package is None:
            continue
        summary = data["summary"]
        bucket = totals.setdefault(package, [0, 0])
        bucket[0] += summary["covered_lines"] + summary.get("covered_branches", 0)
        bucket[1] += summary["num_statements"] + summary.get("num_branches", 0)
    return {
        pkg: 100.0 if total == 0 else 100.0 * hit / total for pkg, (hit, total) in totals.items()
    }


def load_floors(root: Path, config: dict[str, Any]) -> dict[str, float]:
    path = root / config["coverage_floor"]
    return (
        {k: float(v) for k, v in json.loads(path.read_text(encoding="utf-8")).items()}
        if path.exists()
        else {}
    )


def check_report(root: Path, config: dict[str, Any]) -> list[Violation]:
    report_path = root / config["coverage_json"]
    if not report_path.exists():
        return [
            Violation(
                "COV004",
                config["coverage_json"],
                0,
                "coverage report not found",
                "Run `make test` (pytest --cov ... --cov-report=json) before this check.",
            )
        ]
    measured = per_package(json.loads(report_path.read_text(encoding="utf-8")), root)
    floors = load_floors(root, config)
    minimum = float(config["min_floor"])
    out: list[Violation] = []
    for package, percent in sorted(measured.items()):
        floor = floors.get(package)
        if floor is None or floor < minimum:
            out.append(
                Violation(
                    "COV002",
                    config["coverage_floor"],
                    0,
                    f"{package} has no valid floor (needs >= {minimum})",
                    "Run: python -m harness.checks.coverage ratchet to set floors.",
                )
            )
        elif percent + 1e-9 < floor:
            out.append(
                Violation(
                    "COV001",
                    package.replace(".", "/"),
                    0,
                    f"{package} coverage {percent:.1f}% is below its floor {floor:.1f}%",
                    "Add tests for the uncovered code (see the report); never lower the floor.",
                )
            )
    return out


def check_pragmas(root: Path, config: dict[str, Any]) -> list[Violation]:
    out: list[Violation] = []
    count = 0
    for path in sorted((root / "src").rglob("*.py")):
        for token in tokenize.generate_tokens(
            io.StringIO(path.read_text(encoding="utf-8")).readline
        ):
            if token.type == tokenize.COMMENT and PRAGMA in token.string:
                count += 1
                reason = token.string.split(PRAGMA, 1)[1].strip(" -:")
                if len(reason) < 10:
                    out.append(
                        Violation(
                            "COV005",
                            rel(root, path),
                            token.start[0],
                            "pragma: no cover without a reason",
                            "Write '# pragma: no cover - <why this cannot be tested>'.",
                        )
                    )
    if count > int(config["max_pragma_no_cover"]):
        out.append(
            Violation(
                "COV005",
                "src",
                0,
                f"{count} 'pragma: no cover' (budget {config['max_pragma_no_cover']})",
                "Test the code instead of excluding it.",
            )
        )
    return out


def check_floors_against(root: Path, config: dict[str, Any], base: str) -> list[Violation]:
    old_text = git(root, "show", f"{base}:{config['coverage_floor']}")
    if old_text is None:
        return []
    old = {k: float(v) for k, v in json.loads(old_text).items()}
    new = load_floors(root, config)
    return [
        Violation(
            "COV003",
            config["coverage_floor"],
            0,
            f"floor for {pkg} went {value:.1f} -> {new.get(pkg, 'removed')}",
            "Floors only go up. Restore the floor and add tests.",
        )
        for pkg, value in sorted(old.items())
        if pkg not in new or new[pkg] + 1e-9 < value
    ]


def ratchet(root: Path) -> dict[str, float]:
    """Raise each floor to current coverage (rounded down to 0.5). Never lowers a floor."""
    config = load_yaml(root / CONFIG_PATH)
    measured = per_package(
        json.loads((root / config["coverage_json"]).read_text(encoding="utf-8")), root
    )
    floors = load_floors(root, config)
    minimum = float(config["min_floor"])
    for package, percent in measured.items():
        candidate = math.floor(percent * 2) / 2
        floors[package] = max(floors.get(package, minimum), candidate, minimum)
    (root / config["coverage_floor"]).write_text(
        json.dumps(floors, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return floors


def run(root: Path, base: str | None = None) -> list[Violation]:
    config = load_yaml(root / CONFIG_PATH)
    violations = check_report(root, config) + check_pragmas(root, config)
    if base:
        violations.extend(check_floors_against(root, config, base))
    return violations


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Coverage ratchet")
    parser.add_argument("--root", type=Path, default=None)
    sub = parser.add_subparsers(dest="command")
    check = sub.add_parser("check")
    check.add_argument("--base", default=None)
    sub.add_parser("ratchet")
    args = parser.parse_args(argv)
    root = find_root(args.root)
    if args.command == "ratchet":
        for package, floor in sorted(ratchet(root).items()):
            print(f"{package}: {floor:.1f}%")
        return 0
    return finish("coverage", run(root, getattr(args, "base", None)))


if __name__ == "__main__":
    sys.exit(main())
