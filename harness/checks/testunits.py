"""Test units: what the test guard fingerprints and locks.

A *unit* is one test function, one helper/fixture/constant in a test module, or one expected-data
file. This module knows how to find units and measure them (assertion count, expected literals,
approx tolerances, skips). Rules and the lock live in ``testguard``.
"""

from __future__ import annotations

import ast
import copy
import dataclasses
import hashlib
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from harness.common import load_yaml, rel

CONFIG_PATH = Path("harness/config/tests.yaml")
TD_RE = re.compile(r"TD-\d{4}")


@dataclasses.dataclass(frozen=True)
class Config:
    test_dirs: list[str]
    lock: str
    data_globs: list[str]
    forbidden_addopts: list[str]
    forbidden_conftest_names: list[str]
    allowed_exclude_lines: list[str]
    min_floor: float

    @staticmethod
    def load(root: Path) -> Config:
        raw: dict[str, Any] = load_yaml(root / CONFIG_PATH)
        return Config(
            test_dirs=list(raw["test_dirs"]),
            lock=raw["lock"],
            data_globs=list(raw["data_globs"]),
            forbidden_addopts=list(raw["forbidden_addopts"]),
            forbidden_conftest_names=list(raw["forbidden_conftest_names"]),
            allowed_exclude_lines=list(raw["allowed_exclude_lines"]),
            min_floor=float(raw["min_floor"]),
        )


@dataclasses.dataclass(frozen=True)
class Unit:
    """One lockable thing: a test, a helper/fixture, or a data file."""

    key: str
    kind: str  # test | support | data
    digest: str
    path: str
    line: int
    asserts: int = 0
    literals: tuple[str, ...] = ()
    tolerances: tuple[float, ...] = ()
    skips: int = 0


# --------------------------------------------------------------------------- AST helpers


def dotted(node: ast.AST) -> str:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def _without_docstrings(node: ast.AST) -> ast.AST:
    clone = copy.deepcopy(node)
    for child in ast.walk(clone):
        body = getattr(child, "body", None)
        if (
            isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef | ast.Module)
            and body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            child.body = body[1:] or [ast.Pass()]
    return clone


def digest(node: ast.AST) -> str:
    """Fingerprint of the code's structure: ignores comments, formatting and docstrings."""
    text = ast.dump(_without_docstrings(node), include_attributes=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def is_assertion_point(node: ast.AST) -> bool:
    if isinstance(node, ast.Assert):
        return True
    if isinstance(node, ast.Call):
        name = dotted(node.func)
        last = name.rsplit(".", 1)[-1]
        return name in {"pytest.fail"} or last.startswith(("assert_", "assert"))
    if isinstance(node, ast.With | ast.AsyncWith):
        return any(
            isinstance(item.context_expr, ast.Call)
            and dotted(item.context_expr.func) in {"pytest.raises", "pytest.warns"}
            for item in node.items
        )
    return False


def count_assertions(func: ast.AST) -> int:
    return sum(1 for node in ast.walk(func) if is_assertion_point(node))


def assert_literals(func: ast.AST) -> tuple[str, ...]:
    values: list[str] = []
    for node in ast.walk(func):
        if isinstance(node, ast.Assert):
            values.extend(repr(c.value) for c in ast.walk(node.test) if isinstance(c, ast.Constant))
    return tuple(sorted(values))


def approx_tolerances(func: ast.AST) -> tuple[float, ...]:
    found: list[float] = []
    for node in ast.walk(func):
        if isinstance(node, ast.Call) and dotted(node.func).endswith("approx"):
            for keyword in node.keywords:
                value = keyword.value
                if (
                    keyword.arg in {"rel", "abs"}
                    and isinstance(value, ast.Constant)
                    and isinstance(value.value, int | float)
                ):
                    found.append(float(value.value))
    return tuple(sorted(found))


def _is_skip_name(name: str) -> bool:
    return name in {"pytest.skip", "pytest.xfail", "pytest.importorskip"} or name.startswith(
        ("pytest.mark.skip", "pytest.mark.xfail")
    )


def _skip_calls(tree: ast.AST) -> list[ast.AST]:
    """Calls and bare decorators/markers that skip or xfail; each occurrence counted once."""
    call_funcs = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    found: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = dotted(node.func)
        elif isinstance(node, ast.Attribute) and id(node) not in call_funcs:
            name = dotted(node)
        else:
            continue
        if _is_skip_name(name):
            found.append(node)
    return found


# --------------------------------------------------------------------------- unit collection


def _is_test_name(name: str) -> bool:
    return name.startswith("test")


def _unit(path: str, key: str, kind: str, node: ast.AST) -> Unit:
    return Unit(
        key=key,
        kind=kind,
        digest=digest(node),
        path=path,
        line=getattr(node, "lineno", 1),
        asserts=count_assertions(node) if kind == "test" else 0,
        literals=assert_literals(node) if kind == "test" else (),
        tolerances=approx_tolerances(node) if kind == "test" else (),
        skips=len(_skip_calls(node)) if kind == "test" else 0,
    )


def assign_names(node: ast.AST) -> list[str]:
    """Names a statement binds (``x = ...``); empty for ``x[i] = ...`` or ``x.attr = ...``."""
    if isinstance(node, ast.Assign):
        return [
            n.id
            for t in node.targets
            for n in ast.walk(t)
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)
        ]
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return [node.target.id]
    return []


def _is_docstring_like(node: ast.AST) -> bool:
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)


def _statement_unit(path: str, prefix: str, node: ast.AST) -> Unit:
    """A statement with no stable name (import, call, subscript assignment...): keyed by content."""
    label = "import" if isinstance(node, ast.Import | ast.ImportFrom) else "stmt"
    return _unit(path, f"{path}::{prefix}<{label}:{digest(node)[:8]}>", "support", node)


def _with_unique_keys(units: list[Unit]) -> list[Unit]:
    """Two units may share a key (``x = 1`` twice); number the repeats so none is lost."""
    seen: dict[str, int] = {}
    out: list[Unit] = []
    for unit in units:
        count = seen.get(unit.key, 0)
        seen[unit.key] = count + 1
        out.append(unit if count == 0 else dataclasses.replace(unit, key=f"{unit.key}#{count + 1}"))
    return out


def collect_units(root: Path, path: Path) -> list[Unit]:
    name = rel(root, path)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    units: list[Unit] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            kind = "test" if _is_test_name(node.name) else "support"
            units.append(_unit(name, f"{name}::{node.name}", kind, node))
        elif isinstance(node, ast.ClassDef):
            units.extend(_class_units(name, node))
        elif _is_docstring_like(node):
            continue
        elif assign_names(node):
            units.extend(_unit(name, f"{name}::={t}", "support", node) for t in assign_names(node))
        else:
            units.append(_statement_unit(name, "", node))
    return _with_unique_keys(units)


def _class_units(name: str, cls: ast.ClassDef) -> list[Unit]:
    is_test_class = cls.name.startswith("Test")
    units: list[Unit] = []
    for member in cls.body:
        if isinstance(member, ast.FunctionDef | ast.AsyncFunctionDef):
            is_test = is_test_class and _is_test_name(member.name)
            sep = "::" if is_test else "."
            key = f"{name}::{cls.name}{sep}{member.name}"
            units.append(_unit(name, key, "test" if is_test else "support", member))
        elif _is_docstring_like(member):
            continue
        elif assign_names(member):
            units.extend(
                _unit(name, f"{name}::{cls.name}.={t}", "support", member)
                for t in assign_names(member)
            )
        else:
            units.append(_statement_unit(name, f"{cls.name}.", member))
    if not units:
        units.append(_unit(name, f"{name}::{cls.name}", "support", cls))
    return units


def iter_test_files(root: Path, config: Config) -> Iterator[Path]:
    for directory in config.test_dirs:
        base = root / directory
        if base.is_dir():
            for path in sorted(base.rglob("*.py")):
                if "__pycache__" not in path.parts and (
                    path.name.startswith("test_") or path.name == "conftest.py"
                ):
                    yield path


def data_files(root: Path, config: Config) -> Iterator[Path]:
    seen: set[Path] = set()
    for pattern in config.data_globs:
        for path in sorted(root.glob(pattern)):
            if path.is_file() and path not in seen and "__pycache__" not in path.parts:
                seen.add(path)
                yield path


def current_units(root: Path, config: Config) -> dict[str, Unit]:
    units: dict[str, Unit] = {}
    for path in iter_test_files(root, config):
        for unit in collect_units(root, path):
            units[unit.key] = unit
    for path in data_files(root, config):
        name = rel(root, path)
        units[f"{name}::<data>"] = Unit(
            key=f"{name}::<data>",
            kind="data",
            path=name,
            line=1,
            digest=hashlib.sha256(path.read_bytes()).hexdigest()[:16],
        )
    return units
