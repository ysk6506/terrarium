"""CLI entry points, run_all, shared helpers and class-based test collection."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from harness import common, run_all
from harness.checks import architecture, coverage, debt, docs, protected, testguard, traceability
from harness.checks.testunits import Config as UnitsConfig
from harness.checks.testunits import collect_units

pytestmark = pytest.mark.req("REQ-024")

CHECK_MODULES = [architecture, docs, debt, traceability, protected]


@pytest.mark.parametrize("module", CHECK_MODULES, ids=lambda m: m.__name__.rsplit(".", 1)[-1])
def test_main_exit_code_matches_run_result(module, capsys):
    root = common.find_root()
    expected = 1 if module.run(root) else 0
    assert module.main(["--root", str(root)]) == expected
    assert capsys.readouterr().out.startswith(("OK", "FAIL"))


def test_testguard_main_exit_code_matches_run_result(capsys):
    root = common.find_root()
    expected = 1 if testguard.run(root) else 0
    assert testguard.main(["--root", str(root), "check"]) == expected
    assert capsys.readouterr().out.startswith(("OK", "FAIL"))


def test_coverage_main_exit_code_matches_run_result(capsys):
    root = common.find_root()
    expected = 1 if coverage.run(root) else 0
    assert coverage.main(["--root", str(root), "check"]) == expected
    assert capsys.readouterr().out.startswith(("OK", "FAIL"))


def test_run_all_runs_every_check_and_reports_overall_verdict(capsys):
    root = common.find_root()
    code = run_all.main(["--root", str(root), "--with-coverage"])
    out = capsys.readouterr().out
    for name in ("architecture", "docs", "debt", "test-integrity", "traceability", "protected"):
        assert name in out
    assert "coverage" in out
    assert ("ALL CHECKS PASSED" in out) == (code == 0)


def test_run_all_skips_coverage_unless_asked():
    root = common.find_root()
    names = [name for name, _ in run_all.checks(root, None, with_coverage=False)]
    assert "coverage" not in names
    names = [name for name, _ in run_all.checks(root, None, with_coverage=True)]
    assert names[-1] == "coverage"


# ------------------------------------------------------------------------------ subcommands


def make_docs_repo(tmp_path: Path) -> Path:
    real = common.find_root()
    (tmp_path / "harness/config").mkdir(parents=True)
    (tmp_path / "pyproject.toml").write_text("[project]\nname='d'\n")
    for name in ("docs.yaml", "debt.yaml", "tests.yaml"):
        (tmp_path / "harness/config" / name).write_text(
            (real / "harness/config" / name).read_text()
        )
    return tmp_path


def test_docs_cli_reverify_and_seal_adr(tmp_path):
    root = make_docs_repo(tmp_path)
    (root / "src").mkdir()
    (root / "src/m.py").write_text("X = 1\n")
    doc = root / "docs/g.md"
    doc.parent.mkdir()
    doc.write_text(
        "---\ntitle: g\nkind: guide\nstatus: active\nlast_verified: 2026-01-01\ncovers: [src/m.py]\n---\nbody\n"
    )
    assert docs.main(["--root", str(root), "reverify", str(doc), "--note", "checked"]) == 0
    data, _ = common.split_front_matter(doc.read_text())
    assert data is not None and data["covers_hash"] and "checked" in data["verification_log"][0]

    adr = root / "docs/design-docs/adr/0001-x.md"
    adr.parent.mkdir(parents=True)
    adr.write_text(
        "---\ntitle: a\nkind: decision\nstatus: active\nlast_verified: 2026-01-01\n---\nbody\n"
    )
    assert docs.main(["--root", str(root), "seal-adr", str(adr)]) == 0
    sealed, _ = common.split_front_matter(adr.read_text())
    assert sealed is not None and sealed["decision_hash"]


def test_seal_adr_rejects_non_decisions_and_reverify_rejects_missing_front_matter(tmp_path):
    plain = tmp_path / "x.md"
    plain.write_text("no front matter\n")
    with pytest.raises(SystemExit):
        docs.seal_adr(plain)
    with pytest.raises(SystemExit):
        docs.reverify(tmp_path, plain, "note")


def test_debt_cli_ratchet_removes_fixed_entries(tmp_path, capsys):
    root = make_docs_repo(tmp_path)
    (root / "src").mkdir()
    (root / "src/a.py").write_text("X = 1\n")
    (root / "harness/config/debt-baseline.json").write_text(json.dumps({"src/a.py::f::lines": 99}))
    (root / "docs/exec-plans").mkdir(parents=True)
    (root / "docs/exec-plans/tech-debt.yaml").write_text("items: []\n")
    assert debt.main(["--root", str(root), "ratchet"]) == 0
    assert "removed 1 fixed baseline entry" in capsys.readouterr().out
    assert json.loads((root / "harness/config/debt-baseline.json").read_text()) == {}


def test_debt_check_without_register_or_baseline_files_is_clean(tmp_path):
    root = make_docs_repo(tmp_path)
    (root / "src").mkdir()
    assert debt.run(root, dt.date(2026, 10, 28)) == []


def test_testguard_cli_lock_appends_new_tests_and_refuses_changes(tmp_path, capsys):
    root = make_docs_repo(tmp_path)
    (root / "tests").mkdir()
    test = root / "tests/test_a.py"
    test.write_text("def test_a():\n    assert 1 + 1 == 2\n")
    assert testguard.main(["--root", str(root), "lock"]) == 0
    assert testguard.main(["--root", str(root), "check"]) == 0
    test.write_text("def test_a():\n    assert 1 + 1 == 3\n")
    assert testguard.main(["--root", str(root), "lock"]) == 1
    assert "refused: tests/test_a.py::test_a" in capsys.readouterr().out


def test_coverage_cli_ratchet_prints_floors(tmp_path, capsys):
    root = make_docs_repo(tmp_path)
    report = {
        "files": {
            "harness/a.py": {
                "summary": {
                    "covered_lines": 99,
                    "num_statements": 100,
                    "covered_branches": 0,
                    "num_branches": 0,
                }
            }
        }
    }
    (root / "coverage.json").write_text(json.dumps(report))
    assert coverage.main(["--root", str(root), "ratchet"]) == 0
    assert "harness: 99.0%" in capsys.readouterr().out


# ------------------------------------------------------------------------------ common helpers


def test_find_root_fails_outside_a_repo(tmp_path):
    with pytest.raises(RuntimeError, match="repo root not found"):
        common.find_root(tmp_path)


def test_today_can_be_pinned(monkeypatch):
    monkeypatch.setenv("TERRARIUM_TODAY", "2030-01-02")
    assert common.today() == dt.date(2030, 1, 2)
    monkeypatch.delenv("TERRARIUM_TODAY")
    assert common.today() == dt.date.today()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (dt.date(2026, 1, 2), dt.date(2026, 1, 2)),
        (dt.datetime(2026, 1, 2, 5, 0), dt.date(2026, 1, 2)),
        ("2026-01-02", dt.date(2026, 1, 2)),
        ("not a date", None),
        (20260102, None),
        (None, None),
    ],
)
def test_as_date(value, expected):
    assert common.as_date(value) == expected


@pytest.mark.parametrize(
    "text",
    ["no front matter", "---\nnever closed\n", "---\n- a\n- b\n---\nbody"],
)
def test_split_front_matter_returns_none_for_unusable_input(text):
    data, body = common.split_front_matter(text)
    assert data is None
    assert body == text


def test_split_front_matter_splits_data_and_body():
    data, body = common.split_front_matter("---\na: 1\n---\nhello\n")
    assert data == {"a": 1}
    assert body.strip() == "hello"


def test_git_returns_none_outside_a_repository_or_on_failure(tmp_path):
    assert common.git(tmp_path, "rev-parse", "HEAD") is None


def test_violation_render_includes_location_problem_and_fix():
    text = common.Violation("X001", "a/b.py", 7, "bad", "do this").render()
    assert "[X001] a/b.py:7" in text and "problem: bad" in text and "fix: do this" in text
    assert "a/b.py\n" in common.Violation("X001", "a/b.py", 0, "bad", "fix").render()


def test_finish_prints_ok_or_sorted_failures(capsys):
    assert common.finish("demo", []) == 0
    assert capsys.readouterr().out.strip() == "OK   demo"
    violations = [common.Violation("B", "z", 1, "m", "f"), common.Violation("A", "a", 1, "m", "f")]
    assert common.finish("demo", violations) == 1
    out = capsys.readouterr().out
    assert "FAIL demo: 2 violation(s)" in out
    assert out.index("[A]") < out.index("[B]")


# ------------------------------------------------------------------------------ test collection

CLASSY = """
import pytest

CONSTANT = 3
registry = {}
registry["a"] = 1


class TestThing:
    limit = 5

    def helper(self):
        return 1

    def test_one(self):
        assert self.helper() == 1


class Helper:
    value = 2

    def run(self):
        return self.value


class Empty:
    pass
"""


def test_class_based_tests_and_module_level_statements_are_collected(tmp_path):
    path = tmp_path / "tests" / "test_classy.py"
    path.parent.mkdir()
    path.write_text(CLASSY)
    units = {u.key: u for u in collect_units(tmp_path, path)}
    assert units["tests/test_classy.py::TestThing::test_one"].kind == "test"
    assert units["tests/test_classy.py::TestThing::test_one"].asserts == 1
    assert units["tests/test_classy.py::TestThing.helper"].kind == "support"
    assert units["tests/test_classy.py::TestThing.=limit"].kind == "support"
    assert units["tests/test_classy.py::Helper.run"].kind == "support"
    assert units["tests/test_classy.py::=CONSTANT"].kind == "support"
    assert any(key.startswith("tests/test_classy.py::Empty.<stmt:") for key in units)
    assert any("<stmt:" in key for key in units)  # registry["a"] = 1 is not lost
    assert "tests/test_classy.py::=registry" in units
    assert any("<import:" in key for key in units)  # imports are locked too


def test_data_files_are_locked_with_their_content(tmp_path):
    root = make_docs_repo(tmp_path)
    data = root / "tests/data/expected.json"
    data.parent.mkdir(parents=True)
    data.write_text("{}")
    units = testguard.current_units(root, UnitsConfig.load(root))
    assert units["tests/data/expected.json::<data>"].kind == "data"
