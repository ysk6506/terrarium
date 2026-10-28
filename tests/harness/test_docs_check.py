"""Meta-tests: the docs check must flag rot (stale, old, broken, orphaned, rewritten ADRs)."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest
import yaml

from harness.checks import docs
from harness.common import find_root, split_front_matter

pytestmark = pytest.mark.req("REQ-020")

TODAY = dt.date(2026, 10, 28)
MODULE_SRC = '"""Doc."""\n\n\ndef add(a, b):\n    return a + b\n'


def front(**fields: object) -> str:
    base: dict[str, object] = {
        "title": "T",
        "kind": "guide",
        "status": "active",
        "last_verified": TODAY,
    }
    base.update(fields)
    return "---\n" + yaml.safe_dump(base, sort_keys=False) + "---\n"


@pytest.fixture
def docs_repo(tmp_path: Path):
    real_config = (find_root() / "harness/config/docs.yaml").read_text(encoding="utf-8")

    def build(files: dict[str, str] | None = None) -> Path:
        base = {
            "pyproject.toml": "[project]\nname='demo'\n",
            "harness/config/docs.yaml": real_config,
            "harness/checks/rules.py": 'RULE = "ARCH010"\n',
            "src/demo/mod.py": MODULE_SRC,
            "docs/index.md": front() + "# Index\n[guide](guide.md)\n",
            "docs/guide.md": front() + "# Guide\n",
        }
        base.update(files or {})
        for name, content in base.items():
            target = tmp_path / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        return tmp_path

    return build


def codes(root: Path, now: dt.date = TODAY) -> list[str]:
    return sorted({v.code for v in docs.run(root, now)})


def verified_guide(root: Path) -> None:
    path = root / "docs/guide.md"
    path.write_text(front(covers=["src/demo/*.py"]) + "# Guide\n", encoding="utf-8")
    docs.reverify(root, path, "initial", TODAY)


def test_clean_repo_passes(docs_repo):
    assert docs.run(docs_repo(), TODAY) == []


def test_real_repository_docs_are_clean():
    assert docs.run(find_root()) == []


def test_missing_front_matter(docs_repo):
    root = docs_repo({"docs/guide.md": "# no front matter\n"})
    assert "DOC001" in codes(root)


def test_missing_required_key(docs_repo):
    root = docs_repo({"docs/guide.md": "---\ntitle: x\n---\nbody\n"})
    assert "DOC001" in codes(root)


def test_invalid_kind_and_status(docs_repo):
    root = docs_repo({"docs/guide.md": front(kind="essay", status="wip") + "x\n"})
    assert codes(root) == ["DOC002"]


def test_doc_goes_stale_when_covered_code_changes(docs_repo):
    root = docs_repo()
    verified_guide(root)
    assert docs.run(root, TODAY) == []
    (root / "src/demo/mod.py").write_text(MODULE_SRC.replace("a + b", "a - b"), encoding="utf-8")
    assert codes(root) == ["DOC010"]


def test_comment_and_docstring_changes_do_not_make_docs_stale(docs_repo):
    root = docs_repo()
    verified_guide(root)
    noisy = (
        '"""Another docstring."""\n\n# a comment\n\ndef add(a, b):\n    """x"""\n    return a + b\n'
    )
    (root / "src/demo/mod.py").write_text(noisy, encoding="utf-8")
    assert docs.run(root, TODAY) == []


def test_new_covered_file_makes_doc_stale(docs_repo):
    root = docs_repo()
    verified_guide(root)
    (root / "src/demo/extra.py").write_text("X = 1\n", encoding="utf-8")
    assert codes(root) == ["DOC010"]


def test_reverify_clears_staleness_and_logs_the_note(docs_repo):
    root = docs_repo()
    verified_guide(root)
    (root / "src/demo/mod.py").write_text(MODULE_SRC.replace("a + b", "a * b"), encoding="utf-8")
    docs.reverify(root, root / "docs/guide.md", "checked add() docs", TODAY)
    assert docs.run(root, TODAY) == []
    data, _ = split_front_matter((root / "docs/guide.md").read_text(encoding="utf-8"))
    assert data is not None and "checked add() docs" in data["verification_log"][-1]


def test_reverify_requires_a_note(docs_repo):
    root = docs_repo()
    with pytest.raises(SystemExit):
        docs.reverify(root, root / "docs/guide.md", "  ", TODAY)


def test_verification_log_keeps_only_recent_entries(docs_repo):
    root = docs_repo()
    verified_guide(root)
    for index in range(8):
        docs.reverify(root, root / "docs/guide.md", f"n{index}", TODAY)
    data, _ = split_front_matter((root / "docs/guide.md").read_text(encoding="utf-8"))
    assert data is not None and len(data["verification_log"]) == 5


def test_covers_without_hash_is_flagged(docs_repo):
    root = docs_repo({"docs/guide.md": front(covers=["src/demo/*.py"]) + "x\n"})
    assert codes(root) == ["DOC011"]


def test_covers_matching_nothing_is_flagged(docs_repo):
    root = docs_repo({"docs/guide.md": front(covers=["src/nothing/*.py"]) + "x\n"})
    assert codes(root) == ["DOC012"]


def test_old_docs_expire_by_kind(docs_repo):
    old = TODAY - dt.timedelta(days=61)
    root = docs_repo({"docs/guide.md": front(last_verified=old) + "x\n"})
    assert codes(root) == ["DOC020"]


def test_decisions_never_expire_by_age(docs_repo):
    ancient = TODAY - dt.timedelta(days=900)
    root = docs_repo(adr_files(last_verified=ancient))
    assert "DOC020" not in codes(root)


def test_future_verification_date_is_flagged(docs_repo):
    root = docs_repo({"docs/guide.md": front(last_verified=TODAY + dt.timedelta(days=3)) + "x\n"})
    assert codes(root) == ["DOC021"]


def test_broken_link_and_dead_path_reference(docs_repo):
    body = "# G\n[gone](missing.md)\nSee `src/demo/nope.py` and `src/demo/mod.py`.\n"
    root = docs_repo({"docs/guide.md": front() + body})
    assert codes(root) == ["DOC030", "DOC031"]


def test_fenced_code_is_not_checked_for_links_or_paths(docs_repo):
    body = "# G\n```\n[gone](missing.md) `src/demo/nope.py`\n```\n"
    root = docs_repo({"docs/guide.md": front() + body})
    assert docs.run(root, TODAY) == []


def test_external_links_and_anchors_are_ignored(docs_repo):
    body = "# G\n[x](https://example.com) [y](#section)\n"
    root = docs_repo({"docs/guide.md": front() + body})
    assert docs.run(root, TODAY) == []


def test_orphan_doc_is_flagged(docs_repo):
    root = docs_repo({"docs/orphan.md": front() + "x\n"})
    assert codes(root) == ["DOC040"]


def test_transitively_linked_doc_is_not_an_orphan(docs_repo):
    root = docs_repo(
        {"docs/guide.md": front() + "[deep](deep.md)\n", "docs/deep.md": front() + "x\n"}
    )
    assert docs.run(root, TODAY) == []


def test_overlong_doc_is_flagged(docs_repo):
    root = docs_repo({"docs/guide.md": front() + "line\n" * 401})
    assert codes(root) == ["DOC050"]


def test_agents_md_has_a_tighter_limit(docs_repo):
    root = docs_repo({"AGENTS.md": front() + "line\n" * 125})
    assert codes(root) == ["DOC050"]


def test_completed_plans_must_be_archived(docs_repo):
    files = {
        "docs/exec-plans/completed/p.md": front(kind="plan"),
        "docs/guide.md": front() + "[p](exec-plans/completed/p.md)\n",
    }
    assert codes(docs_repo(files)) == ["DOC060"]


# ------------------------------------------------------------------------------------- ADRs


def adr_body() -> str:
    return "# Decision\nWe do X because Y.\n"


def adr_files(**overrides: object) -> dict[str, str]:
    fields: dict[str, object] = {
        "kind": "decision",
        "enforced_by": ["ARCH010"],
        "last_verified": TODAY,
    }
    fields.update(overrides)
    return {
        "docs/design-docs/adr/0001-x.md": front(**fields) + adr_body(),
        "docs/guide.md": front() + "[adr](design-docs/adr/0001-x.md)\n",
    }


def sealed(root: Path) -> None:
    docs.seal_adr(root / "docs/design-docs/adr/0001-x.md")


def test_unsealed_accepted_adr_is_flagged_then_sealed_passes(docs_repo):
    root = docs_repo(adr_files())
    assert codes(root) == ["DOC071"]
    sealed(root)
    assert docs.run(root, TODAY) == []


def test_editing_a_sealed_adr_body_is_flagged(docs_repo):
    root = docs_repo(adr_files())
    sealed(root)
    adr = root / "docs/design-docs/adr/0001-x.md"
    adr.write_text(
        adr.read_text(encoding="utf-8").replace("because Y", "because Z"), encoding="utf-8"
    )
    assert codes(root) == ["DOC070"]


def test_changing_adr_front_matter_status_does_not_break_the_seal(docs_repo):
    root = docs_repo(adr_files())
    sealed(root)
    (root / "docs/design-docs/adr/0002-y.md").write_text(
        front(kind="decision", enforced_by=["ARCH010"]) + "n\n"
    )
    adr = root / "docs/design-docs/adr/0001-x.md"
    data, body = split_front_matter(adr.read_text(encoding="utf-8"))
    assert data is not None
    data.update(status="superseded", superseded_by="0002-y.md")
    docs._write_front_matter(adr, data, body)
    assert "DOC070" not in codes(root)


def test_superseded_adr_needs_an_existing_successor(docs_repo):
    root = docs_repo(adr_files(status="superseded", superseded_by="9999-none.md"))
    sealed(root)
    assert codes(root) == ["DOC060"]


def test_adr_must_say_how_it_is_enforced(docs_repo):
    files = adr_files()
    files["docs/design-docs/adr/0001-x.md"] = (
        front(kind="decision", last_verified=TODAY) + adr_body()
    )
    root = docs_repo(files)
    sealed(root)
    assert codes(root) == ["DOC080"]


def test_adr_enforced_by_unknown_rule_or_missing_test_is_flagged(docs_repo):
    for bad in (["ARCH999"], ["tests/spec/test_missing.py::test_x"]):
        root = docs_repo(adr_files(enforced_by=bad))
        sealed(root)
        assert codes(root) == ["DOC080"], bad


def test_adr_without_mechanical_enforcement_must_explain_why(docs_repo):
    root = docs_repo(adr_files(enforced_by=["none"]))
    sealed(root)
    assert codes(root) == ["DOC080"]
    root = docs_repo(adr_files(enforced_by=["none"], no_enforcement_reason="taste, not checkable"))
    sealed(root)
    assert docs.run(root, TODAY) == []


def test_adr_outside_adr_dir_is_flagged(docs_repo):
    root = docs_repo({"docs/guide.md": front(kind="decision", enforced_by=["ARCH010"]) + "x\n"})
    assert "DOC060" in codes(root)
