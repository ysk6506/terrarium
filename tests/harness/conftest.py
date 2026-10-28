"""Helpers to build throwaway mini repositories for harness meta-tests."""

from __future__ import annotations

import textwrap
from collections.abc import Callable
from pathlib import Path

import pytest

DEMO_ARCHITECTURE = """\
package: demo
source_dir: src
layers:
  kernel: {may_import: []}
  world: {may_import: [kernel]}
  sources: {may_import: [kernel, world]}
  api: {may_import: [kernel, world, sources]}
root_modules:
  __init__: []
isolated_siblings:
  demo.sources: [gen, imp]
third_party_scope:
  fastapi: [demo.api]
  harness: []
banned_calls: [print, eval]
nondeterminism_allowed: [demo.kernel.entropy]
"""

MiniRepo = Callable[[dict[str, str]], Path]


@pytest.fixture
def mini_repo(tmp_path: Path) -> MiniRepo:
    """Return a factory: ``mini_repo({"src/demo/kernel/__init__.py": "..."}) -> repo root``."""

    def build(files: dict[str, str]) -> Path:
        base = {
            "pyproject.toml": "[project]\nname='demo'\n",
            "harness/config/architecture.yaml": DEMO_ARCHITECTURE,
            "src/demo/__init__.py": "",
            "src/demo/kernel/__init__.py": "__all__ = []\n",
            "src/demo/world/__init__.py": "__all__ = []\n",
            "src/demo/sources/__init__.py": "__all__ = []\n",
            "src/demo/sources/gen/__init__.py": "",
            "src/demo/sources/imp/__init__.py": "",
            "src/demo/api/__init__.py": "__all__ = []\n",
        }
        base.update(files)
        for relative, content in base.items():
            target = tmp_path / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(content), encoding="utf-8")
        return tmp_path

    return build
