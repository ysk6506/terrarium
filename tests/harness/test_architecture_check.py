"""Meta-tests: the architecture check must catch each class of violation, and pass clean code."""

from __future__ import annotations

import shutil

import pytest

from harness.checks import architecture
from harness.common import find_root

pytestmark = pytest.mark.req("REQ-021")


def codes(root):  # type: ignore[no-untyped-def]
    return sorted({v.code for v in architecture.run(root)})


def test_clean_mini_repo_passes(mini_repo):
    assert architecture.run(mini_repo({})) == []


def test_real_repository_is_clean():
    assert architecture.run(find_root()) == []


def test_upward_layer_import_is_rejected(mini_repo):
    root = mini_repo({"src/demo/kernel/a.py": "from demo.world import thing\n"})
    assert "ARCH010" in codes(root)


def test_downward_layer_import_through_public_api_is_allowed(mini_repo):
    root = mini_repo({"src/demo/world/a.py": "from demo.kernel import thing\n"})
    assert architecture.run(root) == []


def test_reaching_into_layer_internals_is_rejected(mini_repo):
    files = {
        "src/demo/kernel/ids.py": "X = 1\n",
        "src/demo/world/a.py": "from demo.kernel.ids import X\n",
    }
    assert codes(mini_repo(files)) == ["ARCH011"]


def test_from_package_import_submodule_counts_as_internal_reach(mini_repo):
    files = {
        "src/demo/kernel/ids.py": "X = 1\n",
        "src/demo/world/a.py": "from demo.kernel import ids\n",
    }
    assert codes(mini_repo(files)) == ["ARCH011"]


def test_isolated_siblings_must_not_import_each_other(mini_repo):
    files = {
        "src/demo/sources/gen/a.py": "from demo.sources.imp import b\n",
        "src/demo/sources/imp/b.py": "X = 1\n",
    }
    assert "ARCH012" in codes(mini_repo(files))


def test_sibling_may_use_shared_module_outside_isolated_set(mini_repo):
    files = {
        "src/demo/sources/base.py": "X = 1\n",
        "src/demo/sources/gen/a.py": "from demo.sources import base\n",
    }
    assert architecture.run(mini_repo(files)) == []


def test_third_party_outside_scope_is_rejected(mini_repo):
    root = mini_repo({"src/demo/kernel/a.py": "import fastapi\n"})
    assert codes(root) == ["ARCH020"]


def test_third_party_inside_scope_is_allowed(mini_repo):
    root = mini_repo({"src/demo/api/a.py": "import fastapi\n"})
    assert architecture.run(root) == []


def test_product_code_must_not_import_harness(mini_repo):
    root = mini_repo({"src/demo/api/a.py": "from harness import common\n"})
    assert codes(root) == ["ARCH020"]


def test_cycle_inside_a_layer_is_rejected(mini_repo):
    files = {
        "src/demo/kernel/a.py": "from . import b\n",
        "src/demo/kernel/b.py": "from . import a\n",
    }
    assert "ARCH030" in codes(mini_repo(files))


def test_relative_imports_are_resolved_for_layer_rules(mini_repo):
    files = {
        "src/demo/kernel/deep/__init__.py": "",
        "src/demo/kernel/deep/a.py": "from ...world import x\n",
    }
    assert "ARCH010" in codes(mini_repo(files))


def test_unknown_layer_is_rejected(mini_repo):
    root = mini_repo({"src/demo/mystery/__init__.py": "__all__ = []\n"})
    assert "ARCH001" in codes(root)


def test_stray_root_module_is_rejected(mini_repo):
    root = mini_repo({"src/demo/utils.py": "X = 1\n"})
    assert "ARCH002" in codes(root)


def test_missing_dunder_all_in_layer_is_rejected(mini_repo):
    root = mini_repo({"src/demo/world/__init__.py": "X = 1\n"})
    assert codes(root) == ["ARCH040"]


def test_declared_layer_without_directory_is_rejected(mini_repo):
    root = mini_repo({})
    shutil.rmtree(root / "src/demo/api")
    assert "ARCH003" in codes(root)


def test_print_is_banned(mini_repo):
    root = mini_repo({"src/demo/kernel/a.py": "print('x')\n"})
    assert codes(root) == ["ARCH050"]


def test_bare_except_and_star_import_are_banned(mini_repo):
    files = {
        "src/demo/kernel/a.py": "try:\n    pass\nexcept:\n    pass\n",
        "src/demo/kernel/b.py": "from os.path import *\n",
    }
    assert codes(mini_repo(files)) == ["ARCH051"]


@pytest.mark.parametrize(
    "source",
    [
        "import time\nx = time.time()\n",
        "import random\nx = random.random()\n",
        "import uuid\nx = uuid.uuid4()\n",
        "from datetime import datetime\nx = datetime.now()\n",
        "import datetime\nx = datetime.datetime.utcnow()\n",
        "from time import monotonic\n",
        "from random import randint\n",
    ],
)
def test_nondeterminism_is_rejected_outside_allowed_modules(mini_repo, source):
    assert codes(mini_repo({"src/demo/world/a.py": source})) == ["ARCH052"]


def test_nondeterminism_is_allowed_in_entropy_module(mini_repo):
    root = mini_repo({"src/demo/kernel/entropy.py": "import time\nx = time.time()\n"})
    assert architecture.run(root) == []


def test_seeded_random_instances_are_allowed(mini_repo):
    root = mini_repo({"src/demo/world/a.py": "from random import Random\nr = Random(1)\n"})
    assert architecture.run(root) == []


def test_every_violation_tells_the_agent_how_to_fix_it(mini_repo):
    root = mini_repo({"src/demo/kernel/a.py": "from demo.world import thing\nprint(1)\n"})
    violations = architecture.run(root)
    assert violations
    assert all(v.fix and v.path and v.code.startswith("ARCH") for v in violations)
