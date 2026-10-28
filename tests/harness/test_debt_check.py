"""Meta-tests: unregistered debt, overdue debt, over-budget debt and quality regressions must fail."""

from __future__ import annotations

import ast
import datetime as dt
import json
from pathlib import Path

import pytest
import yaml

from harness.checks import debt, debtmeasure
from harness.common import find_root

pytestmark = pytest.mark.req("REQ-022")

TODAY = dt.date(2026, 10, 28)


def item(ident: str = "TD-0001", **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": ident,
        "title": "t",
        "severity": "low",
        "cost": "slow",
        "created": dt.date(2026, 10, 1),
        "due": dt.date(2026, 12, 1),
        "status": "open",
    }
    base.update(overrides)
    return base


def register(*items: dict[str, object]) -> str:
    return yaml.safe_dump({"items": list(items)}, sort_keys=False)


def long_function(lines: int) -> str:
    return "def f():\n" + "    x = 1\n" * lines


def branchy(branches: int) -> str:
    body = "".join(f"    if x == {i}:\n        return {i}\n" for i in range(branches))
    return "def f(x):\n" + body + "    return 0\n"


@pytest.fixture
def debt_repo(tmp_path: Path):
    real = (find_root() / "harness/config/debt.yaml").read_text(encoding="utf-8")

    def build(
        files: dict[str, str] | None = None, items: list[dict[str, object]] | None = None
    ) -> Path:
        base = {
            "pyproject.toml": "[project]\nname='demo'\n",
            "harness/config/debt.yaml": real,
            "harness/config/debt-baseline.json": "{}\n",
            "docs/exec-plans/tech-debt.yaml": register(*(items or [])),
            "src/demo/a.py": "X = 1\n",
        }
        base.update(files or {})
        for name, content in base.items():
            target = tmp_path / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        return tmp_path

    return build


def codes(root: Path) -> list[str]:
    return sorted({v.code for v in debt.run(root, TODAY)})


def test_clean_repo_passes(debt_repo):
    assert debt.run(debt_repo(), TODAY) == []


def test_real_repository_debt_is_clean():
    assert debt.run(find_root()) == []


# -------------------------------------------------------------------------------- markers


@pytest.mark.parametrize("marker", ["TODO", "FIXME", "HACK", "XXX"])
def test_untracked_markers_fail(debt_repo, marker):
    root = debt_repo({"src/demo/a.py": f"X = 1  # {marker} clean this up\n"})
    assert codes(root) == ["DEBT001"]


def test_tracked_marker_pointing_at_open_item_passes(debt_repo):
    root = debt_repo({"src/demo/a.py": "X = 1  # TODO(TD-0001) split later\n"}, [item()])
    assert debt.run(root, TODAY) == []


def test_marker_for_unknown_item_fails(debt_repo):
    root = debt_repo({"src/demo/a.py": "X = 1  # TODO(TD-0009) x\n"}, [item()])
    assert codes(root) == ["DEBT002"]


def test_marker_for_closed_item_fails(debt_repo):
    closed = item(status="done", resolution="fixed in module b")
    root = debt_repo({"src/demo/a.py": "X = 1  # TODO(TD-0001) x\n"}, [closed])
    assert codes(root) == ["DEBT013"]


def test_markers_inside_strings_are_not_comments(debt_repo):
    root = debt_repo({"src/demo/a.py": 'X = "TODO later"\n'})
    assert debt.run(root, TODAY) == []


def test_markers_are_checked_in_tests_too(debt_repo):
    root = debt_repo({"tests/test_x.py": "# FIXME make faster\n"})
    assert codes(root) == ["DEBT001"]


# -------------------------------------------------------------------------------- register


def test_register_entry_missing_fields_fails(debt_repo):
    assert codes(debt_repo(items=[{"id": "TD-0001", "title": "t"}])) == ["DEBT010"]


def test_duplicate_ids_fail(debt_repo):
    assert codes(debt_repo(items=[item(), item()])) == ["DEBT010"]


def test_bad_id_format_fails(debt_repo):
    assert codes(debt_repo(items=[item("TD-1")])) == ["DEBT010"]


def test_closing_without_resolution_fails(debt_repo):
    assert codes(debt_repo(items=[item(status="done")])) == ["DEBT010"]


def test_overdue_open_item_fails(debt_repo):
    overdue = item(due=dt.date(2026, 10, 1))
    assert codes(debt_repo(items=[overdue])) == ["DEBT011"]


def test_closed_overdue_item_is_fine(debt_repo):
    done = item(due=dt.date(2026, 10, 1), status="done", resolution="r")
    assert debt.run(debt_repo(items=[done]), TODAY) == []


def test_open_debt_budget_is_enforced(debt_repo):
    items = [item(f"TD-{n:04d}") for n in range(1, 14)]
    assert codes(debt_repo(items=items)) == ["DEBT012"]


def test_high_severity_budget_is_enforced(debt_repo):
    items = [item(f"TD-{n:04d}", severity="high") for n in range(1, 4)]
    assert codes(debt_repo(items=items)) == ["DEBT012"]


# -------------------------------------------------------------------------------- quality


def test_long_file_fails(debt_repo):
    assert "DEBT020" in codes(debt_repo({"src/demo/a.py": "X = 1\n" * 501}))


def test_long_function_fails(debt_repo):
    assert codes(debt_repo({"src/demo/a.py": long_function(85)})) == ["DEBT021"]


def test_complex_function_fails(debt_repo):
    assert codes(debt_repo({"src/demo/a.py": branchy(13)})) == ["DEBT022"]


def test_too_many_parameters_fail(debt_repo):
    source = "def f(a, b, c, d, e, f1, g, h, i):\n    return a\n"
    assert codes(debt_repo({"src/demo/a.py": source})) == ["DEBT023"]


def test_self_and_cls_do_not_count_as_parameters(debt_repo):
    source = "class C:\n    def f(self, a, b, c, d, e, f1, g, h):\n        return a\n"
    assert debt.run(debt_repo({"src/demo/a.py": source}), TODAY) == []


def test_tests_are_exempt_from_size_limits(debt_repo):
    assert debt.run(debt_repo({"tests/test_big.py": long_function(120)}), TODAY) == []


def test_waiver_with_open_item_tolerates_violation(debt_repo):
    source = long_function(85).replace("def f():", "def f():  # debt-ok: TD-0001")
    assert debt.run(debt_repo({"src/demo/a.py": source}, [item()]), TODAY) == []


def test_file_level_waiver_on_first_line(debt_repo):
    source = "# debt-ok: TD-0001\n" + "X = 1\n" * 510
    assert debt.run(debt_repo({"src/demo/a.py": source}, [item()]), TODAY) == []


def test_waiver_for_closed_item_does_not_help(debt_repo):
    source = long_function(85).replace("def f():", "def f():  # debt-ok: TD-0001")
    closed = item(status="done", resolution="r")
    assert {"DEBT013", "DEBT021"} <= set(codes(debt_repo({"src/demo/a.py": source}, [closed])))


def test_waiver_that_is_no_longer_needed_fails(debt_repo):
    root = debt_repo({"src/demo/a.py": "X = 1  # debt-ok: TD-0001\n"}, [item()])
    assert codes(root) == ["DEBT032"]


# -------------------------------------------------------------------------------- ratchet


def write_baseline(root: Path, data: dict[str, int]) -> None:
    (root / "harness/config/debt-baseline.json").write_text(json.dumps(data), encoding="utf-8")


def test_baselined_violation_is_tolerated(debt_repo):
    root = debt_repo({"src/demo/a.py": branchy(13)})
    write_baseline(root, {"src/demo/a.py::f::complexity": 14})
    assert debt.run(root, TODAY) == []


def test_baselined_violation_that_gets_worse_fails(debt_repo):
    root = debt_repo({"src/demo/a.py": branchy(15)})
    write_baseline(root, {"src/demo/a.py::f::complexity": 14})
    assert codes(root) == ["DEBT031"]


def test_fixed_baseline_entry_must_be_removed(debt_repo):
    root = debt_repo({"src/demo/a.py": "X = 1\n"})
    write_baseline(root, {"src/demo/a.py::f::complexity": 14})
    assert codes(root) == ["DEBT030"]


def test_ratchet_removes_fixed_entries_and_lowers_values_but_never_adds(debt_repo):
    root = debt_repo(
        {"src/demo/a.py": branchy(13) + "\n\n" + long_function(90).replace("f()", "g()")}
    )
    write_baseline(root, {"src/demo/a.py::f::complexity": 20, "src/demo/a.py::gone::lines": 99})
    removed = debt.ratchet(root)
    data = json.loads((root / "harness/config/debt-baseline.json").read_text(encoding="utf-8"))
    assert removed == ["src/demo/a.py::gone::lines"]
    assert data == {"src/demo/a.py::f::complexity": 14}


# -------------------------------------------------------------------------------- complexity


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("def f():\n    return 1\n", 1),
        ("def f(x):\n    if x:\n        return 1\n    return 2\n", 2),
        ("def f(x, y):\n    if x and y:\n        return 1\n    return 2\n", 3),
        ("def f(x):\n    for i in x:\n        while i:\n            i -= 1\n", 3),
        ("def f(x):\n    return [i for i in x if i]\n", 3),
        ("def f(x):\n    try:\n        pass\n    except ValueError:\n        pass\n", 2),
        ("def f(x):\n    return 1 if x else 2\n", 2),
        ("def f(x):\n    def g(y):\n        if y:\n            return 1\n    return g\n", 1),
    ],
)
def test_complexity_counts_branches_without_nested_functions(source, expected):
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef))
    assert debtmeasure.complexity(node) == expected
