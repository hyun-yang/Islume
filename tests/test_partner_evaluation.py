"""Unit tests for the category-specific partner evaluation templates."""

from types import SimpleNamespace

from services.worker.evaluation import (
    TEMPLATE_FIELDS,
    _neutral_result,
    _parse_side,
    template_for,
)


def _agent(goal_category: str | None, goal: str | None = "test goal"):
    return SimpleNamespace(name="A", goal=goal, goal_category=goal_category)


class TestTemplateFor:
    def test_dating(self):
        assert template_for(_agent("dating")) == "dating"

    def test_recruiting_and_job_seeking(self):
        assert template_for(_agent("recruiting")) == "recruiting"
        assert template_for(_agent("job_seeking")) == "job_seeking"

    def test_professional(self):
        assert template_for(_agent("networking")) == "professional"
        assert template_for(_agent("mentorship")) == "professional"

    def test_hobby_fallbacks(self):
        assert template_for(_agent("casual_chat")) == "hobby"
        assert template_for(_agent("companionship")) == "hobby"
        assert template_for(_agent("collaboration")) == "hobby"
        assert template_for(_agent(None)) == "hobby"
        assert template_for(_agent("unknown_future_category")) == "hobby"


class TestParseSide:
    def test_valid_dating_side(self):
        agent = _agent("dating")
        out = _parse_side(
            {
                "offline_meeting": True,
                "share_contact": "true",
                "score": 87,
                "summary": "great chemistry",
                "recommendation": "continue",
            },
            agent,
        )
        assert out["template"] == "dating"
        assert out["verdicts"] == {"offline_meeting": True, "share_contact": True}
        assert out["score"] == 87
        assert out["recommendation"] == "continue"

    def test_job_seeking_enum_field(self):
        agent = _agent("job_seeking")
        out = _parse_side(
            {"company_impression": "bad", "want_interview": False, "score": 20,
             "recommendation": "end"},
            agent,
        )
        assert out["verdicts"]["company_impression"] == "bad"
        assert out["verdicts"]["want_interview"] is False
        assert out["recommendation"] == "end"

    def test_garbage_falls_back_to_neutral(self):
        agent = _agent("recruiting")
        out = _parse_side("not a dict", agent)
        assert out == _neutral_result(agent)
        assert out["recommendation"] == "continue"
        assert out["verdicts"] == {
            "candidate_suitable": False,
            "request_interview": False,
        }

    def test_score_clamped(self):
        agent = _agent(None)
        assert _parse_side({"score": 999}, agent)["score"] == 100
        assert _parse_side({"score": -5}, agent)["score"] == 0
        assert _parse_side({"score": "??"}, agent)["score"] == 50

    def test_every_template_has_common_shape(self):
        for tmpl, fields in TEMPLATE_FIELDS.items():
            assert fields, tmpl
            for _, (desc, fallback) in fields.items():
                assert isinstance(desc, str)
                assert isinstance(fallback, (bool, str))
