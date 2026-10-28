"""Documentation quality (REQ-020): docs must prove they are current.

How a doc proves it is current
------------------------------
A doc declares ``covers`` (globs of code/config it describes). ``covers_hash`` is a fingerprint of
those files (Python files are fingerprinted by AST, so comments and formatting do not churn docs).
When covered code changes, the fingerprint no longer matches and the doc is *stale* until someone
reads it, fixes it, and runs ``reverify`` with a note. Docs also expire by age, and rot is caught
mechanically (broken links, dead paths, orphans, unenforced decisions, rewritten ADRs).

Rules: DOC001 front matter, DOC002 bad kind/status, DOC010 stale fingerprint, DOC011 never
verified, DOC012 covers matches nothing, DOC020 too old, DOC021 future date, DOC030 broken link,
DOC031 dead path reference, DOC040 orphan, DOC050 too long, DOC060 wrong folder for status/kind,
DOC070 ADR rewritten after sealing, DOC071 ADR not sealed, DOC080 ADR enforcement missing.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import yaml

from harness.checks.docadr import check_adr
from harness.checks.docprint import body_fingerprint, covers_fingerprint, expand_covers
from harness.common import (
    Violation,
    as_date,
    find_root,
    finish,
    load_yaml,
    rel,
    split_front_matter,
    today,
)

CONFIG_PATH = Path("harness/config/docs.yaml")
LINK_RE = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)\s]+)\)")
INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
PATH_LIKE_RE = re.compile(r"^[A-Za-z0-9_.\-/]+\.(?:py|md|yaml|yml|toml|json|txt|cfg|ini)$")
REVERIFY_CMD = (
    "python -m harness.checks.docs reverify {path} --note '<what you checked or changed>'"
)


class DocsConfig:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.docs_root: str = raw["docs_root"]
        self.index: str = raw["index"]
        self.root_docs: list[str] = list(raw["root_docs"])
        self.adr_dir: str = raw["adr_dir"]
        self.generated_dir: str = raw["generated_dir"]
        self.archive_dir: str = raw["archive_dir"]
        self.kinds: list[str] = list(raw["kinds"])
        self.statuses: list[str] = list(raw["statuses"])
        self.required_keys: list[str] = list(raw["required_keys"])
        self.max_age_days: dict[str, int | None] = dict(raw["max_age_days"])
        self.max_lines: dict[str, int] = dict(raw["max_lines"])
        self.path_roots: list[str] = list(raw["path_roots"])
        self.root_files: list[str] = list(raw["root_files"])

    @staticmethod
    def load(root: Path) -> DocsConfig:
        return DocsConfig(load_yaml(root / CONFIG_PATH))


# --------------------------------------------------------------------------- discovery


def discover_docs(root: Path, config: DocsConfig) -> list[Path]:
    docs: list[Path] = []
    for name in config.root_docs:
        path = root / name
        if path.is_file():
            docs.append(path)
    base = root / config.docs_root
    generated = root / config.generated_dir
    archive = root / config.archive_dir
    for path in sorted(base.rglob("*.md")):
        if generated in path.parents or archive in path.parents:
            continue
        docs.append(path)
    return docs


def _prose_lines(body: str) -> Iterable[tuple[int, str]]:
    """Yield (line offset, text) skipping fenced code blocks."""
    in_fence = False
    for offset, line in enumerate(body.splitlines()):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence:
            yield offset, line


# --------------------------------------------------------------------------- checks


def check_front_matter(
    root: Path, config: DocsConfig, path: Path, data: dict[str, Any] | None, now: dt.date
) -> list[Violation]:
    name = rel(root, path)
    if data is None:
        return [
            Violation(
                "DOC001",
                name,
                1,
                "missing YAML front matter",
                "Start the file with --- front matter containing: "
                + ", ".join(config.required_keys)
                + ".",
            )
        ]
    return [*_key_problems(config, name, data), *_date_problems(config, name, data, now)]


def _key_problems(config: DocsConfig, name: str, data: dict[str, Any]) -> list[Violation]:
    out = [
        Violation("DOC001", name, 1, f"front matter lacks '{key}'", f"Add '{key}'.")
        for key in config.required_keys
        if key not in data
    ]
    for key, allowed in (("kind", config.kinds), ("status", config.statuses)):
        if key in data and data[key] not in allowed:
            out.append(
                Violation(
                    "DOC002",
                    name,
                    1,
                    f"{key} '{data[key]}' is invalid",
                    f"Use one of: {', '.join(allowed)}.",
                )
            )
    return out


def _date_problems(
    config: DocsConfig, name: str, data: dict[str, Any], now: dt.date
) -> list[Violation]:
    verified = as_date(data.get("last_verified"))
    if "last_verified" in data and verified is None:
        return [Violation("DOC001", name, 1, "last_verified is not an ISO date", "Use YYYY-MM-DD.")]
    if verified is None:
        return []
    if verified > now:
        return [
            Violation(
                "DOC021",
                name,
                1,
                "last_verified is in the future",
                "Use the real date you verified the doc.",
            )
        ]
    limit = config.max_age_days.get(str(data.get("kind")))
    if limit is None or data.get("status") != "active" or (now - verified).days <= limit:
        return []
    return [
        Violation(
            "DOC020",
            name,
            1,
            f"last verified {(now - verified).days} days ago (limit {limit} for {data['kind']})",
            "Read the doc against the code, fix it, then run: " + REVERIFY_CMD.format(path=name),
        )
    ]


def check_freshness(root: Path, path: Path, data: dict[str, Any]) -> list[Violation]:
    covers = data.get("covers")
    name = rel(root, path)
    if not covers:
        return []
    if not expand_covers(root, covers):
        return [
            Violation(
                "DOC012",
                name,
                1,
                f"'covers' matches no files: {covers}",
                "Fix the globs (the code moved or was deleted) or remove the stale claim.",
            )
        ]
    expected = data.get("covers_hash")
    actual = covers_fingerprint(root, covers)
    fix = "Re-read the doc against the covered code, update it, then run: " + REVERIFY_CMD.format(
        path=name
    )
    if expected is None:
        return [Violation("DOC011", name, 1, "doc declares 'covers' but was never verified", fix)]
    if expected != actual:
        return [
            Violation(
                "DOC010",
                name,
                1,
                "code covered by this doc changed since it was last verified",
                fix,
            )
        ]
    return []


def check_length(root: Path, config: DocsConfig, path: Path) -> list[Violation]:
    limit = config.max_lines.get(path.name, config.max_lines["default"])
    count = len(path.read_text(encoding="utf-8").splitlines())
    if count <= limit:
        return []
    return [
        Violation(
            "DOC050",
            rel(root, path),
            1,
            f"{count} lines exceeds the {limit} line limit",
            "Split the doc by topic and link the parts from the index (progressive disclosure).",
        )
    ]


def _internal_link_target(path: Path, raw: str) -> Path | None:
    target = raw.split("#", 1)[0]
    if not target or "://" in target or target.startswith("mailto:"):
        return None
    return (path.parent / target).resolve()


def check_links_and_paths(
    root: Path, config: DocsConfig, path: Path, body: str, line_base: int
) -> tuple[list[Violation], set[Path]]:
    out: list[Violation] = []
    linked: set[Path] = set()
    name = rel(root, path)
    for offset, line in _prose_lines(body):
        line_no = line_base + offset
        for match in LINK_RE.finditer(line):
            target = _internal_link_target(path, match.group(1))
            if target is None:
                continue
            if target.exists():
                linked.add(target)
            else:
                out.append(
                    Violation(
                        "DOC030",
                        name,
                        line_no,
                        f"broken link: {match.group(1)}",
                        "Fix the path or delete the link.",
                    )
                )
        for match in INLINE_CODE_RE.finditer(line):
            candidate = match.group(1).strip()
            if not PATH_LIKE_RE.match(candidate):
                continue
            checked = (
                candidate.startswith(tuple(config.path_roots)) or candidate in config.root_files
            )
            if checked and not (root / candidate).exists():
                out.append(
                    Violation(
                        "DOC031",
                        name,
                        line_no,
                        f"`{candidate}` does not exist",
                        "Update the reference to the file's real location or remove it.",
                    )
                )
    return out, linked


def check_orphans(
    root: Path, config: DocsConfig, docs: list[Path], links: dict[Path, set[Path]]
) -> list[Violation]:
    entry = (root / config.index).resolve()
    starts = [entry] + [(root / n).resolve() for n in config.root_docs if (root / n).exists()]
    reachable: set[Path] = set()
    frontier = [s for s in starts if s.exists()]
    while frontier:
        current = frontier.pop()
        if current in reachable:
            continue
        reachable.add(current)
        frontier.extend(links.get(current, ()))
    docs_base = (root / config.docs_root).resolve()
    return [
        Violation(
            "DOC040",
            rel(root, doc),
            1,
            "doc is not reachable from docs/index.md or a root doc",
            "Link it from docs/index.md (or from a doc that is linked), or delete it.",
        )
        for doc in docs
        if docs_base in doc.resolve().parents and doc.resolve() not in reachable
    ]


def check_placement(
    root: Path, config: DocsConfig, path: Path, data: dict[str, Any]
) -> list[Violation]:
    name = rel(root, path)
    kind, status = data.get("kind"), data.get("status")
    out: list[Violation] = []
    in_adr = (root / config.adr_dir).resolve() in path.resolve().parents
    if kind == "decision" and not in_adr:
        out.append(
            Violation(
                "DOC060",
                name,
                1,
                "decisions belong in the ADR directory",
                f"Move it to {config.adr_dir}/.",
            )
        )
    if in_adr and kind != "decision":
        out.append(
            Violation(
                "DOC060",
                name,
                1,
                "only kind: decision docs live in the ADR directory",
                "Change the kind or move the file.",
            )
        )
    if kind == "plan" and "exec-plans/completed" in name and status != "archived":
        out.append(
            Violation(
                "DOC060",
                name,
                1,
                "completed plans must have status: archived",
                "Set status: archived (or move the plan back to active/).",
            )
        )
    if kind == "plan" and "exec-plans/active" in name and status != "active":
        out.append(
            Violation(
                "DOC060",
                name,
                1,
                "plans in active/ must have status: active",
                "Move finished plans to exec-plans/completed/.",
            )
        )
    return out


def run(root: Path, now: dt.date | None = None) -> list[Violation]:
    config = DocsConfig.load(root)
    now = now or today()
    violations: list[Violation] = []
    docs = discover_docs(root, config)
    links: dict[Path, set[Path]] = {}
    for path in docs:
        text = path.read_text(encoding="utf-8")
        data, body = split_front_matter(text)
        line_base = len(text.splitlines()) - len(body.splitlines()) + 1
        violations.extend(check_front_matter(root, config, path, data, now))
        violations.extend(check_length(root, config, path))
        found, linked = check_links_and_paths(root, config, path, body, line_base)
        violations.extend(found)
        links[path.resolve()] = linked
        if data is None:
            continue
        violations.extend(check_freshness(root, path, data))
        violations.extend(check_placement(root, config, path, data))
        if data.get("kind") == "decision":
            violations.extend(check_adr(root, path, data, body))
    violations.extend(check_orphans(root, config, docs, links))
    return violations


# --------------------------------------------------------------------------- mutating commands


def _write_front_matter(path: Path, data: dict[str, Any], body: str) -> None:
    dumped = yaml.safe_dump(data, sort_keys=False, allow_unicode=True).rstrip()
    path.write_text(f"---\n{dumped}\n---\n{body.lstrip(chr(10))}\n", encoding="utf-8")


def reverify(root: Path, path: Path, note: str, now: dt.date | None = None) -> None:
    """Record that a human/agent re-read ``path`` against its covered code."""
    data, body = split_front_matter(path.read_text(encoding="utf-8"))
    if data is None:
        raise SystemExit(f"{path} has no front matter")
    if not note.strip():
        raise SystemExit("--note is required: say what you checked or changed")
    day = now or today()
    if data.get("covers"):
        data["covers_hash"] = covers_fingerprint(root, data["covers"])
    data["last_verified"] = day
    log = list(data.get("verification_log") or [])
    log.append(f"{day.isoformat()}: {note.strip()}")
    data["verification_log"] = log[-5:]
    _write_front_matter(path, data, body)


def seal_adr(path: Path) -> None:
    data, body = split_front_matter(path.read_text(encoding="utf-8"))
    if data is None or data.get("kind") != "decision":
        raise SystemExit("only kind: decision docs can be sealed")
    data["decision_hash"] = body_fingerprint(body)
    _write_front_matter(path, data, body)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Documentation quality checks")
    parser.add_argument("--root", type=Path, default=None)
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("check")
    rv = sub.add_parser("reverify")
    rv.add_argument("doc", type=Path)
    rv.add_argument("--note", required=True)
    sl = sub.add_parser("seal-adr")
    sl.add_argument("doc", type=Path)
    args = parser.parse_args(argv)
    root = find_root(args.root)
    if args.command == "reverify":
        reverify(root, args.doc.resolve(), args.note)
        return 0
    if args.command == "seal-adr":
        seal_adr(args.doc.resolve())
        return 0
    return finish("docs", run(root))


if __name__ == "__main__":
    sys.exit(main())
