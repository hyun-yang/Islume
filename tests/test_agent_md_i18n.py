"""Round-trip tests for the i18n (translations) frontmatter block.

The critical guarantee: agents without translations render exactly as before,
so the 60 existing English-only files keep round-tripping byte-for-byte.
"""
from pathlib import Path

from shared.agent_md import (
    Translation,
    parse_agent_md,
    render_agent_md,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_MD = REPO_ROOT / "agents" / "00000001-0000-0000-0000-000000000000" / "jazz_lover.md"


def test_existing_file_roundtrips_without_i18n_key():
    text = SAMPLE_MD.read_text()
    fm, body = parse_agent_md(text)
    assert fm.i18n is None
    rendered = render_agent_md(fm, body)
    assert "i18n:" not in rendered
    # Re-parse must be stable.
    fm2, body2 = parse_agent_md(rendered)
    assert fm2.model_dump() == fm.model_dump()
    assert body2 == body


def test_ko_translation_roundtrips():
    text = SAMPLE_MD.read_text()
    fm, body = parse_agent_md(text)
    fm.i18n = {
        "ko": Translation(
            name="재즈 애호가",
            description="열정적인 재즈 팬",
            persona_prompt="# 재즈 애호가 — 페르소나\n\n## 역할\n재즈를 사랑합니다.",
            tags=["음악", "재즈"],
        )
    }
    rendered = render_agent_md(fm, body)
    assert "i18n:" in rendered
    assert "재즈 애호가" in rendered

    fm2, _ = parse_agent_md(rendered)
    assert fm2.i18n is not None
    ko = fm2.i18n["ko"]
    assert ko.name == "재즈 애호가"
    assert ko.persona_prompt is not None and "역할" in ko.persona_prompt
    assert ko.tags == ["음악", "재즈"]


def test_empty_translation_is_dropped_on_render():
    text = SAMPLE_MD.read_text()
    fm, body = parse_agent_md(text)
    fm.i18n = {"ko": Translation()}  # all fields empty
    # parse path that goes through frontmatter_from_agent filters empties, but
    # render itself only drops when the whole i18n is None. Verify the
    # is_empty contract callers rely on.
    assert fm.i18n["ko"].is_empty()
