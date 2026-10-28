"""Meta-tests: every known way of making tests pass by changing tests must be caught."""

from __future__ import annotations

import datetime as dt
import json
import subprocess
from pathlib import Path

import pytest
import yaml

from harness.checks import docs, testguard
from harness.common import find_root

pytestmark = pytest.mark.req("REQ-023")

TODAY = dt.date(2026, 10, 28)
GOOD_TEST = """\
from demo import add


def helper():
    return 2


def test_add():
    assert add(1, 1) == helper()
"""

PYPROJECT = """\
[project]
name = "demo"

[tool.pytest.ini_options]
addopts = "-ra --strict-markers"

[tool.coverage.report]
exclude_lines = ["pragma: no cover"]
"""


@pytest.fixture
def guard_repo(tmp_path: Path):
    real = (find_root() / "harness/config/tests.yaml").read_text(encoding="utf-8")

    def build(files: dict[str, str] | None = None, locked: bool = True) -> Path:
        base = {
            "pyproject.toml": PYPROJECT,
            "harness/config/tests.yaml": real,
            "tests/test_add.py": GOOD_TEST,
        }
        base.update(files or {})
        for name, content in base.items():
            target = tmp_path / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        if locked:
            assert lock(tmp_path) == []
        return tmp_path

    return build


def lock(root: Path, amend: str | None = None) -> list[str]:
    return testguard.apply_lock(root, testguard.Config.load(root), amend, TODAY)


def codes(root: Path, base: str | None = None) -> list[str]:
    return sorted({v.code for v in testguard.run(root, base)})


def edit(root: Path, name: str, old: str, new: str) -> None:
    path = root / name
    text = path.read_text(encoding="utf-8")
    assert old in text
    path.write_text(text.replace(old, new), encoding="utf-8")


def test_clean_locked_repo_passes(guard_repo):
    assert testguard.run(guard_repo()) == []


def test_real_repository_tests_are_intact():
    assert testguard.run(find_root()) == []


# ------------------------------------------------------------------------------ static rules


def test_test_without_assertion_fails(guard_repo):
    root = guard_repo({"tests/test_x.py": "def test_x():\n    run = 1\n"})
    assert codes(root) == ["TEST001"]


@pytest.mark.parametrize(
    "body",
    [
        "    with pytest.raises(ValueError):\n        int('x')\n",
        "    mock.assert_called_once()\n",
        "    np.testing.assert_allclose(1, 1)\n",
        "    pytest.fail('unreachable')\n",
    ],
)
def test_other_assertion_forms_count(guard_repo, body):
    root = guard_repo({"tests/test_x.py": "import pytest\n\n\ndef test_x():\n" + body})
    assert "TEST001" not in codes(root)


@pytest.mark.parametrize(
    "statement",
    ["assert True", "assert 1", "assert not False", "assert x == x", "assert ok or True"],
)
def test_trivially_true_assertions_fail(guard_repo, statement):
    root = guard_repo({"tests/test_x.py": f"def test_x():\n    x = ok = 1\n    {statement}\n"})
    assert "TEST003" in codes(root)


@pytest.mark.parametrize(
    "decorator",
    [
        "@pytest.mark.skip",
        "@pytest.mark.skip(reason='later')",
        "@pytest.mark.xfail",
        "@pytest.mark.skipif(True, reason='flaky')",
    ],
)
def test_skip_or_xfail_without_debt_reason_fails(guard_repo, decorator):
    src = f"import pytest\n\n\n{decorator}\ndef test_x():\n    assert 1 == 2\n"
    assert "TEST002" in codes(guard_repo({"tests/test_x.py": src}))


def test_imperative_skip_without_reason_fails(guard_repo):
    src = "import pytest\n\n\ndef test_x():\n    pytest.skip('no time')\n    assert 1 == 2\n"
    assert "TEST002" in codes(guard_repo({"tests/test_x.py": src}))


def test_skip_with_debt_reference_is_allowed(guard_repo):
    src = (
        "import pytest\n\n\n@pytest.mark.skip(reason='TD-0001: needs FalkorDB server')\n"
        "def test_x():\n    assert 1 == 2\n"
    )
    assert codes(guard_repo({"tests/test_x.py": src})) == []


def test_skip_is_counted_once_per_occurrence():
    import ast

    tree = ast.parse("import pytest\n\n@pytest.mark.skip(reason='x')\ndef test_x():\n    pass\n")
    assert len(testguard._skip_calls(tree)) == 1


def test_broad_except_that_swallows_failures_fails(guard_repo):
    src = "def test_x():\n    try:\n        assert 1 == 2\n    except Exception:\n        pass\n"
    assert "TEST004" in codes(guard_repo({"tests/test_x.py": src}))


def test_specific_except_or_reraise_is_fine(guard_repo):
    src = (
        "def test_x():\n    try:\n        assert int('1') == 1\n    except ValueError:\n        pass\n"
        "    try:\n        assert 1 == 1\n    except Exception:\n        raise\n"
    )
    assert "TEST004" not in codes(guard_repo({"tests/test_x.py": src}))


# ------------------------------------------------------------------------------ config rules


@pytest.mark.parametrize("option", ["--deselect=tests/test_add.py::test_add", "-k", "--lf", "-p"])
def test_forbidden_pytest_addopts_fail(guard_repo, option):
    root = guard_repo(
        {"pyproject.toml": PYPROJECT.replace("--strict-markers", f"--strict-markers {option}")}
    )
    assert "TCFG001" in codes(root)


@pytest.mark.parametrize(
    "name",
    [
        "collect_ignore = ['test_add.py']",
        "def pytest_collection_modifyitems(items):\n    items.clear()",
    ],
)
def test_conftest_hooks_that_hide_tests_fail(guard_repo, name):
    root = guard_repo({"tests/conftest.py": name + "\n"})
    assert "TCFG002" in codes(root)


def test_plain_fixtures_in_conftest_are_fine(guard_repo):
    src = "import pytest\n\n\n@pytest.fixture\ndef value():\n    return 1\n"
    assert codes(guard_repo({"tests/conftest.py": src})) == []


def test_coverage_omit_fails(guard_repo):
    root = guard_repo(
        {"pyproject.toml": PYPROJECT + '\n[tool.coverage.run]\nomit = ["src/demo/hard.py"]\n'}
    )
    assert codes(root) == ["TCFG003"]


def test_lowering_coverage_fail_under_below_minimum_fails(guard_repo):
    root = guard_repo({"pyproject.toml": PYPROJECT + "fail_under = 50\n"})
    assert codes(root) == ["TCFG003"]


def test_extra_coverage_exclusions_fail(guard_repo):
    root = guard_repo(
        {"pyproject.toml": PYPROJECT.replace('"pragma: no cover"]', '"pragma: no cover", "def "]')}
    )
    assert codes(root) == ["TCFG003"]


def test_second_pytest_config_file_fails(guard_repo):
    root = guard_repo({"pytest.ini": "[pytest]\naddopts = -k nothing\n"})
    assert codes(root) == ["TCFG004"]


# ------------------------------------------------------------------------------ lock


def test_new_test_must_be_locked(guard_repo):
    root = guard_repo()
    (root / "tests/test_new.py").write_text(
        "def test_new():\n    assert 1 + 1 == 2\n", encoding="utf-8"
    )
    assert codes(root) == ["TLOCK003"]
    assert lock(root) == []
    assert codes(root) == []


def test_changing_expected_value_is_caught(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    violations = testguard.run(root)
    assert [v.code for v in violations] == ["TLOCK001"]
    assert "expected values" in violations[0].message


def test_changing_a_helper_that_tests_rely_on_is_caught(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "return 2", "return 3")
    assert codes(root) == ["TLOCK001"]


def test_deleting_a_test_is_caught(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "def test_add():\n    assert add(1, 1) == helper()\n", "")
    assert codes(root) == ["TLOCK002"]


def test_renaming_a_test_is_caught(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "def test_add", "def test_add_renamed")
    assert codes(root) == ["TLOCK002", "TLOCK003"]


def test_removing_an_assertion_is_reported_as_weakening(guard_repo):
    root = guard_repo({"tests/test_add.py": GOOD_TEST + "    assert add(0, 0) == 0\n"})
    edit(root, "tests/test_add.py", "    assert add(0, 0) == 0\n", "")
    violations = testguard.run(root)
    assert "assertions 2 -> 1" in violations[0].message


def test_loosening_tolerance_is_reported(guard_repo):
    src = "import pytest\n\n\ndef test_x():\n    assert 0.1 + 0.2 == pytest.approx(0.3, rel=1e-9)\n"
    root = guard_repo({"tests/test_x.py": src})
    edit(root, "tests/test_x.py", "rel=1e-9", "rel=0.5")
    assert any("tolerance loosened" in v.message for v in testguard.run(root))


def test_editing_expected_data_files_is_caught(guard_repo):
    root = guard_repo({"tests/data/expected.json": '{"temp": 24.5}'})
    (root / "tests/data/expected.json").write_text('{"temp": 30.0}', encoding="utf-8")
    assert codes(root) == ["TLOCK001"]


def test_comments_formatting_and_docstrings_do_not_trip_the_lock(guard_repo):
    root = guard_repo()
    edit(
        root,
        "tests/test_add.py",
        "def test_add():\n",
        'def test_add():  # note\n    """Adds."""\n\n',
    )
    assert codes(root) == []


def test_lock_command_refuses_unamended_changes_and_writes_nothing(guard_repo):
    root = guard_repo()
    before = (root / "harness/config/test-lock.json").read_text(encoding="utf-8")
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    assert lock(root) == ["tests/test_add.py::test_add"]
    assert (root / "harness/config/test-lock.json").read_text(encoding="utf-8") == before


# ------------------------------------------------------------------------------ amendments


def write_adr(root: Path, name: str, amends: list[str], reason: str, seal: bool = True) -> None:
    data = {
        "title": "amend",
        "kind": "decision",
        "status": "active",
        "last_verified": TODAY,
        "enforced_by": ["none"],
        "no_enforcement_reason": "test amendment",
        "amends_tests": amends,
        "test_change_reason": reason,
    }
    path = root / "docs/design-docs/adr" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\n" + yaml.safe_dump(data) + "---\n# Amend\nRequirement REQ-001 changed.\n")
    if seal:
        docs.seal_adr(path)


REASON = "REQ-001 changed: addition now saturates at 2, see requirements.md change."


def test_amendment_adr_allows_the_listed_change(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    write_adr(root, "0009-amend.md", ["tests/test_add.py::test_add"], REASON)
    assert lock(root, "0009-amend.md") == []
    assert codes(root) == []
    entry = json.loads((root / "harness/config/test-lock.json").read_text())["entries"][
        "tests/test_add.py::test_add"
    ]
    assert entry["amended_by"] == "0009-amend.md"


def test_amendment_adr_does_not_cover_unlisted_items(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    edit(root, "tests/test_add.py", "return 2", "return 3")
    write_adr(root, "0009-amend.md", ["tests/test_add.py::test_add"], REASON)
    assert lock(root, "0009-amend.md") == ["tests/test_add.py::helper"]


def test_amended_removal_is_recorded(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "def test_add():\n    assert add(1, 1) == helper()\n", "")
    write_adr(root, "0009-amend.md", ["tests/test_add.py::test_add"], REASON)
    assert lock(root, "0009-amend.md") == []
    assert codes(root) == []


@pytest.mark.parametrize(
    ("seal", "reason", "fragment"),
    [(False, REASON, "not sealed"), (True, "because", "test_change_reason")],
)
def test_weak_or_unsealed_amendment_adr_is_rejected(guard_repo, seal, reason, fragment):
    root = guard_repo()
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    write_adr(root, "0009-amend.md", ["tests/test_add.py::test_add"], REASON)
    assert lock(root, "0009-amend.md") == []
    write_adr(root, "0009-amend.md", ["tests/test_add.py::test_add"], reason, seal=seal)
    violations = testguard.run(root)
    assert [v.code for v in violations] == ["TLOCK004"]
    assert fragment in violations[0].message


def test_forging_the_lock_by_hand_is_caught_by_the_amendment_check(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    lock_path = root / "harness/config/test-lock.json"
    data = json.loads(lock_path.read_text())
    unit = testguard.current_units(root, testguard.Config.load(root))["tests/test_add.py::test_add"]
    data["entries"]["tests/test_add.py::test_add"].update(
        hash=unit.digest, amended_by="0042-fake.md"
    )
    lock_path.write_text(json.dumps(data))
    assert codes(root) == ["TLOCK004"]


def test_forging_the_lock_without_amended_by_is_caught_against_the_base_ref(guard_repo):
    root = guard_repo()
    for args in (
        ["init", "-q"],
        ["add", "-A"],
        ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "base"],
    ):
        subprocess.run(["git", *args], cwd=root, check=True)
    edit(root, "tests/test_add.py", "== helper()", "== 3")
    lock_path = root / "harness/config/test-lock.json"
    data = json.loads(lock_path.read_text())
    unit = testguard.current_units(root, testguard.Config.load(root))["tests/test_add.py::test_add"]
    data["entries"]["tests/test_add.py::test_add"]["hash"] = unit.digest
    lock_path.write_text(json.dumps(data))
    assert codes(root) == []  # the local lock looks consistent ...
    assert codes(root, base="HEAD") == ["TLOCK005"]  # ... but the diff against main is not


def test_swapping_an_import_for_a_fake_is_caught(guard_repo):
    root = guard_repo()
    edit(root, "tests/test_add.py", "from demo import add", "from demo_fake import add")
    assert codes(root) == ["TLOCK002", "TLOCK003"]


def test_changing_a_module_level_subscript_assignment_is_caught(guard_repo):
    src = "EXPECTED = {}\nEXPECTED['a'] = 1\n\n\ndef test_x():\n    assert EXPECTED['a'] == 1\n"
    root = guard_repo({"tests/test_x.py": src})
    edit(root, "tests/test_x.py", "EXPECTED['a'] = 1", "EXPECTED['a'] = 2")
    assert "TLOCK001" in codes(root) or "TLOCK002" in codes(root)


def test_repeated_identical_statements_are_each_locked(guard_repo):
    src = "X = 1\nX = 1\n\n\ndef test_x():\n    assert X == 1\n"
    root = guard_repo({"tests/test_x.py": src})
    keys = set(json.loads((root / "harness/config/test-lock.json").read_text())["entries"])
    assert "tests/test_x.py::=X" in keys and "tests/test_x.py::=X#2" in keys
