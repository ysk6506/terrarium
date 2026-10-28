"""Architecture enforcement (REQ-021).

Rules (codes are stable; tests reference them):

- ARCH001 unknown top-level package under src/<package>: new layers need an ADR + config change
- ARCH002 module sitting at the package root that is not declared in ``root_modules``
- ARCH003 layer in config has no directory (config drift)
- ARCH010 layer dependency not allowed by ``layers.<name>.may_import``
- ARCH011 cross-layer import bypasses the layer's public API (``terrarium.<layer>``)
- ARCH012 isolated sibling packages import each other
- ARCH020 third-party import outside its allowed scope
- ARCH030 import cycle
- ARCH040 layer ``__init__.py`` does not define ``__all__``
- ARCH050 banned call (print, eval, ...)
- ARCH051 bare ``except:`` or ``import *``
- ARCH052 nondeterminism source outside the allowed modules
"""

from __future__ import annotations

import argparse
import ast
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path

from harness.checks.archmodel import CONFIG_PATH, Config, ModuleInfo, discover_modules, layer_of
from harness.checks.astutil import in_scope
from harness.checks.constructs import check_constructs
from harness.checks.importgraph import find_cycles
from harness.common import Violation, find_root, finish, rel

CONFIG_HINT = (
    "If the rule itself is wrong, write an ADR (docs/design-docs/adr/) and then change "
    "harness/config/architecture.yaml; otherwise change the code."
)


def _normalize_internal(target: str, known: dict[str, ModuleInfo]) -> str:
    """Reduce ``pkg.mod.Symbol`` to the deepest known module prefix."""
    parts = target.split(".")
    for end in range(len(parts), 0, -1):
        candidate = ".".join(parts[:end])
        if candidate in known:
            return candidate
    return target


def iter_imports(
    tree: ast.AST, module: ModuleInfo, config: Config, known: dict[str, ModuleInfo]
) -> Iterator[tuple[int, str, bool]]:
    """Yield (line, target, internal). Targets for internal imports are known modules."""
    package_name = module.name if module.is_package else module.name.rpartition(".")[0]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield from _classify(node.lineno, alias.name, config, known)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                anchor = package_name.split(".")
                if node.level > 1:
                    anchor = anchor[: -(node.level - 1)]
                base = ".".join([*anchor, *([node.module] if node.module else [])])
            else:
                base = node.module or ""
            for alias in node.names:
                candidate = f"{base}.{alias.name}"
                target = candidate if candidate in known else base
                yield from _classify(node.lineno, target, config, known)


def _classify(
    line: int, target: str, config: Config, known: dict[str, ModuleInfo]
) -> Iterator[tuple[int, str, bool]]:
    if target == config.package or target.startswith(config.package + "."):
        yield line, _normalize_internal(target, known), True
    else:
        yield line, target, False


def check_structure(root: Path, config: Config, modules: dict[str, ModuleInfo]) -> list[Violation]:
    return [
        *_check_declared_layers(root, config),
        *_check_module_placement(root, config, modules),
        *_check_public_api_declared(root, config, modules),
    ]


def _check_declared_layers(root: Path, config: Config) -> list[Violation]:
    base = root / config.source_dir / config.package
    return [
        Violation(
            "ARCH003",
            CONFIG_PATH.as_posix(),
            0,
            f"layer '{layer}' is declared but src/{config.package}/{layer}/ does not exist",
            f"Create the package or remove the layer. {CONFIG_HINT}",
        )
        for layer in config.layers
        if not (base / layer).is_dir()
    ]


def _placement_violation(
    root: Path, config: Config, name: str, info: ModuleInfo
) -> Violation | None:
    parts = name.split(".")
    if len(parts) == 1:
        return None
    top = parts[1]
    path = rel(root, info.path)
    if len(parts) == 2 and not info.is_package:
        if top in config.root_modules:
            return None
        return Violation(
            "ARCH002",
            path,
            1,
            f"module '{top}' sits at the package root and is not declared in root_modules",
            "Move it into the layer it belongs to (see ARCHITECTURE.md).",
        )
    if top in config.layers:
        return None
    return Violation(
        "ARCH001",
        path,
        1,
        f"'{top}' is not a declared layer",
        f"Put the code in an existing layer, or add a layer via ADR. {CONFIG_HINT}",
    )


def _check_module_placement(
    root: Path, config: Config, modules: dict[str, ModuleInfo]
) -> list[Violation]:
    found = (_placement_violation(root, config, n, i) for n, i in modules.items())
    return [v for v in found if v is not None]


def _defines_all(tree: ast.Module) -> bool:
    for node in tree.body:
        if isinstance(node, ast.Assign):
            if any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
                return True
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "__all__"
        ):
            return True
    return False


def _check_public_api_declared(
    root: Path, config: Config, modules: dict[str, ModuleInfo]
) -> list[Violation]:
    out: list[Violation] = []
    for layer in config.layers:
        init = modules.get(f"{config.package}.{layer}")
        if init is None or not init.is_package:
            continue
        if not _defines_all(ast.parse(init.path.read_text(encoding="utf-8"))):
            out.append(
                Violation(
                    "ARCH040",
                    rel(root, init.path),
                    1,
                    f"layer '{layer}' __init__.py has no __all__",
                    "Define __all__ listing the layer's public API; other layers may import only "
                    "those names.",
                )
            )
    return out


def check_imports(
    root: Path, config: Config, modules: dict[str, ModuleInfo]
) -> tuple[list[Violation], dict[str, set[str]]]:
    violations: list[Violation] = []
    graph: dict[str, set[str]] = {name: set() for name in modules}
    for name, info in modules.items():
        tree = ast.parse(info.path.read_text(encoding="utf-8"), filename=str(info.path))
        path = rel(root, info.path)
        for line, target, internal in iter_imports(tree, info, config, modules):
            if internal:
                graph[name].add(target)
                violations.extend(_check_internal(config, name, path, line, target))
            else:
                violations.extend(_check_third_party(config, name, path, line, target))
    return violations, graph


def _allowed_layers(config: Config, module: str, src_layer: str | None) -> list[str] | None:
    if src_layer is not None:
        return config.layers.get(src_layer)
    parts = module.split(".")
    if len(parts) == 1:
        return []
    return config.root_modules.get(parts[1], [])


def _check_internal(
    config: Config, module: str, path: str, line: int, target: str
) -> list[Violation]:
    src_layer = layer_of(module, config)
    out: list[Violation] = []
    dst_layer = layer_of(target, config)
    if dst_layer is None or dst_layer == src_layer:
        out.extend(_check_siblings(config, module, path, line, target))
        return out
    allowed = _allowed_layers(config, module, src_layer)
    where = src_layer or "package root"
    if allowed is None or dst_layer not in allowed:
        out.append(
            Violation(
                "ARCH010",
                path,
                line,
                f"layer '{where}' must not import layer '{dst_layer}' (imports {target})",
                "Depend downward only. Move the shared code to a lower layer, or inject it through "
                f"a port defined in the lower layer. {CONFIG_HINT}",
            )
        )
    layer_root = f"{config.package}.{dst_layer}"
    if target != layer_root and target not in config.public_modules:
        out.append(
            Violation(
                "ARCH011",
                path,
                line,
                f"import of {target} reaches into layer '{dst_layer}' internals",
                f"Import from '{layer_root}' and export the name in its __all__.",
            )
        )
    return out


def _check_siblings(
    config: Config, module: str, path: str, line: int, target: str
) -> list[Violation]:
    out: list[Violation] = []
    for parent, siblings in config.isolated_siblings.items():
        src_sibling = _sibling_of(module, parent, siblings)
        dst_sibling = _sibling_of(target, parent, siblings)
        if src_sibling and dst_sibling and src_sibling != dst_sibling:
            out.append(
                Violation(
                    "ARCH012",
                    path,
                    line,
                    f"'{src_sibling}' and '{dst_sibling}' under {parent} must not know each other "
                    f"(imports {target})",
                    f"Move shared code into a module of {parent} outside the isolated siblings, "
                    "or into a lower layer such as spatial.",
                )
            )
    return out


def _sibling_of(module: str, parent: str, siblings: Sequence[str]) -> str | None:
    for sibling in siblings:
        if in_scope(module, [f"{parent}.{sibling}"]):
            return sibling
    return None


def _check_third_party(
    config: Config, module: str, path: str, line: int, target: str
) -> list[Violation]:
    top = target.split(".", maxsplit=1)[0]
    scope = config.third_party_scope.get(top)
    if scope is None or in_scope(module, scope):
        return []
    allowed = ", ".join(scope) if scope else "nowhere in src/"
    return [
        Violation(
            "ARCH020",
            path,
            line,
            f"'{top}' may only be imported from: {allowed} (found in {module})",
            "Wrap the library behind a port in a lower layer and implement it in the allowed "
            "module. " + CONFIG_HINT,
        )
    ]


def check_cycles(
    root: Path, modules: dict[str, ModuleInfo], graph: dict[str, set[str]]
) -> list[Violation]:
    return [
        Violation(
            "ARCH030",
            rel(root, modules[cycle[0]].path),
            1,
            "import cycle between: " + ", ".join(cycle),
            "Break the cycle: move the shared piece down, or depend on a Protocol defined lower.",
        )
        for cycle in find_cycles(graph)
    ]


def run(root: Path) -> list[Violation]:
    config = Config.load(root)
    modules = discover_modules(root, config)
    violations = check_structure(root, config, modules)
    import_violations, graph = check_imports(root, config, modules)
    violations.extend(import_violations)
    violations.extend(check_cycles(root, modules, graph))
    violations.extend(check_constructs(root, config, modules))
    return violations


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(argv)
    return finish("architecture", run(find_root(args.root)))


if __name__ == "__main__":
    sys.exit(main())
