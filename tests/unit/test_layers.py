"""Every architecture layer is an importable package that declares its public API."""

from __future__ import annotations

import importlib

import pytest

from harness.checks.archmodel import Config
from harness.common import find_root

LAYERS = sorted(Config.load(find_root()).layers)


@pytest.mark.parametrize("layer", LAYERS)
def test_layer_is_importable_and_declares_a_public_api(layer):
    module = importlib.import_module(f"terrarium.{layer}")
    assert isinstance(module.__all__, list)
    assert all(hasattr(module, name) for name in module.__all__)


def test_package_exposes_a_version():
    import terrarium

    assert terrarium.__version__.count(".") == 2
