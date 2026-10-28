"""Architecture contract model: the parsed config and the discovered modules."""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Any

from harness.common import load_yaml

CONFIG_PATH = Path("harness/config/architecture.yaml")


@dataclasses.dataclass(frozen=True)
class Config:
    package: str
    source_dir: str
    layers: dict[str, list[str]]
    root_modules: dict[str, list[str]]
    public_modules: frozenset[str]
    isolated_siblings: dict[str, list[str]]
    third_party_scope: dict[str, list[str]]
    banned_calls: frozenset[str]
    nondeterminism_allowed: tuple[str, ...]

    @staticmethod
    def load(root: Path) -> Config:
        raw: dict[str, Any] = load_yaml(root / CONFIG_PATH)
        return Config(
            package=raw["package"],
            source_dir=raw.get("source_dir", "src"),
            layers={name: list(spec["may_import"]) for name, spec in raw["layers"].items()},
            root_modules={k: list(v) for k, v in raw.get("root_modules", {}).items()},
            public_modules=frozenset(raw.get("public_modules") or []),
            isolated_siblings={k: list(v) for k, v in raw.get("isolated_siblings", {}).items()},
            third_party_scope={k: list(v) for k, v in raw.get("third_party_scope", {}).items()},
            banned_calls=frozenset(raw.get("banned_calls", [])),
            nondeterminism_allowed=tuple(raw.get("nondeterminism_allowed", [])),
        )


@dataclasses.dataclass(frozen=True)
class ModuleInfo:
    name: str
    path: Path
    is_package: bool


def discover_modules(root: Path, config: Config) -> dict[str, ModuleInfo]:
    base = root / config.source_dir / config.package
    modules: dict[str, ModuleInfo] = {}
    for path in sorted(base.rglob("*.py")):
        relative = path.relative_to(base.parent).with_suffix("")
        parts = list(relative.parts)
        is_package = parts[-1] == "__init__"
        if is_package:
            parts = parts[:-1]
        name = ".".join(parts)
        modules[name] = ModuleInfo(name=name, path=path, is_package=is_package)
    return modules


def layer_of(module: str, config: Config) -> str | None:
    parts = module.split(".")
    return parts[1] if len(parts) > 1 and parts[0] == config.package else None
