"""Small AST and module-name helpers shared by several checks."""

from __future__ import annotations

import ast
from collections.abc import Sequence


def dotted(node: ast.AST) -> str:
    """``a.b.c`` for a Name/Attribute chain, else an empty string."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return ""


def in_scope(module: str, prefixes: Sequence[str]) -> bool:
    """True when ``module`` equals or is nested under one of the dotted ``prefixes``."""
    return any(module == p or module.startswith(p + ".") for p in prefixes)
