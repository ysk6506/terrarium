"""Import-graph algorithms used by the architecture check."""

from __future__ import annotations

import sys


def find_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    """Tarjan strongly connected components with more than one member (or a self loop)."""
    index = 0
    stack: list[str] = []
    on_stack: set[str] = set()
    indices: dict[str, int] = {}
    low: dict[str, int] = {}
    cycles: list[list[str]] = []

    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10_000))

    def visit(node: str) -> None:
        nonlocal index
        indices[node] = low[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)
        for succ in sorted(graph.get(node, ())):
            if succ not in graph:
                continue
            if succ not in indices:
                visit(succ)
                low[node] = min(low[node], low[succ])
            elif succ in on_stack:
                low[node] = min(low[node], indices[succ])
        if low[node] == indices[node]:
            component: list[str] = []
            while True:
                member = stack.pop()
                on_stack.discard(member)
                component.append(member)
                if member == node:
                    break
            if len(component) > 1 or node in graph.get(node, ()):
                cycles.append(sorted(component))

    for node in sorted(graph):
        if node not in indices:
            visit(node)
    return cycles
