"""Banned constructs and nondeterminism sources in src/ (ARCH050, ARCH051, ARCH052)."""

from __future__ import annotations

import ast
from pathlib import Path

from harness.checks.archmodel import Config, ModuleInfo
from harness.checks.astutil import dotted, in_scope
from harness.common import Violation, rel

NONDETERMINISTIC_CALLS = frozenset(
    {
        "random.random",
        "random.randint",
        "random.randrange",
        "random.choice",
        "random.choices",
        "random.shuffle",
        "random.uniform",
        "random.sample",
        "random.gauss",
        "random.seed",
        "datetime.now",
        "datetime.utcnow",
        "datetime.today",
        "date.today",
        "time.time",
        "time.time_ns",
        "time.monotonic",
        "time.perf_counter",
        "uuid.uuid1",
        "uuid.uuid4",
        "os.urandom",
    }
)
NONDETERMINISTIC_FROM_IMPORTS = {
    "time": {"time", "time_ns", "monotonic", "perf_counter"},
    "uuid": {"uuid1", "uuid4"},
    "random": None,  # anything except Random / SystemRandom is global state
}


def check_constructs(root: Path, config: Config, modules: dict[str, ModuleInfo]) -> list[Violation]:
    violations: list[Violation] = []
    for name, info in modules.items():
        tree = ast.parse(info.path.read_text(encoding="utf-8"), filename=str(info.path))
        path = rel(root, info.path)
        nondeterminism_ok = in_scope(name, config.nondeterminism_allowed)
        for node in ast.walk(tree):
            violations.extend(_check_node(config, node, path, nondeterminism_ok))
    return violations


def _check_node(
    config: Config, node: ast.AST, path: str, nondeterminism_ok: bool
) -> list[Violation]:
    line = getattr(node, "lineno", 0)
    if isinstance(node, ast.Call):
        return _check_call(config, node, path, line, nondeterminism_ok)
    if isinstance(node, ast.ExceptHandler) and node.type is None:
        return [
            Violation(
                "ARCH051",
                path,
                line,
                "bare 'except:' hides failures",
                "Catch a specific exception type.",
            )
        ]
    if isinstance(node, ast.ImportFrom):
        return _check_import_from(node, path, line, nondeterminism_ok)
    return []


def _check_call(
    config: Config, node: ast.Call, path: str, line: int, nondeterminism_ok: bool
) -> list[Violation]:
    name = dotted(node.func)
    out: list[Violation] = []
    if name in config.banned_calls:
        out.append(
            Violation(
                "ARCH050",
                path,
                line,
                f"call to '{name}' is banned in src/",
                "Use the logging module for output and avoid dynamic code execution.",
            )
        )
    if not nondeterminism_ok and name and _is_nondeterministic(name):
        out.append(_nondeterminism(path, line, name))
    return out


def _from_import_is_nondeterministic(module: str | None, name: str) -> bool:
    if module not in NONDETERMINISTIC_FROM_IMPORTS:
        return False
    banned = NONDETERMINISTIC_FROM_IMPORTS[module]
    return name not in {"Random", "SystemRandom"} if banned is None else name in banned


def _check_import_from(
    node: ast.ImportFrom, path: str, line: int, nondeterminism_ok: bool
) -> list[Violation]:
    out: list[Violation] = []
    if any(alias.name == "*" for alias in node.names):
        out.append(
            Violation(
                "ARCH051",
                path,
                line,
                "'import *' defeats the public API check",
                "Import the names you use explicitly.",
            )
        )
    if not nondeterminism_ok:
        out.extend(
            _nondeterminism(path, line, f"{node.module}.{alias.name}")
            for alias in node.names
            if _from_import_is_nondeterministic(node.module, alias.name)
        )
    return out


def _is_nondeterministic(name: str) -> bool:
    return any(name == banned or name.endswith("." + banned) for banned in NONDETERMINISTIC_CALLS)


def _nondeterminism(path: str, line: int, name: str) -> Violation:
    return Violation(
        "ARCH052",
        path,
        line,
        f"'{name}' is a source of nondeterminism (REQ-001: same input and seed, same result)",
        "Take a Clock or an Rng from terrarium.kernel as a parameter instead of reading the "
        "environment directly.",
    )
