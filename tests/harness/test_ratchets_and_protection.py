"""Meta-tests for protected paths, the coverage ratchet, the debt baseline ratchet and traceability."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import yaml

from harness.checks import coverage, debt, docs, protected, traceability
from harness.common import find_root

GIT_ID = ["-c", "user.email=a@b", "-c", "user.name=a"]


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *GIT_ID, *args], cwd=root, check=True, capture_output=True)


def write(root: Path, files: dict[str, str]) -> None:
    for name, content in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


def committed_repo(root: Path, files: dict[str, str]) -> Path:
    write(root, files)
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "base")
    return root


# ----------------------------------------------------------------------------- protected paths

PROTECTED = "harness/**\npyproject.toml\n"
OWNERS = "/harness/** @owner\n/pyproject.toml @owner\n"


def protected_repo(tmp_path: Path) -> Path:
    return committed_repo(
        tmp_path,
        {
            "pyproject.toml": "[project]\nname='d'\n",
            "harness/config/protected-paths.txt": PROTECTED,
            "harness/config/x.yaml": "limit: 10\n",
            "harness/config/debt-baseline.json": "{}\n",
            ".github/CODEOWNERS": OWNERS,
            "src/a.py": "X = 1\n",
        },
    )


def add_adr(root: Path, touches: list[str], seal: bool = True) -> None:
    data = {
        "title": "t",
        "kind": "decision",
        "status": "active",
        "last_verified": "2026-10-28",
        "enforced_by": ["none"],
        "no_enforcement_reason": "x",
        "touches_protected": touches,
    }
    path = root / "docs/design-docs/adr/0005-loosen.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\n" + yaml.safe_dump(data) + "---\n# Why\nBecause.\n", encoding="utf-8")
    if seal:
        docs.seal_adr(path)


def pcodes(root: Path) -> list[str]:
    return sorted({v.code for v in protected.run(root, base="HEAD")})


@pytest.mark.req("REQ-021")
def test_unprotected_change_passes(tmp_path):
    root = protected_repo(tmp_path)
    (root / "src/a.py").write_text("X = 2\n")
    assert pcodes(root) == []


@pytest.mark.req("REQ-021")
def test_loosening_a_guardrail_without_adr_fails(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/x.yaml").write_text("limit: 999\n")
    assert pcodes(root) == ["PROT001"]


@pytest.mark.req("REQ-021")
def test_deleting_a_guardrail_without_adr_fails(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/x.yaml").unlink()
    assert pcodes(root) == ["PROT001"]


@pytest.mark.req("REQ-021")
def test_new_file_under_protected_path_needs_adr(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/new.yaml").write_text("a: 1\n")
    assert pcodes(root) == ["PROT001"]


@pytest.mark.req("REQ-021")
def test_sealed_adr_added_in_the_same_change_authorizes_it(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/x.yaml").write_text("limit: 999\n")
    add_adr(root, ["harness/config/x.yaml"])
    assert pcodes(root) == []


@pytest.mark.req("REQ-021")
def test_adr_authorizing_by_pattern(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/x.yaml").write_text("limit: 999\n")
    add_adr(root, ["harness/**"])
    assert pcodes(root) == []


@pytest.mark.req("REQ-021")
def test_unsealed_authorizing_adr_fails(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/x.yaml").write_text("limit: 999\n")
    add_adr(root, ["harness/config/x.yaml"], seal=False)
    assert pcodes(root) == ["PROT001", "PROT002"]


@pytest.mark.req("REQ-021")
def test_adr_that_already_existed_on_base_cannot_authorize_new_changes(tmp_path):
    root = protected_repo(tmp_path)
    add_adr(root, ["harness/config/x.yaml"])
    git(root, "add", "-A")
    git(root, "commit", "-qm", "old adr")
    (root / "harness/config/x.yaml").write_text("limit: 999\n")
    assert pcodes(root) == ["PROT001"]


@pytest.mark.req("REQ-021")
def test_ratchet_files_are_exempt_from_the_adr_rule(tmp_path):
    root = protected_repo(tmp_path)
    (root / "harness/config/debt-baseline.json").write_text('{"a": 1}\n')
    assert pcodes(root) == []


@pytest.mark.req("REQ-021")
def test_codeowners_must_cover_protected_paths(tmp_path):
    root = protected_repo(tmp_path)
    (root / ".github/CODEOWNERS").write_text("/harness/** @owner\n")
    assert [v.code for v in protected.run(root)] == ["PROT003"]


@pytest.mark.req("REQ-021")
def test_real_repository_codeowners_is_complete():
    assert protected.run(find_root()) == []


@pytest.mark.req("REQ-021")
def test_every_ratchet_file_has_a_guard_that_exists():
    root = find_root()
    for path, guard in protected.RATCHET_FILES.items():
        assert path.startswith("harness/config/")
        code = guard.split()[1]
        module = guard.split()[0]
        assert f'"{code}"' in (root / f"harness/checks/{module}.py").read_text(encoding="utf-8")


# ----------------------------------------------------------------------------- debt baseline ratchet


def debt_base_repo(tmp_path: Path, baseline: dict[str, int]) -> Path:
    real = (find_root() / "harness/config/debt.yaml").read_text(encoding="utf-8")
    return committed_repo(
        tmp_path,
        {
            "pyproject.toml": "[project]\nname='d'\n",
            "harness/config/debt.yaml": real,
            "harness/config/debt-baseline.json": json.dumps(baseline),
            "docs/exec-plans/tech-debt.yaml": "items: []\n",
        },
    )


@pytest.mark.req("REQ-022")
@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        ({"k": 14}, {"k": 13}, []),
        ({"k": 14}, {}, []),
        ({"k": 14}, {"k": 15}, ["DEBT033"]),
        ({}, {"k": 14}, ["DEBT033"]),
    ],
)
def test_debt_baseline_may_only_shrink(tmp_path, before, after, expected):
    root = debt_base_repo(tmp_path, before)
    (root / "harness/config/debt-baseline.json").write_text(json.dumps(after))
    found = debt.check_baseline_against(root, debt.DebtConfig.load(root), "HEAD")
    assert [v.code for v in found] == expected


# ----------------------------------------------------------------------------- coverage ratchet


def coverage_repo(
    tmp_path: Path, files: dict[str, tuple[int, int]], floors: dict[str, float] | None
) -> Path:
    real = (find_root() / "harness/config/tests.yaml").read_text(encoding="utf-8")
    report = {
        "files": {
            name: {
                "summary": {
                    "covered_lines": hit,
                    "num_statements": total,
                    "covered_branches": 0,
                    "num_branches": 0,
                }
            }
            for name, (hit, total) in files.items()
        }
    }
    content = {
        "pyproject.toml": "[project]\nname='d'\n",
        "harness/config/tests.yaml": real,
        "coverage.json": json.dumps(report),
        "src/terrarium/kernel/a.py": "X = 1\n",
    }
    if floors is not None:
        content["harness/config/coverage-floor.json"] = json.dumps(floors)
    return committed_repo(tmp_path, content)


def ccodes(root: Path, base: str | None = None) -> list[str]:
    return sorted({v.code for v in coverage.run(root, base)})


@pytest.mark.req("REQ-023")
def test_package_mapping():
    assert coverage.package_of("src/terrarium/kernel/ids.py") == "terrarium.kernel"
    assert coverage.package_of("src/terrarium/__init__.py") == "terrarium"
    assert coverage.package_of("harness/checks/docs.py") == "harness"
    assert coverage.package_of("tests/unit/test_x.py") is None


@pytest.mark.req("REQ-023")
def test_coverage_at_or_above_floor_passes(tmp_path):
    root = coverage_repo(
        tmp_path, {"src/terrarium/kernel/a.py": (95, 100)}, {"terrarium.kernel": 95.0}
    )
    assert ccodes(root) == []


@pytest.mark.req("REQ-023")
def test_coverage_below_floor_fails(tmp_path):
    root = coverage_repo(
        tmp_path, {"src/terrarium/kernel/a.py": (94, 100)}, {"terrarium.kernel": 95.0}
    )
    assert ccodes(root) == ["COV001"]


@pytest.mark.req("REQ-023")
def test_new_package_without_floor_fails(tmp_path):
    root = coverage_repo(tmp_path, {"src/terrarium/world/a.py": (99, 100)}, {})
    assert ccodes(root) == ["COV002"]


@pytest.mark.req("REQ-023")
def test_floor_below_global_minimum_is_invalid(tmp_path):
    root = coverage_repo(
        tmp_path, {"src/terrarium/kernel/a.py": (60, 100)}, {"terrarium.kernel": 50.0}
    )
    assert ccodes(root) == ["COV002"]


@pytest.mark.req("REQ-023")
def test_missing_report_fails(tmp_path):
    root = coverage_repo(tmp_path, {}, {})
    (root / "coverage.json").unlink()
    assert ccodes(root) == ["COV004"]


@pytest.mark.req("REQ-023")
def test_ratchet_raises_floors_but_never_lowers_or_goes_under_minimum(tmp_path):
    files = {
        "src/terrarium/kernel/a.py": (97, 100),
        "src/terrarium/world/b.py": (80, 100),
        "harness/c.py": (93, 100),
    }
    root = coverage_repo(tmp_path, files, {"terrarium.kernel": 95.0, "harness": 99.0})
    floors = coverage.ratchet(root)
    assert floors == {"terrarium.kernel": 97.0, "terrarium.world": 90.0, "harness": 99.0}


@pytest.mark.req("REQ-023")
@pytest.mark.parametrize(
    ("after", "expected"),
    [({"terrarium.kernel": 96.0}, []), ({"terrarium.kernel": 94.0}, ["COV003"]), ({}, ["COV003"])],
)
def test_floor_may_not_be_lowered_against_base(tmp_path, after, expected):
    root = coverage_repo(
        tmp_path, {"src/terrarium/kernel/a.py": (99, 100)}, {"terrarium.kernel": 95.0}
    )
    (root / "harness/config/coverage-floor.json").write_text(json.dumps(after))
    config = yaml.safe_load((root / "harness/config/tests.yaml").read_text())
    assert [v.code for v in coverage.check_floors_against(root, config, "HEAD")] == expected


@pytest.mark.req("REQ-023")
def test_pragma_no_cover_needs_a_reason_and_has_a_budget(tmp_path):
    root = coverage_repo(
        tmp_path, {"src/terrarium/kernel/a.py": (99, 100)}, {"terrarium.kernel": 95.0}
    )
    (root / "src/terrarium/kernel/a.py").write_text("X = 1  # pragma: no cover\n")
    assert ccodes(root) == ["COV005"]
    lines = "".join(
        f"X{i} = 1  # pragma: no cover - only reachable on Windows hosts\n" for i in range(4)
    )
    (root / "src/terrarium/kernel/a.py").write_text(lines)
    assert ccodes(root) == ["COV005"]


# ----------------------------------------------------------------------------- traceability

REQS = "| ID | x |\n|---|---|\n| REQ-001 | a |\n| REQ-002 | b |\n"


def trace_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    write(tmp_path, {"pyproject.toml": "", "docs/product-specs/requirements.md": REQS, **files})
    return tmp_path


def tcodes(root: Path) -> list[str]:
    return sorted({v.code for v in traceability.run(root)})


MARKED = 'import pytest\npytestmark = pytest.mark.req("REQ-001")\n\n\ndef test_a():\n    assert 1\n'


@pytest.mark.req("REQ-023")
def test_every_requirement_needs_a_test(tmp_path):
    root = trace_repo(tmp_path, {"tests/spec/test_a.py": MARKED})
    violations = traceability.run(root)
    assert [(v.code, v.message) for v in violations] == [("TRACE001", "REQ-002 has no test")]


@pytest.mark.req("REQ-023")
def test_unknown_requirement_reference_fails(tmp_path):
    root = trace_repo(tmp_path, {"tests/spec/test_a.py": MARKED.replace("REQ-001", "REQ-999")})
    assert "TRACE002" in tcodes(root)


@pytest.mark.req("REQ-023")
def test_spec_tests_must_link_requirements_but_unit_tests_need_not(tmp_path):
    files = {
        "tests/spec/test_a.py": MARKED
        + '\n\n@pytest.mark.req("REQ-002")\ndef test_b():\n    assert 1\n',
        "tests/spec/test_unlinked.py": "def test_c():\n    assert 1\n",
        "tests/unit/test_unit.py": "def test_d():\n    assert 1\n",
    }
    violations = traceability.run(trace_repo(tmp_path, files))
    assert [(v.code, v.path) for v in violations] == [("TRACE003", "tests/spec/test_unlinked.py")]


@pytest.mark.req("REQ-023")
def test_duplicate_requirement_ids_fail(tmp_path):
    root = trace_repo(
        tmp_path,
        {
            "docs/product-specs/requirements.md": REQS + "| REQ-001 | dup |\n",
            "tests/spec/test_a.py": MARKED.replace("REQ-001", "REQ-002")
            + MARKED[MARKED.index("\n") :],
        },
    )
    assert "TRACE004" in tcodes(root)
