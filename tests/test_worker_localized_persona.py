"""Worker persona localization: language=ko picks the Korean persona body."""
from types import SimpleNamespace

from services.worker.main import build_system_prompt


def _agent(**kw):
    base = dict(
        persona_prompt="# Jazz Lover\nI love jazz.",
        name="Jazz Lover",
        tone="warm",
        safety=None,
        conversation_phases=None,
        boundaries=None,
        translations=None,
        references_meta=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_korean_language_uses_korean_persona():
    speaker = _agent(
        boundaries={"language": "ko"},
        translations={"ko": {"name": "재즈 애호가", "persona_prompt": "# 재즈 애호가\n재즈를 사랑합니다."}},
    )
    prompt = build_system_prompt(speaker, "Bob", "shared love of music")
    assert "재즈를 사랑합니다." in prompt
    assert "You are 재즈 애호가." in prompt
    assert "I love jazz." not in prompt


def test_korean_language_without_translation_falls_back_to_english():
    speaker = _agent(boundaries={"language": "ko"}, translations=None)
    prompt = build_system_prompt(speaker, "Bob", "shared love of music")
    assert "I love jazz." in prompt
    assert "You are Jazz Lover." in prompt
    # boundaries block still injects the language directive
    assert "Default language: ko." in prompt


def test_english_language_unchanged():
    speaker = _agent(
        boundaries={"language": "en-AU"},
        translations={"ko": {"persona_prompt": "한국어"}},
    )
    prompt = build_system_prompt(speaker, "Bob", "music")
    assert "I love jazz." in prompt
    assert "한국어" not in prompt
