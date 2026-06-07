"""Persona similarity calculation — exact tags and LLM semantic."""
import json

from shared.llm import generate, get_system_model
from shared.telemetry import get_tracer


def jaccard_similarity(tags_a: list[str], tags_b: list[str]) -> float:
    """Compute Jaccard similarity between two tag sets."""
    set_a = set(tags_a)
    set_b = set(tags_b)
    if not set_a and not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union)


def _agent_description(name: str, description: str, tags: list[str]) -> str:
    """Build a compact text description for LLM comparison."""
    tag_str = ", ".join(tags) if tags else "none"
    return f"{name}: {description} (tags: {tag_str})"


async def llm_similarity(
    name_a: str, desc_a: str, tags_a: list[str],
    name_b: str, desc_b: str, tags_b: list[str],
) -> float:
    """Use Haiku to judge similarity between two agents. Returns 0.0-1.0."""
    text_a = _agent_description(name_a, desc_a, tags_a)
    text_b = _agent_description(name_b, desc_b, tags_b)

    system = (
        "You compare two agent personas and rate their interest/personality similarity. "
        "Respond ONLY with a JSON object: {\"score\": <0-100 integer>}. "
        "0 = completely unrelated, 100 = nearly identical interests."
    )
    messages = [
        {"role": "user", "content": f"Agent A: {text_a}\nAgent B: {text_b}"},
    ]

    tracer = get_tracer("islume.matching")
    with tracer.start_as_current_span("matching.similarity") as span:
        span.set_attribute("langfuse.observation.type", "trace")
        span.set_attribute("langfuse.trace.name", "similarity-score")
        span.set_attribute("matching.agent_a_name", name_a)
        span.set_attribute("matching.agent_b_name", name_b)
        try:
            response = await generate(
                system=system,
                messages=messages,
                model=get_system_model(),
                max_tokens=50,
            )
            data = json.loads(response.text)
            score = max(0, min(100, int(data.get("score", 0))))
            span.set_attribute("matching.score", score)
            return score / 100.0
        except (json.JSONDecodeError, ValueError, KeyError):
            span.set_attribute("matching.score", 0)
            return 0.0
