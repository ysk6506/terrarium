"""Shared helpers for harness checks: violations, repo discovery, front matter, git."""

from __future__ import annotations

import dataclasses
import datetime as dt
import os
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import yaml

FRONT_MATTER_DELIMITER = "---"


@dataclasses.dataclass(frozen=True, order=True)
class Violation:
    """One failed rule. ``fix`` is written for an agent that will read it cold."""

    code: str
    path: str
    line: int
    message: str
    fix: str

    def render(self) -> str:
        location = f"{self.path}:{self.line}" if self.line else self.path
        return f"[{self.code}] {location}\n    problem: {self.message}\n    fix: {self.fix}"


def find_root(start: Path | None = None) -> Path:
    """Walk up from ``start`` until the terrarium repo root is found."""
    here = (start or Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "harness" / "config").is_dir() and (candidate / "pyproject.toml").is_file():
            return candidate
    raise RuntimeError("terrarium repo root not found (needs pyproject.toml and harness/config)")


def today() -> dt.date:
    """Today's date; ``TERRARIUM_TODAY=YYYY-MM-DD`` pins it for deterministic runs."""
    override = os.environ.get("TERRARIUM_TODAY")
    return dt.date.fromisoformat(override) if override else dt.date.today()


def load_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def as_date(value: Any) -> dt.date | None:
    """Coerce a YAML scalar (date or ISO string) to a date, or None when not parseable."""
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value)
        except ValueError:
            return None
    return None


def split_front_matter(text: str) -> tuple[dict[str, Any] | None, str]:
    """Split ``---`` delimited YAML front matter from a markdown body."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != FRONT_MATTER_DELIMITER:
        return None, text
    for index in range(1, len(lines)):
        if lines[index].strip() == FRONT_MATTER_DELIMITER:
            data = yaml.safe_load("\n".join(lines[1:index])) or {}
            if not isinstance(data, dict):
                return None, text
            return data, "\n".join(lines[index + 1 :])
    return None, text


def git(root: Path, *args: str) -> str | None:
    """Run git in ``root``; None when git is missing or the command fails."""
    try:
        result = subprocess.run(
            ["git", *args], cwd=root, capture_output=True, text=True, check=False
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def rel(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def finish(name: str, violations: Sequence[Violation]) -> int:
    """Print a result block and return a process exit code."""
    if not violations:
        print(f"OK   {name}")
        return 0
    print(f"FAIL {name}: {len(violations)} violation(s)\n")
    for violation in sorted(violations):
        print(violation.render())
        print()
    return 1
