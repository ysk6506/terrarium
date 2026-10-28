"""Requirement traceability (REQ-020, REQ-023, REQ-025).

``docs/product-specs/requirements.md`` is the single source of requirements. Tests link to them with
``@pytest.mark.req("REQ-NNN")`` (or a module-level ``pytestmark``).

- TRACE001 requirement with no test
- TRACE002 test refers to a requirement that does not exist
- TRACE003 spec/integration test module without any requirement link
- TRACE004 requirement id defined twice
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path

from harness.common import Violation, find_root, finish, rel

REQUIREMENTS = Path("docs/product-specs/requirements.md")
ROW_RE = re.compile(r"^\|\s*(REQ-\d{3})\s*\|")
LINKED_DIRS = ("tests/spec", "tests/integration")


def requirement_ids(root: Path) -> tuple[list[str], list[Violation]]:
    ids: list[str] = []
    out: list[Violation] = []
    for number, line in enumerate(
        (root / REQUIREMENTS).read_text(encoding="utf-8").splitlines(), 1
    ):
        match = ROW_RE.match(line)
        if not match:
            continue
        if match.group(1) in ids:
            out.append(
                Violation(
                    "TRACE004",
                    REQUIREMENTS.as_posix(),
                    number,
                    f"{match.group(1)} defined twice",
                    "Give each requirement a unique id.",
                )
            )
        ids.append(match.group(1))
    return ids, out


def _req_marks(node: ast.AST) -> Iterator[tuple[int, str]]:
    for child in ast.walk(node):
        if (
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Attribute)
            and child.func.attr == "req"
            and child.args
            and isinstance(child.args[0], ast.Constant)
        ):
            yield child.lineno, str(child.args[0].value)


def collect_links(root: Path) -> dict[str, list[tuple[str, int, str]]]:
    """test file -> [(file, line, REQ id)]"""
    links: dict[str, list[tuple[str, int, str]]] = {}
    for path in sorted((root / "tests").rglob("test_*.py")):
        name = rel(root, path)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        links[name] = [(name, line, ident) for line, ident in _req_marks(tree)]
    return links


def run(root: Path) -> list[Violation]:
    ids, violations = requirement_ids(root)
    links = collect_links(root)
    covered = {ident for entries in links.values() for _, _, ident in entries}
    for ident in ids:
        if ident not in covered:
            violations.append(
                Violation(
                    "TRACE001",
                    REQUIREMENTS.as_posix(),
                    0,
                    f"{ident} has no test",
                    f'Write a test marked @pytest.mark.req("{ident}") that would fail if it '
                    "were not met.",
                )
            )
    for name, entries in sorted(links.items()):
        for file, line, ident in entries:
            if ident not in ids:
                violations.append(
                    Violation(
                        "TRACE002",
                        file,
                        line,
                        f"{ident} is not a requirement",
                        f"Use an id from {REQUIREMENTS}.",
                    )
                )
        if name.startswith(LINKED_DIRS) and not entries:
            violations.append(
                Violation(
                    "TRACE003",
                    name,
                    1,
                    "spec/integration test is not linked to a requirement",
                    'Add pytestmark = pytest.mark.req("REQ-NNN") or per-test marks.',
                )
            )
    return violations


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Requirement traceability")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(argv)
    return finish("traceability", run(find_root(args.root)))


if __name__ == "__main__":
    sys.exit(main())
