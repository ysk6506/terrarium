"""Test integrity (REQ-023): stop agents from making tests pass by changing the tests.

Defense in depth, from cheapest to strongest:

1. Static rules on every test (always on)
   TEST001 test without any assertion      TEST002 skip/xfail without a TD-NNNN reason
   TEST003 trivially true assertion        TEST004 failure swallowed by try/except
2. Configuration rules: pytest/coverage settings and conftest hooks that change *which* tests run
   TCFG001 forbidden pytest addopts        TCFG002 forbidden conftest hook/variable
   TCFG003 coverage excludes code          TCFG004 second pytest config file
3. The test lock (``harness/config/test-lock.json``): every test, helper, fixture and expected-data
   file is fingerprinted. Existing entries cannot change or vanish without an *amendment ADR*
   (``amends_tests`` + ``test_change_reason``), so the decision leaves a permanent trace.
   TLOCK001 locked item changed   TLOCK002 locked item removed   TLOCK003 new item not locked
   TLOCK004 amendment ADR missing/unsealed/does not list the item
   TLOCK005 (with --base) lock differs from the base ref without a new amendment ADR

The lock cannot stop a determined actor who edits the lock, forges an ADR *and* may edit
``harness/``. That last step is closed outside the repo: ``harness/``, the lock and the ADR
directory are protected paths (see ``protected.py``) enforced by CODEOWNERS + branch protection.
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import sys
import tomllib
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from harness.checks.docprint import body_fingerprint
from harness.checks.testunits import (  # noqa: F401  (re-exported: public API of this check)
    CONFIG_PATH,
    TD_RE,
    Config,
    Unit,
    _is_test_name,
    _skip_calls,
    assign_names,
    count_assertions,
    current_units,
    data_files,
    dotted,
    iter_test_files,
)
from harness.common import (
    Violation,
    find_root,
    finish,
    git,
    rel,
    split_front_matter,
    today,
)

LOCK_VERSION = 1
AMEND_HINT = (
    "A failing test means the code is wrong, not the test. Fix the code. Only if the *requirement* "
    "changed: update docs/product-specs/requirements.md, write an ADR with amends_tests + "
    "test_change_reason, seal it, then run: python -m harness.checks.testguard lock --amend <adr>"
)

# --------------------------------------------------------------------------- static rules


def _is_trivially_true(test: ast.expr) -> bool:
    if isinstance(test, ast.Constant):
        return bool(test.value)
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        return isinstance(test.operand, ast.Constant) and not test.operand.value
    if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.Or):
        return any(_is_trivially_true(v) for v in test.values)
    if isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq):
        return ast.dump(test.left) == ast.dump(test.comparators[0])
    return False


def _swallows(handler: ast.ExceptHandler) -> bool:
    broad = handler.type is None or dotted(handler.type) in {"Exception", "BaseException"}
    reraises = any(
        isinstance(n, ast.Raise) or (isinstance(n, ast.Call) and dotted(n.func) == "pytest.fail")
        for n in ast.walk(handler)
    )
    return broad and not reraises


def _has_td_reason(node: ast.AST) -> bool:
    return any(
        isinstance(c, ast.Constant) and isinstance(c.value, str) and TD_RE.search(c.value)
        for c in ast.walk(node)
    )


def _test_functions(tree: ast.AST) -> Iterator[ast.FunctionDef | ast.AsyncFunctionDef]:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and _is_test_name(node.name):
            yield node


def static_violations(root: Path, path: Path) -> list[Violation]:
    name = rel(root, path)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[Violation] = []
    for func in [] if path.name == "conftest.py" else _test_functions(tree):
        if count_assertions(func) == 0:
            out.append(
                Violation(
                    "TEST001",
                    name,
                    func.lineno,
                    f"{func.name} asserts nothing",
                    "Assert the behavior under test; a test that cannot fail proves nothing.",
                )
            )
        for node in ast.walk(func):
            if isinstance(node, ast.Assert) and _is_trivially_true(node.test):
                out.append(
                    Violation(
                        "TEST003",
                        name,
                        node.lineno,
                        "assertion is always true",
                        "Assert a real expectation about the result.",
                    )
                )
            if isinstance(node, ast.ExceptHandler) and _swallows(node):
                out.append(
                    Violation(
                        "TEST004",
                        name,
                        node.lineno,
                        "broad except swallows failures inside a test",
                        "Catch a specific exception, or use pytest.raises.",
                    )
                )
    out.extend(_skip_violations(name, tree))
    return out


def _skip_violations(name: str, tree: ast.AST) -> list[Violation]:
    out: list[Violation] = []
    for node in _skip_calls(tree):
        if not _has_td_reason(node):
            out.append(
                Violation(
                    "TEST002",
                    name,
                    getattr(node, "lineno", 0),
                    "skip/xfail without a debt reference",
                    "Register debt in docs/exec-plans/tech-debt.yaml and write "
                    "reason='TD-NNNN: why', or fix the test's cause.",
                )
            )
    return out


# --------------------------------------------------------------------------- config rules


def config_violations(root: Path, config: Config) -> list[Violation]:
    out: list[Violation] = []
    pyproject = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    tool = pyproject.get("tool", {})
    addopts = str(tool.get("pytest", {}).get("ini_options", {}).get("addopts", "")).split()
    for option in addopts:
        bare = option.split("=", 1)[0]
        if bare in config.forbidden_addopts:
            out.append(
                Violation(
                    "TCFG001",
                    "pyproject.toml",
                    0,
                    f"pytest addopts contains {option}",
                    "Remove it: every test must run on every run.",
                )
            )
    out.extend(_coverage_config_violations(tool.get("coverage", {}), config))
    for stray in ("pytest.ini", "tox.ini", "setup.cfg", ".coveragerc"):
        if (root / stray).exists():
            out.append(
                Violation(
                    "TCFG004",
                    stray,
                    0,
                    "second pytest/coverage config file",
                    "Keep all test configuration in pyproject.toml (it is protected).",
                )
            )
    for directory in config.test_dirs:
        for path in sorted((root / directory).rglob("conftest.py")):
            out.extend(_conftest_violations(root, config, path))
    return out


def _coverage_config_violations(coverage: dict[str, Any], config: Config) -> list[Violation]:
    out: list[Violation] = []
    run, report = coverage.get("run", {}), coverage.get("report", {})
    if run.get("omit") or report.get("omit"):
        out.append(
            Violation(
                "TCFG003",
                "pyproject.toml",
                0,
                "coverage 'omit' hides code from coverage",
                "Remove omit; cover the code or delete it.",
            )
        )
    if report.get("exclude_also"):
        out.append(
            Violation(
                "TCFG003",
                "pyproject.toml",
                0,
                "coverage 'exclude_also' is not allowed",
                "Use only the allowed exclude_lines.",
            )
        )
    extra = set(report.get("exclude_lines", [])) - set(config.allowed_exclude_lines)
    if extra:
        out.append(
            Violation(
                "TCFG003",
                "pyproject.toml",
                0,
                f"coverage exclude_lines not allowed: {sorted(extra)}",
                "Remove them.",
            )
        )
    if float(report.get("fail_under", config.min_floor)) < config.min_floor:
        out.append(
            Violation(
                "TCFG003",
                "pyproject.toml",
                0,
                "coverage fail_under below the minimum floor",
                f"Keep it >= {config.min_floor}.",
            )
        )
    return out


def _conftest_violations(root: Path, config: Config, path: Path) -> list[Violation]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[Violation] = []
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            names = [node.name]
        elif isinstance(node, ast.Assign | ast.AnnAssign):
            names = assign_names(node)
        for name in names:
            if name in config.forbidden_conftest_names:
                out.append(
                    Violation(
                        "TCFG002",
                        rel(root, path),
                        getattr(node, "lineno", 0),
                        f"conftest defines '{name}', which changes which tests run or how "
                        "they report",
                        "Remove it. Select tests on the command line, not in code.",
                    )
                )
    return out


# --------------------------------------------------------------------------- lock


def load_lock(root: Path, config: Config) -> dict[str, Any]:
    path = root / config.lock
    if not path.exists():
        return {"version": LOCK_VERSION, "entries": {}, "removed": {}}
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("entries", {})
    data.setdefault("removed", {})
    return data


def save_lock(root: Path, config: Config, lock: dict[str, Any]) -> None:
    (root / config.lock).write_text(
        json.dumps(lock, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )


def entry_for(unit: Unit, now: dt.date, amended_by: str | None = None) -> dict[str, Any]:
    return {
        "kind": unit.kind,
        "hash": unit.digest,
        "asserts": unit.asserts,
        "literals": list(unit.literals),
        "tolerances": list(unit.tolerances),
        "skips": unit.skips,
        "added": now.isoformat(),
        "amended_by": amended_by,
    }


def describe_change(entry: dict[str, Any], unit: Unit) -> str:
    notes: list[str] = []
    if unit.kind == "test":
        if unit.asserts < entry.get("asserts", 0):
            notes.append(f"assertions {entry['asserts']} -> {unit.asserts}")
        if list(unit.literals) != entry.get("literals", []):
            notes.append("expected values in assertions changed")
        old_tol = entry.get("tolerances", [])
        if any(new > old for new, old in zip(unit.tolerances, old_tol, strict=False)) or len(
            unit.tolerances
        ) > len(old_tol):
            notes.append("approx tolerance loosened")
        if unit.skips > entry.get("skips", 0):
            notes.append("skip/xfail added")
    return "; ".join(notes) or "body changed"


def lock_violations(root: Path, config: Config, units: dict[str, Unit]) -> list[Violation]:
    lock = load_lock(root, config)
    entries: dict[str, Any] = lock["entries"]
    out: list[Violation] = []
    for key, unit in sorted(units.items()):
        entry = entries.get(key)
        if entry is None:
            out.append(
                Violation(
                    "TLOCK003",
                    unit.path,
                    unit.line,
                    f"{key} is not in the test lock",
                    "Run: python -m harness.checks.testguard lock (appends new items only).",
                )
            )
        elif entry["hash"] != unit.digest:
            out.append(
                Violation(
                    "TLOCK001",
                    unit.path,
                    unit.line,
                    f"locked item {key} changed ({describe_change(entry, unit)})",
                    AMEND_HINT,
                )
            )
    for key in sorted(set(entries) - set(units)):
        out.append(
            Violation(
                "TLOCK002", config.lock, 0, f"locked item {key} was removed or renamed", AMEND_HINT
            )
        )
    out.extend(_amendment_violations(root, config, lock))
    return out


def _amendment_violations(root: Path, config: Config, lock: dict[str, Any]) -> list[Violation]:
    out: list[Violation] = []
    claims: list[tuple[str, str]] = [
        (key, str(e["amended_by"])) for key, e in lock["entries"].items() if e.get("amended_by")
    ] + [(key, str(adr)) for key, adr in lock["removed"].items()]
    for key, adr_name in sorted(claims):
        problem = _adr_problem(root, adr_name, key)
        if problem:
            out.append(
                Violation(
                    "TLOCK004",
                    config.lock,
                    0,
                    f"amendment of {key}: {problem}",
                    "Write and seal an ADR whose amends_tests lists this item.",
                )
            )
    return out


def _adr_problem(root: Path, adr_name: str, key: str) -> str | None:
    path = root / "docs/design-docs/adr" / adr_name
    if not path.exists():
        return f"ADR {adr_name} does not exist"
    data, body = split_front_matter(path.read_text(encoding="utf-8"))
    if data is None or data.get("decision_hash") != body_fingerprint(body):
        return f"ADR {adr_name} is not sealed (or was edited after sealing)"
    if key not in (data.get("amends_tests") or []):
        return f"ADR {adr_name} does not list it in amends_tests"
    if len(str(data.get("test_change_reason", "")).strip()) < 40:
        return f"ADR {adr_name} has no real test_change_reason (min 40 chars)"
    return None


def apply_lock(root: Path, config: Config, amend: str | None, now: dt.date) -> list[str]:
    """Append new items; with ``amend`` also accept the changes/removals the ADR lists."""
    units = current_units(root, config)
    lock = load_lock(root, config)
    entries: dict[str, Any] = lock["entries"]
    allowed: set[str] = set()
    if amend:
        data, _ = split_front_matter(
            (root / "docs/design-docs/adr" / amend).read_text(encoding="utf-8")
        )
        allowed = set((data or {}).get("amends_tests") or [])
    refused: list[str] = []
    for key, unit in units.items():
        existing = entries.get(key)
        if existing is None:
            entries[key] = entry_for(unit, now)
        elif existing["hash"] != unit.digest:
            if key in allowed:
                entries[key] = entry_for(unit, now, amend)
            else:
                refused.append(key)
    for key in sorted(set(entries) - set(units)):
        if key in allowed:
            lock["removed"][key] = amend
            del entries[key]
        else:
            refused.append(key)
    if not refused:
        save_lock(root, config, lock)
    return refused


# --------------------------------------------------------------------------- base comparison


def base_violations(root: Path, config: Config, base: str) -> list[Violation]:
    """Compare the lock with the one at ``base``: changes need an amendment ADR new in this diff."""
    old_text = git(root, "show", f"{base}:{config.lock}")
    if old_text is None:
        return []
    old = json.loads(old_text)
    lock = load_lock(root, config)
    out: list[Violation] = []
    for key, entry in sorted(old.get("entries", {}).items()):
        now_entry = lock["entries"].get(key)
        adr = lock["removed"].get(key) if now_entry is None else now_entry.get("amended_by")
        changed = now_entry is None or now_entry["hash"] != entry["hash"]
        if not changed:
            continue
        if not adr or git(root, "cat-file", "-e", f"{base}:docs/design-docs/adr/{adr}") is not None:
            out.append(
                Violation(
                    "TLOCK005",
                    config.lock,
                    0,
                    f"{key} differs from {base} without an amendment ADR added in this change",
                    AMEND_HINT,
                )
            )
    return out


# --------------------------------------------------------------------------- entry points


def run(root: Path, base: str | None = None) -> list[Violation]:
    config = Config.load(root)
    violations: list[Violation] = []
    for path in iter_test_files(root, config):
        violations.extend(static_violations(root, path))
    violations.extend(config_violations(root, config))
    violations.extend(lock_violations(root, config, current_units(root, config)))
    if base:
        violations.extend(base_violations(root, config, base))
    return violations


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Test integrity")
    parser.add_argument("--root", type=Path, default=None)
    sub = parser.add_subparsers(dest="command")
    check = sub.add_parser("check")
    check.add_argument("--base", default=None, help="git ref to compare the lock against")
    lock = sub.add_parser("lock")
    lock.add_argument("--amend", default=None, help="ADR filename in docs/design-docs/adr/")
    args = parser.parse_args(argv)
    root = find_root(args.root)
    if args.command == "lock":
        refused = apply_lock(root, Config.load(root), args.amend, today())
        for key in refused:
            print(f"refused: {key} changed or vanished and no amendment ADR lists it")
        if refused:
            print(AMEND_HINT)
        return 1 if refused else 0
    return finish("test-integrity", run(root, getattr(args, "base", None)))


if __name__ == "__main__":
    sys.exit(main())
