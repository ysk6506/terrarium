"""REQ-025: every design decision is recorded, sealed, enforced and findable."""

from __future__ import annotations

import pytest

from harness.checks.archmodel import Config
from harness.common import find_root, split_front_matter

pytestmark = pytest.mark.req("REQ-025")

ROOT = find_root()
ADR_FILES = sorted((ROOT / "docs/design-docs/adr").glob("0*.md"))


def test_there_are_decision_records():
    assert len(ADR_FILES) >= 9


@pytest.mark.parametrize("adr", ADR_FILES, ids=lambda p: p.name)
def test_every_adr_is_sealed_enforced_and_listed_in_the_index(adr):
    data, _ = split_front_matter(adr.read_text(encoding="utf-8"))
    assert data is not None
    assert data["kind"] == "decision"
    assert data.get("decision_hash"), "ADR must be sealed"
    assert data.get("enforced_by"), "ADR must say how it is enforced"
    assert adr.name in (ROOT / "docs/index.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("layer", sorted(Config.load(ROOT).layers))
def test_every_layer_is_explained_in_the_architecture_doc(layer):
    assert f"`{layer}`" in (ROOT / "ARCHITECTURE.md").read_text(encoding="utf-8")
