"""Technical debt control (REQ-022).

Debt is allowed only when it is written down. Rules:

- DEBT001 TODO/FIXME/HACK/XXX comment without a ``(TD-NNNN)`` reference
- DEBT002 marker or waiver points at an unknown or closed debt item
- DEBT010 register entry is malformed or duplicated
- DEBT011 open item is past its due date
- DEBT012 open-debt budget exceeded
- DEBT013 closed item still has markers or waivers in code
- DEBT020 file too long, DEBT021 function too long, DEBT022 too complex, DEBT023 too many params
- DEBT030 baseline entry is stale (violation fixed): remove it so the ratchet tightens
- DEBT031 a baselined violation got worse
- DEBT032 waiver comment no longer needed
- DEBT033 (with --base) the baseline gained an entry or a value went up

Size/complexity violations are tolerated only via the ratchet baseline (which can shrink, never
grow) or an inline ``# debt-ok: TD-NNNN`` waiver pointing at an open register item.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import io
import json
import re
import sys
import tokenize
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from harness.checks.debtmeasure import measure_file
from harness.common import Violation, as_date, find_root, finish, git, load_yaml, rel, today

CONFIG_PATH = Path("harness/config/debt.yaml")
ID_RE = re.compile(r"TD-\d{4}")
WAIVER_RE = re.compile(r"#\s*debt-ok:\s*(TD-\d{4})")
SEVERITIES = {"low", "medium", "high"}
STATUSES = {"open", "done", "wontfix"}
REQUIRED_FIELDS = ("id", "title", "severity", "cost", "created", "due", "status")


@dataclasses.dataclass(frozen=True)
class DebtConfig:
    register: str
    baseline: str
    marker_dirs: list[str]
    quality_dirs: list[str]
    markers: list[str]
    max_open: int
    max_open_high: int
    limits: dict[str, int]

    @staticmethod
    def load(root: Path) -> DebtConfig:
        raw: dict[str, Any] = load_yaml(root / CONFIG_PATH)
        return DebtConfig(
            register=raw["register"],
            baseline=raw["baseline"],
            marker_dirs=list(raw["marker_dirs"]),
            quality_dirs=list(raw["quality_dirs"]),
            markers=list(raw["markers"]),
            max_open=int(raw["max_open"]),
            max_open_high=int(raw["max_open_high"]),
            limits=dict(raw["limits"]),
        )


def python_files(root: Path, dirs: Sequence[str]) -> Iterator[Path]:
    for directory in dirs:
        base = root / directory
        if base.is_dir():
            yield from (p for p in sorted(base.rglob("*.py")) if "__pycache__" not in p.parts)


# --------------------------------------------------------------------------- register


def load_register(root: Path, config: DebtConfig) -> list[dict[str, Any]]:
    path = root / config.register
    if not path.exists():
        return []
    raw = load_yaml(path) or {}
    return list(raw.get("items") or [])


def check_register(
    root: Path, config: DebtConfig, items: list[dict[str, Any]], now: dt.date
) -> list[Violation]:
    out: list[Violation] = []
    seen: set[str] = set()
    open_items: list[dict[str, Any]] = []
    for item in items:
        problems = _item_problems(config, item, seen, now)
        out.extend(problems)
        seen.add(str(item.get("id", "?")))
        if item.get("status") == "open" and not any(v.code == "DEBT010" for v in problems):
            open_items.append(item)
    out.extend(_budget_problems(config, open_items))
    return out


def _bad(config: DebtConfig, ident: str, message: str, fix: str) -> Violation:
    return Violation("DEBT010", config.register, 0, f"{ident}: {message}", fix)


def _item_problems(
    config: DebtConfig, item: dict[str, Any], seen: set[str], now: dt.date
) -> list[Violation]:
    ident = str(item.get("id", "?"))
    missing = [f for f in REQUIRED_FIELDS if not item.get(f)]
    if missing:
        return [
            _bad(
                config,
                ident,
                f"missing {', '.join(missing)}",
                "Fill every field: " + ", ".join(REQUIRED_FIELDS) + ".",
            )
        ]
    out: list[Violation] = []
    if not ID_RE.fullmatch(ident) or ident in seen:
        out.append(_bad(config, ident, "id must be unique TD-NNNN", "Use the next free TD-NNNN."))
    if item["severity"] not in SEVERITIES or item["status"] not in STATUSES:
        out.append(
            _bad(
                config,
                ident,
                "bad severity or status",
                f"severity in {sorted(SEVERITIES)}, status in {sorted(STATUSES)}.",
            )
        )
    return out + _date_and_status_problems(config, ident, item, now)


def _date_and_status_problems(
    config: DebtConfig, ident: str, item: dict[str, Any], now: dt.date
) -> list[Violation]:
    due, created = as_date(item["due"]), as_date(item["created"])
    if due is None or created is None:
        return [_bad(config, ident, "created/due must be ISO dates", "Use YYYY-MM-DD.")]
    out: list[Violation] = []
    if item["status"] in {"done", "wontfix"} and not item.get("resolution"):
        out.append(
            _bad(
                config,
                ident,
                "closed without a resolution",
                "Say how it was resolved, or why it will not be.",
            )
        )
    if item["status"] == "open" and due < now:
        out.append(
            Violation(
                "DEBT011",
                config.register,
                0,
                f"{ident} '{item['title']}' was due {due.isoformat()}",
                "Pay it down now. Extending `due` is allowed only with a note in `cost` "
                "explaining what changed.",
            )
        )
    return out


def _budget_problems(config: DebtConfig, open_items: list[dict[str, Any]]) -> list[Violation]:
    high = sum(1 for i in open_items if i["severity"] == "high")
    if len(open_items) <= config.max_open and high <= config.max_open_high:
        return []
    return [
        Violation(
            "DEBT012",
            config.register,
            0,
            f"{len(open_items)} open items ({high} high); budget is {config.max_open} "
            f"({config.max_open_high} high)",
            "Resolve existing debt before adding more. Debt is paid continuously, not in bursts.",
        )
    ]


# --------------------------------------------------------------------------- markers & waivers


def _comments(path: Path) -> Iterator[tuple[int, str]]:
    source = path.read_text(encoding="utf-8")
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type == tokenize.COMMENT:
                yield token.start[0], token.string
    except tokenize.TokenError:
        return


def check_markers(root: Path, config: DebtConfig, items: list[dict[str, Any]]) -> list[Violation]:
    """Every debt marker must cite an open register item; waivers likewise."""
    status = {str(i.get("id")): str(i.get("status")) for i in items}
    marker_re = re.compile(r"\b(" + "|".join(config.markers) + r")\b(\((TD-\d{4})\))?")
    out: list[Violation] = []
    for path in python_files(root, config.marker_dirs):
        name = rel(root, path)
        for line, text in _comments(path):
            for match in marker_re.finditer(text):
                ident = match.group(3)
                if ident is None:
                    out.append(
                        Violation(
                            "DEBT001",
                            name,
                            line,
                            f"{match.group(1)} comment is not tracked",
                            f"Add an entry to {config.register} and write "
                            f"{match.group(1)}(TD-NNNN), or fix it now and delete the comment.",
                        )
                    )
                    continue
                out.extend(_reference_problems(name, line, ident, status))
            for waiver in WAIVER_RE.finditer(text):
                out.extend(_reference_problems(name, line, waiver.group(1), status))
    return out


def _reference_problems(
    name: str, line: int, ident: str, status: dict[str, str]
) -> list[Violation]:
    state = status.get(ident)
    if state is None:
        return [
            Violation(
                "DEBT002",
                name,
                line,
                f"{ident} is not in the register",
                "Add it to the register or fix the id.",
            )
        ]
    if state != "open":
        return [
            Violation(
                "DEBT013",
                name,
                line,
                f"{ident} is {state} but code still references it",
                "Delete the marker or waiver (the debt is resolved), or reopen the item.",
            )
        ]
    return []


# --------------------------------------------------------------------------- size & complexity


def load_baseline(root: Path, config: DebtConfig) -> dict[str, int]:
    path = root / config.baseline
    return (
        {str(k): int(v) for k, v in json.loads(path.read_text(encoding="utf-8")).items()}
        if path.exists()
        else {}
    )


def check_quality(
    root: Path, config: DebtConfig, items: list[dict[str, Any]]
) -> tuple[list[Violation], set[tuple[str, int]]]:
    """Return violations and the set of (file, line) waivers that were actually needed."""
    status = {str(i.get("id")): str(i.get("status")) for i in items}
    baseline = load_baseline(root, config)
    out: list[Violation] = []
    used_waivers: set[tuple[str, int]] = set()
    current: dict[str, int] = {}
    for path in python_files(root, config.quality_dirs):
        lines = path.read_text(encoding="utf-8").splitlines()
        for measure in measure_file(root, config.limits, path):
            current[measure.key] = measure.value
            if measure.key in baseline:
                if measure.value > baseline[measure.key]:
                    out.append(
                        Violation(
                            "DEBT031",
                            measure.path,
                            measure.line,
                            f"{measure.what} grew {baseline[measure.key]} -> {measure.value}",
                            "Baselined debt may only shrink. Refactor back below the baseline.",
                        )
                    )
                continue
            waiver = _find_waiver(lines, measure.line)
            if waiver and status.get(waiver[1]) == "open":
                used_waivers.add((measure.path, waiver[0]))
                continue
            out.append(
                Violation(
                    measure.code,
                    measure.path,
                    measure.line,
                    f"{measure.what} is {measure.value} (limit {measure.limit})",
                    "Split it up. If it cannot be fixed now, register debt and add "
                    "`# debt-ok: TD-NNNN` on that line.",
                )
            )
    for key in baseline:
        if key not in current:
            out.append(
                Violation(
                    "DEBT030",
                    config.baseline,
                    0,
                    f"baseline entry '{key}' no longer violates",
                    "Run: python -m harness.checks.debt ratchet (removes fixed entries).",
                )
            )
    return out, used_waivers


def _find_waiver(lines: list[str], line: int) -> tuple[int, str] | None:
    for number in {line, 1}:
        if 0 < number <= len(lines):
            match = WAIVER_RE.search(lines[number - 1])
            if match:
                return number, match.group(1)
    return None


def check_unused_waivers(
    root: Path, config: DebtConfig, used: set[tuple[str, int]]
) -> list[Violation]:
    out: list[Violation] = []
    for path in python_files(root, config.quality_dirs):
        name = rel(root, path)
        for line, text in _comments(path):
            if WAIVER_RE.search(text) and (name, line) not in used:
                out.append(
                    Violation(
                        "DEBT032",
                        name,
                        line,
                        "debt-ok waiver but nothing needs it",
                        "Delete the waiver (and close the debt item if it is resolved).",
                    )
                )
    return out


def check_baseline_against(root: Path, config: DebtConfig, base: str) -> list[Violation]:
    """The baseline is a ratchet: against ``base`` it may only lose entries or lower values."""
    old_text = git(root, "show", f"{base}:{config.baseline}")
    if old_text is None:
        return []
    old = {str(k): int(v) for k, v in json.loads(old_text).items()}
    out: list[Violation] = []
    for key, value in sorted(load_baseline(root, config).items()):
        if key not in old or value > old[key]:
            out.append(
                Violation(
                    "DEBT033",
                    config.baseline,
                    0,
                    f"baseline entry '{key}' was added or raised "
                    f"(was {old.get(key, 'absent')}, now {value})",
                    "Never grow the baseline. Fix the code, or register debt and use a waiver.",
                )
            )
    return out


def run(root: Path, now: dt.date | None = None, base: str | None = None) -> list[Violation]:
    config = DebtConfig.load(root)
    now = now or today()
    items = load_register(root, config)
    violations = check_register(root, config, items, now)
    violations.extend(check_markers(root, config, items))
    quality, used = check_quality(root, config, items)
    violations.extend(quality)
    violations.extend(check_unused_waivers(root, config, used))
    if base:
        violations.extend(check_baseline_against(root, config, base))
    return violations


def ratchet(root: Path) -> list[str]:
    """Tighten the baseline: drop fixed entries and lower values. Never adds or raises entries."""
    config = DebtConfig.load(root)
    baseline = load_baseline(root, config)
    current: dict[str, int] = {}
    for path in python_files(root, config.quality_dirs):
        for measure in measure_file(root, config.limits, path):
            current[measure.key] = measure.value
    updated = {k: min(v, current[k]) for k, v in baseline.items() if k in current}
    (root / config.baseline).write_text(
        json.dumps(updated, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return sorted(set(baseline) - set(updated))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Technical debt checks")
    parser.add_argument("--root", type=Path, default=None)
    sub = parser.add_subparsers(dest="command")
    check = sub.add_parser("check")
    check.add_argument("--base", default=None)
    sub.add_parser("ratchet")
    args = parser.parse_args(argv)
    root = find_root(args.root)
    if args.command == "ratchet":
        removed = ratchet(root)
        print(
            f"ratchet: removed {len(removed)} fixed baseline "
            f"{'entry' if len(removed) == 1 else 'entries'}"
        )
        return 0
    return finish("debt", run(root, base=getattr(args, "base", None)))


if __name__ == "__main__":
    sys.exit(main())
