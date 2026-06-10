"""Policy/contract tests for the job_interview and dating_contact plugins."""

from shared.intent_plugins import get_plugin


class TestJobInterviewPolicy:
    def test_registered(self):
        p = get_plugin("job_interview")
        assert p is not None
        assert p.card_kind == "job_interview"
        assert set(p.tool_names()) == {
            "request_interview",
            "accept_interview",
            "decline_interview",
        }

    def test_request_and_accept_always_pending(self):
        p = get_plugin("job_interview")
        # No policy can make these auto-confirm — owner approval is mandatory.
        for policy in ({}, {"role": "recruiter"}, {"role": "job_seeker"}):
            assert p.tool_by_name("request_interview").policy_check({}, policy).status == "pending"
            assert p.tool_by_name("accept_interview").policy_check({}, policy).status == "pending"

    def test_decline_auto_confirms(self):
        p = get_plugin("job_interview")
        assert p.tool_by_name("decline_interview").policy_check({}, {}).status == "auto_confirm"


class TestDatingContactPolicy:
    def test_registered(self):
        p = get_plugin("dating_contact")
        assert p is not None
        assert p.card_kind == "dating_contact"
        assert set(p.tool_names()) == {
            "propose_offline_meeting",
            "accept_offline_meeting",
            "decline_offline_meeting",
            "share_contact",
        }

    def test_share_contact_never_auto_confirms(self):
        p = get_plugin("dating_contact")
        check = p.tool_by_name("share_contact").policy_check
        args = {"channel": "kakao", "handle": "someone"}
        for policy in ({}, {"allowed_channels": ["kakao"]}):
            assert check(args, policy).status == "pending"

    def test_share_contact_channel_whitelist(self):
        p = get_plugin("dating_contact")
        check = p.tool_by_name("share_contact").policy_check
        decision = check(
            {"channel": "phone", "handle": "x"}, {"allowed_channels": ["kakao"]}
        )
        assert decision.status == "auto_rejected"

    def test_share_contact_is_redacted_on_shared_surfaces(self):
        p = get_plugin("dating_contact")
        assert p.tool_by_name("share_contact").redact_args is True
        # The other dating tools carry no secrets and stay unredacted.
        assert p.tool_by_name("propose_offline_meeting").redact_args is False

    def test_meeting_proposals_always_pending(self):
        p = get_plugin("dating_contact")
        assert p.tool_by_name("propose_offline_meeting").policy_check({}, {}).status == "pending"
        assert p.tool_by_name("accept_offline_meeting").policy_check({}, {}).status == "pending"
        assert p.tool_by_name("decline_offline_meeting").policy_check({}, {}).status == "auto_confirm"
