"""Run every structural check and print one combined verdict (``make check`` uses this).

Order matters only for cost: cheap static checks first. Tests and coverage run separately
(``make test``) because they produce ``coverage.json`` that the coverage check reads.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from harness.checks import architecture, coverage, debt, docs, protected, testguard, traceability
from harness.common import Violation, find_root, finish


def checks(
    root: Path, base: str | None, with_coverage: bool
) -> list[tuple[str, Callable[[], list[Violation]]]]:
    plan: list[tuple[str, Callable[[], list[Violation]]]] = [
        ("architecture", lambda: architecture.run(root)),
        ("docs", lambda: docs.run(root)),
        ("debt", lambda: debt.run(root, base=base)),
        ("test-integrity", lambda: testguard.run(root, base)),
        ("traceability", lambda: traceability.run(root)),
        ("protected-paths", lambda: protected.run(root, base)),
    ]
    if with_coverage:
        plan.append(("coverage", lambda: coverage.run(root, base)))
    return plan


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run all harness checks")
    parser.add_argument("--root", type=Path, default=None)
    parser.add_argument("--base", default=None, help="git ref to diff against (CI: origin/main)")
    parser.add_argument("--with-coverage", action="store_true", help="also check coverage.json")
    args = parser.parse_args(argv)
    root = find_root(args.root)
    failed = 0
    for name, run in checks(root, args.base, args.with_coverage):
        failed += finish(name, run())
    print("\nALL CHECKS PASSED" if not failed else f"\n{failed} CHECK(S) FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
