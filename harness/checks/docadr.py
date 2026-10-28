"""ADR rules: sealing, supersession and enforcement links (DOC060, DOC070, DOC071, DOC080)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from harness.checks.docprint import body_fingerprint
from harness.common import Violation, rel


def check_adr(root: Path, path: Path, data: dict[str, Any], body: str) -> list[Violation]:
    name = rel(root, path)
    out: list[Violation] = []
    sealed = data.get("decision_hash")
    if data.get("status") in {"active", "superseded"}:
        if sealed is None:
            out.append(
                Violation(
                    "DOC071",
                    name,
                    1,
                    "accepted ADR has no decision_hash",
                    f"Seal it: python -m harness.checks.docs seal-adr {name}",
                )
            )
        elif sealed != body_fingerprint(body):
            out.append(
                Violation(
                    "DOC070",
                    name,
                    1,
                    "an accepted ADR's body was edited (ADRs are immutable)",
                    "Revert the edit. To change a decision, write a new ADR that supersedes this "
                    "one and set superseded_by here.",
                )
            )
    if data.get("status") == "superseded":
        target = data.get("superseded_by")
        if not target or not (path.parent / str(target)).exists():
            out.append(
                Violation(
                    "DOC060",
                    name,
                    1,
                    "superseded ADR needs an existing superseded_by file",
                    "Set superseded_by to the filename of the ADR that replaces it.",
                )
            )
    out.extend(_check_enforcement(root, name, data))
    return out


def _check_enforcement(root: Path, name: str, data: dict[str, Any]) -> list[Violation]:
    enforced = data.get("enforced_by")
    if not isinstance(enforced, list) or not enforced:
        return [
            Violation(
                "DOC080",
                name,
                1,
                "ADR has no enforced_by list",
                "List the rule codes or tests that enforce it, or ['none'] plus "
                "a 'no_enforcement_reason'.",
            )
        ]
    if enforced == ["none"]:
        if data.get("no_enforcement_reason"):
            return []
        return [
            Violation(
                "DOC080",
                name,
                1,
                "enforced_by: [none] needs no_enforcement_reason",
                "Explain why the decision cannot be checked mechanically.",
            )
        ]
    check_text = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted((root / "harness").rglob("*.py"))
    )
    out: list[Violation] = []
    for item in map(str, enforced):
        if re.fullmatch(r"[A-Z]{2,6}\d{3}", item):
            if f'"{item}"' not in check_text:
                out.append(
                    Violation(
                        "DOC080",
                        name,
                        1,
                        f"rule code {item} is not defined by any check",
                        "Use a real rule code from harness/checks/ or a test path.",
                    )
                )
        elif not (root / item.split("::")[0]).exists():
            out.append(
                Violation(
                    "DOC080",
                    name,
                    1,
                    f"enforcement target '{item}' does not exist",
                    "Point enforced_by at an existing test file or rule code.",
                )
            )
    return out
