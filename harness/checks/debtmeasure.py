"""Size and complexity measurements for the debt check (DEBT020-DEBT023)."""

from __future__ import annotations

import ast
import dataclasses
from collections.abc import Iterator
from pathlib import Path

from harness.common import rel


@dataclasses.dataclass(frozen=True)
class Measure:
    key: str
    code: str
    value: int
    limit: int
    path: str
    line: int
    what: str


def complexity(node: ast.AST) -> int:
    """McCabe complexity of a function body, not counting nested function definitions."""
    total = 1
    stack: list[ast.AST] = list(ast.iter_child_nodes(node))
    while stack:
        current = stack.pop()
        if isinstance(current, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda | ast.ClassDef):
            continue
        if isinstance(
            current,
            ast.If
            | ast.IfExp
            | ast.For
            | ast.AsyncFor
            | ast.While
            | ast.ExceptHandler
            | ast.match_case,
        ):
            total += 1
        elif isinstance(current, ast.BoolOp):
            total += len(current.values) - 1
        elif isinstance(current, ast.comprehension):
            total += 1 + len(current.ifs)
        stack.extend(ast.iter_child_nodes(current))
    return total


def _functions(tree: ast.AST) -> Iterator[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]]:
    def walk(
        node: ast.AST, prefix: str
    ) -> Iterator[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]]:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
                qualname = f"{prefix}{child.name}"
                yield qualname, child
                yield from walk(child, qualname + ".")
            elif isinstance(child, ast.ClassDef):
                yield from walk(child, f"{prefix}{child.name}.")
            else:
                yield from walk(child, prefix)

    yield from walk(tree, "")


def measure_file(root: Path, limits: dict[str, int], path: Path) -> list[Measure]:
    name = rel(root, path)
    text = path.read_text(encoding="utf-8")
    measures: list[Measure] = []
    lines = len(text.splitlines())
    if lines > limits["max_file_lines"]:
        measures.append(
            Measure(
                f"{name}::<file>::lines",
                "DEBT020",
                lines,
                limits["max_file_lines"],
                name,
                1,
                "file length (lines)",
            )
        )
    for qualname, node in _functions(ast.parse(text)):
        length = (node.end_lineno or node.lineno) - node.lineno + 1
        params = [
            a
            for a in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)
            if a.arg not in {"self", "cls"}
        ]
        for code, kind, value, limit, label in (
            ("DEBT021", "lines", length, limits["max_function_lines"], "function length (lines)"),
            (
                "DEBT022",
                "complexity",
                complexity(node),
                limits["max_complexity"],
                "cyclomatic complexity",
            ),
            ("DEBT023", "params", len(params), limits["max_params"], "parameter count"),
        ):
            if value > limit:
                measures.append(
                    Measure(
                        f"{name}::{qualname}::{kind}",
                        code,
                        value,
                        limit,
                        name,
                        node.lineno,
                        f"{label} of {qualname}",
                    )
                )
    return measures
