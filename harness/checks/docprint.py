"""Fingerprints that let a document prove it is current (see ADR-0002)."""

from __future__ import annotations

import ast
import hashlib
from collections.abc import Iterable
from pathlib import Path

from harness.common import rel


def _strip_docstrings(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                node.body = body[1:] or [ast.Pass()]


def file_fingerprint(path: Path) -> str:
    """Python: AST without docstrings (comments/format ignored). Anything else: raw bytes."""
    data = path.read_bytes()
    if path.suffix == ".py":
        try:
            tree = ast.parse(data.decode("utf-8"))
        except SyntaxError:
            return hashlib.sha256(data).hexdigest()
        _strip_docstrings(tree)
        return hashlib.sha256(ast.dump(tree).encode("utf-8")).hexdigest()
    return hashlib.sha256(data).hexdigest()


def expand_covers(root: Path, patterns: Iterable[str]) -> list[Path]:
    found: set[Path] = set()
    for pattern in patterns:
        for match in root.glob(pattern):
            if match.is_file() and "__pycache__" not in match.parts:
                found.add(match)
            elif match.is_dir():
                found.update(
                    p for p in match.rglob("*") if p.is_file() and "__pycache__" not in p.parts
                )
    return sorted(found)


def covers_fingerprint(root: Path, patterns: Iterable[str]) -> str:
    lines = [f"{rel(root, p)}:{file_fingerprint(p)}" for p in expand_covers(root, patterns)]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:16]


def body_fingerprint(body: str) -> str:
    normalized = "\n".join(line.rstrip() for line in body.strip().splitlines())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
