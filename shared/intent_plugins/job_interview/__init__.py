"""Job interview intent plugin — interview request/accept between agents."""

from __future__ import annotations

from shared.intent_plugins.base import Plugin
from shared.intent_plugins.job_interview.handlers import HANDLERS
from shared.intent_plugins.job_interview.policy import POLICY_SCHEMA
from shared.intent_plugins.job_interview.prompt import prompt_fragment
from shared.intent_plugins.job_interview.tools import TOOLS

plugin = Plugin(
    id="job_interview",
    tools=TOOLS,
    policy_schema=POLICY_SCHEMA,
    prompt_fragment=prompt_fragment,
    handlers=HANDLERS,
    card_kind="job_interview",
    description=(
        "Job interview coordination between a recruiter and a job seeker. "
        "Tools: request_interview, accept_interview, decline_interview. "
        "Requests and acceptances always require owner approval."
    ),
)

__all__ = ["plugin"]
