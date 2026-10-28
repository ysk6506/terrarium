.PHONY: setup lint typecheck test structure check check-pr ratchet reverify-help

PY ?= python3
BASE ?=

setup:
	$(PY) -m pip install -e ".[dev]"

lint:
	$(PY) -m ruff check src tests harness
	$(PY) -m ruff format --check src tests harness

typecheck:
	$(PY) -m mypy src harness

# Runs every test and writes coverage.json for the coverage ratchet.
test:
	$(PY) -m pytest --cov --cov-branch --cov-report=json:coverage.json --cov-report=term-missing:skip-covered

structure:
	$(PY) -m harness.run_all $(if $(BASE),--base $(BASE),) --with-coverage

# The one command an agent must make pass before finishing any change.
check: lint typecheck test structure

# Same as check, but also compares against the base branch (what CI runs on pull requests).
check-pr:
	$(MAKE) check BASE=origin/main

# After raising coverage: lock in the gain (floors only go up) and drop fixed debt baseline entries.
ratchet:
	$(PY) -m harness.checks.coverage ratchet
	$(PY) -m harness.checks.debt ratchet
