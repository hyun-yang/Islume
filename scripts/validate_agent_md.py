"""Validate every Agent.md under agents/ against the v2 schema.

- Walks `agents/` and resolves each `.md` path. Aborts if any resolved
  path escapes the base directory (path traversal defence).
- Parses frontmatter + body via `shared.agent_md.parse_agent_md` and
  re-renders to verify round-trip stability.
- Exits 0 on success, 1 if any file fails. Suitable for CI.
"""
from __future__ import annotations

import sys
from pathlib import Path

from shared.agent_md import parse_agent_md, render_agent_md

BASE_DIR = Path(__file__).resolve().parent.parent / "agents"


def _is_within(child: Path, base: Path) -> bool:
    try:
        child.resolve(strict=True).relative_to(base.resolve(strict=True))
        return True
    except (ValueError, FileNotFoundError):
        return False


def main() -> int:
    if not BASE_DIR.exists():
        print(f"agents/ directory not found at {BASE_DIR}")
        return 1

    failures: list[tuple[Path, str]] = []
    checked = 0

    for path in sorted(BASE_DIR.rglob("*.md")):
        if not _is_within(path, BASE_DIR):
            failures.append((path, "path escapes agents/ base dir"))
            continue
        if path.is_symlink():
            failures.append((path, "symlinks are not allowed"))
            continue
        # References (PR-5) are plain markdown without frontmatter — skip.
        if "references" in path.parts:
            continue

        try:
            text = path.read_text(encoding="utf-8")
            fm, body = parse_agent_md(text)
            rendered = render_agent_md(fm, body)
            if rendered.strip() != text.strip():
                failures.append((path, "round-trip mismatch"))
        except Exception as e:
            failures.append((path, f"{type(e).__name__}: {e}"))
        checked += 1

    print(f"Checked {checked} Agent.md file(s) under {BASE_DIR}")
    if failures:
        print(f"FAILED: {len(failures)} file(s)")
        for p, reason in failures:
            print(f"  {p}: {reason}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
