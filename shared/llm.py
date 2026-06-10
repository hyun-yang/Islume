"""Multi-provider LLM client — Anthropic, OpenAI, Gemini, Ollama."""

import json
import re
import uuid
from dataclasses import dataclass, field

from anthropic import AsyncAnthropic
from google import genai
from openai import AsyncOpenAI

from shared.config import get_settings
from shared.intent_plugins.base import ToolCall, ToolDef
from shared.telemetry import get_tracer

# ---------------------------------------------------------------------------
# Pricing per million tokens
# ---------------------------------------------------------------------------
PRICING: dict[str, dict[str, float]] = {
    # Anthropic (bare names for backward compat with existing DB data)
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5": {"input": 0.80, "output": 4.0},
    # OpenAI
    "openai/gpt-4o": {"input": 2.50, "output": 10.0},
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "openai/gpt-5-mini": {"input": 0.25, "output": 2.0},
    "openai/gpt-5-nano": {"input": 0.05, "output": 0.40},
    # Gemini
    "gemini/gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini/gemini-2.5-pro": {"input": 1.25, "output": 10.0},
    # Ollama (local, free)
    "ollama/gemma4": {"input": 0.0, "output": 0.0},
    "ollama/granite4": {"input": 0.0, "output": 0.0},
    # Sakana (pricing unknown — treated as free until confirmed)
    "sakana/fugu-mini": {"input": 0.0, "output": 0.0},
}

# ---------------------------------------------------------------------------
# Model access — configured via env vars per provider
# ---------------------------------------------------------------------------
# Old hardcoded tier-based config (replaced by env-driven config below):
# TIER_MODELS: dict[str, list[str]] = {
#     "free": ["claude-haiku-4-5", "openai/gpt-4o-mini", ...],
#     "paid": ["claude-haiku-4-5", "claude-sonnet-4-5", "openai/gpt-4o", ...],
# }
# TIER_DEFAULT: dict[str, str] = {
#     "free": "claude-haiku-4-5",
#     "paid": "claude-sonnet-4-5",
# }


def _split_csv(csv: str) -> list[str]:
    """Split comma-separated string into trimmed non-empty items."""
    return [s.strip() for s in csv.split(",") if s.strip()]


def get_available_models() -> list[str]:
    """Build flat model list from env. Anthropic bare, others prefixed."""
    settings = get_settings()
    models: list[str] = []
    for m in _split_csv(settings.anthropic_models):
        models.append(m)
    for m in _split_csv(settings.openai_models):
        models.append(f"openai/{m}")
    for m in _split_csv(settings.gemini_models):
        models.append(f"gemini/{m}")
    for m in _split_csv(settings.ollama_models):
        models.append(f"ollama/{m}")
    for m in _split_csv(settings.sakana_models):
        models.append(f"sakana/{m}")
    return models


def get_default_model() -> str:
    """Default chat model for agents whose owner has no preferred_model.

    An explicit DEFAULT_CHAT_MODEL wins; otherwise fall back to the first model
    from the first non-empty provider list.
    """
    default = get_settings().default_chat_model
    if default:
        return default
    models = get_available_models()
    return models[0] if models else "claude-haiku-4-5"


def get_system_model() -> str:
    """Model for internal system calls (similarity, affinity). Configured via SYSTEM_LLM_MODEL env."""
    return get_settings().system_llm_model


# ---------------------------------------------------------------------------
# Model string parsing
# ---------------------------------------------------------------------------


def parse_model(model: str) -> tuple[str, str]:
    """Parse 'provider/model_id' string. Bare names default to 'anthropic'."""
    if "/" in model:
        provider, model_id = model.split("/", 1)
        return provider, model_id
    return "anthropic", model


def is_provider_configured(provider: str) -> bool:
    """Check whether the server has credentials for a given provider."""
    settings = get_settings()
    return {
        "anthropic": bool(
            settings.anthropic_api_key and settings.anthropic_api_key != "placeholder"
        ),
        "openai": bool(settings.openai_api_key),
        "gemini": bool(settings.gemini_api_key),
        "ollama": True,
        "sakana": bool(settings.sakana_ai_api_key),
    }.get(provider, False)


# ---------------------------------------------------------------------------
# Singleton clients (lazy init, same pattern as before)
# ---------------------------------------------------------------------------
_anthropic_client: AsyncAnthropic | None = None
_openai_client: AsyncOpenAI | None = None
_ollama_client: AsyncOpenAI | None = None
_sakana_client: AsyncOpenAI | None = None
_gemini_client: genai.Client | None = None


def get_anthropic_client() -> AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        settings = get_settings()
        _anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        settings = get_settings()
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def get_ollama_client() -> AsyncOpenAI:
    global _ollama_client
    if _ollama_client is None:
        settings = get_settings()
        _ollama_client = AsyncOpenAI(
            base_url=f"{settings.ollama_base_url}/v1",
            api_key="ollama",
        )
    return _ollama_client


def get_sakana_client() -> AsyncOpenAI:
    global _sakana_client
    if _sakana_client is None:
        settings = get_settings()
        _sakana_client = AsyncOpenAI(
            base_url=settings.sakana_base_url,
            api_key=settings.sakana_ai_api_key,
        )
    return _sakana_client


def get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        settings = get_settings()
        _gemini_client = genai.Client(api_key=settings.gemini_api_key)
    return _gemini_client


# ---------------------------------------------------------------------------
# Response dataclass
# ---------------------------------------------------------------------------


@dataclass
class LLMResponse:
    text: str
    input_tokens: int
    output_tokens: int
    model: str

    @property
    def cost_usd(self) -> float:
        if self.model not in PRICING:
            return 0.0
        p = PRICING[self.model]
        return (
            self.input_tokens * p["input"] / 1_000_000
            + self.output_tokens * p["output"] / 1_000_000
        )


@dataclass
class GenerationResult:
    """Returned when `generate(..., tools=...)` is called with tools.

    `text` may be empty if the model emitted only tool calls. `tool_calls` is the
    normalized list across providers — Anthropic tool_use blocks, OpenAI tool_calls,
    Gemini function_call parts, or Ollama <action>...</action> tag fallbacks all
    surface as `ToolCall(id, name, arguments)`.
    """

    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""

    @property
    def cost_usd(self) -> float:
        if self.model not in PRICING:
            return 0.0
        p = PRICING[self.model]
        return (
            self.input_tokens * p["input"] / 1_000_000
            + self.output_tokens * p["output"] / 1_000_000
        )


# ---------------------------------------------------------------------------
# Provider-specific generation
# ---------------------------------------------------------------------------


async def _generate_anthropic(
    system: str, messages: list[dict], model_id: str, max_tokens: int
) -> LLMResponse:
    client = get_anthropic_client()
    response = await client.messages.create(
        model=model_id,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return LLMResponse(
        text=response.content[0].text,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        model=model_id,  # bare name for backward compat
    )


def _is_openai_reasoning_model(model_id: str) -> bool:
    """OpenAI reasoning models (gpt-5*, o1/o3/o4*) reject `max_tokens` — they
    require `max_completion_tokens`, and hidden reasoning tokens count against
    that budget."""
    mid = model_id.lower()
    return mid.startswith(("gpt-5", "o1", "o3", "o4"))


def is_reasoning_model(model: str) -> bool:
    """True if a full model string ('provider/id' or bare) is an OpenAI
    reasoning model (gpt-5*/o1/o3/o4).

    Their hidden reasoning tokens share the output budget, so a complex prompt
    can burn it all on reasoning and return empty content — a poor fit for
    short persona chat (see the worker's `_generate_turn_reply` guard). Used to
    keep reasoning models out of the conversation-model picker.
    """
    provider, model_id = parse_model(model)
    return provider == "openai" and _is_openai_reasoning_model(model_id)


def _openai_token_kwargs(model_id: str, max_tokens: int) -> dict:
    """Per-model token kwargs for chat.completions.

    Non-reasoning models use `max_tokens`. Reasoning models use
    `max_completion_tokens` (floored so reasoning overhead can't starve the
    visible reply) and, for gpt-5, minimal reasoning effort to keep short
    casual persona replies fast and cheap.
    """
    if not _is_openai_reasoning_model(model_id):
        return {"max_tokens": max_tokens}
    kwargs: dict = {"max_completion_tokens": max(max_tokens, 512)}
    if model_id.lower().startswith("gpt-5"):
        kwargs["reasoning_effort"] = "minimal"
    return kwargs


async def _generate_openai(
    system: str,
    messages: list[dict],
    model_id: str,
    max_tokens: int,
    client: AsyncOpenAI,
    full_model: str,
) -> LLMResponse:
    oai_messages = [{"role": "system", "content": system}, *messages]
    response = await client.chat.completions.create(
        model=model_id,
        messages=oai_messages,
        **_openai_token_kwargs(model_id, max_tokens),
    )
    choice = response.choices[0]
    usage = response.usage
    return LLMResponse(
        text=choice.message.content or "",
        input_tokens=usage.prompt_tokens if usage else 0,
        output_tokens=usage.completion_tokens if usage else 0,
        model=full_model,
    )


# ---------------------------------------------------------------------------
# Tool-aware generation (provider-specific)
# ---------------------------------------------------------------------------


def _anthropic_tools_payload(tools: list[ToolDef]) -> list[dict]:
    return [
        {"name": t.name, "description": t.description, "input_schema": t.parameters}
        for t in tools
    ]


def _openai_tools_payload(tools: list[ToolDef]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in tools
    ]


def _ollama_tool_prompt(tools: list[ToolDef]) -> str:
    """Inject tool schemas into system prompt for models without native tool calling.

    The model is asked to emit at most one <action>{...}</action> tag.
    """
    lines = [
        "## Actions available",
        "When you want to take an action, emit exactly one `<action>...</action>` tag at the END of your reply containing valid JSON of the form:",
        '  <action>{"name": "tool_name", "arguments": {...}}</action>',
        "Only emit an action when the conversation calls for it; otherwise just reply in plain text.",
        "",
        "Available tools:",
    ]
    for t in tools:
        lines.append(f"- `{t.name}` — {t.description}")
        lines.append(f"  parameters JSON schema: {json.dumps(t.parameters)}")
    return "\n".join(lines)


_ACTION_RE = re.compile(r"<action>(.*?)</action>", re.S | re.I)


def _parse_action_tags(text: str) -> tuple[str, list[ToolCall], int]:
    """Extract <action>...</action> tool calls. Returns (clean_text, calls, dropped)."""
    calls: list[ToolCall] = []
    dropped = 0
    for m in _ACTION_RE.finditer(text):
        body = m.group(1).strip()
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            dropped += 1
            continue
        name = payload.get("name") if isinstance(payload, dict) else None
        args = payload.get("arguments", {}) if isinstance(payload, dict) else {}
        if not name or not isinstance(args, dict):
            dropped += 1
            continue
        calls.append(ToolCall(id=str(uuid.uuid4()), name=name, arguments=args))
    cleaned = _ACTION_RE.sub("", text).strip()
    return cleaned, calls, dropped


async def _generate_anthropic_tools(
    system: str,
    messages: list[dict],
    model_id: str,
    max_tokens: int,
    tools: list[ToolDef],
) -> GenerationResult:
    client = get_anthropic_client()
    response = await client.messages.create(
        model=model_id,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
        tools=_anthropic_tools_payload(tools),
    )
    text = ""
    tool_calls: list[ToolCall] = []
    for block in response.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            text += getattr(block, "text", "")
        elif btype == "tool_use":
            tool_calls.append(
                ToolCall(
                    id=getattr(block, "id", str(uuid.uuid4())),
                    name=getattr(block, "name", ""),
                    arguments=dict(getattr(block, "input", {}) or {}),
                )
            )
    return GenerationResult(
        text=text,
        tool_calls=tool_calls,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        model=model_id,
    )


async def _generate_openai_tools(
    system: str,
    messages: list[dict],
    model_id: str,
    max_tokens: int,
    tools: list[ToolDef],
    client: AsyncOpenAI,
    full_model: str,
) -> GenerationResult:
    oai_messages = [{"role": "system", "content": system}, *messages]
    response = await client.chat.completions.create(
        model=model_id,
        messages=oai_messages,
        tools=_openai_tools_payload(tools),
        **_openai_token_kwargs(model_id, max_tokens),
    )
    choice = response.choices[0]
    msg = choice.message
    text = msg.content or ""
    tool_calls: list[ToolCall] = []
    for tc in msg.tool_calls or []:
        try:
            args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        tool_calls.append(ToolCall(id=tc.id, name=tc.function.name, arguments=args))
    usage = response.usage
    return GenerationResult(
        text=text,
        tool_calls=tool_calls,
        input_tokens=usage.prompt_tokens if usage else 0,
        output_tokens=usage.completion_tokens if usage else 0,
        model=full_model,
    )


async def _generate_ollama_tools(
    system: str,
    messages: list[dict],
    model_id: str,
    max_tokens: int,
    tools: list[ToolDef],
    full_model: str,
) -> GenerationResult:
    """Ollama path — no native tool API; uses <action> tag fallback."""
    client = get_ollama_client()
    augmented_system = f"{system}\n\n{_ollama_tool_prompt(tools)}"
    oai_messages = [{"role": "system", "content": augmented_system}, *messages]
    response = await client.chat.completions.create(
        model=model_id,
        max_tokens=max_tokens,
        messages=oai_messages,
    )
    choice = response.choices[0]
    raw = choice.message.content or ""
    cleaned, tool_calls, dropped = _parse_action_tags(raw)
    usage = response.usage
    result = GenerationResult(
        text=cleaned,
        tool_calls=tool_calls,
        input_tokens=usage.prompt_tokens if usage else 0,
        output_tokens=usage.completion_tokens if usage else 0,
        model=full_model,
    )
    if dropped:
        # Telemetry-only; the worker still proceeds with whatever parsed cleanly.
        # Surfaced via a side-channel attribute on the span by caller.
        result.__dict__["_action_tags_dropped"] = dropped
        # stderr breadcrumb so operators notice when a local model is
        # consistently fumbling the JSON action format.
        import sys

        print(
            f"[ollama:{full_model}] dropped {dropped} malformed <action> tag(s)",
            file=sys.stderr,
        )
    return result


async def _generate_gemini_tools(
    system: str,
    messages: list[dict],
    model_id: str,
    max_tokens: int,
    tools: list[ToolDef],
    full_model: str,
) -> GenerationResult:
    client = get_gemini_client()
    contents = []
    for msg in messages:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(
            genai.types.Content(
                role=role,
                parts=[genai.types.Part(text=msg["content"])],
            )
        )
    gemini_tools = [
        genai.types.Tool(
            function_declarations=[
                genai.types.FunctionDeclaration(
                    name=t.name,
                    description=t.description,
                    parameters=t.parameters,
                )
                for t in tools
            ]
        )
    ]
    response = await client.aio.models.generate_content(
        model=model_id,
        contents=contents,
        config=genai.types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            tools=gemini_tools,
        ),
    )
    text = ""
    tool_calls: list[ToolCall] = []
    for cand in response.candidates or []:
        parts = getattr(cand.content, "parts", None) or []
        for part in parts:
            if getattr(part, "text", None):
                text += part.text
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", None):
                tool_calls.append(
                    ToolCall(
                        id=str(uuid.uuid4()),
                        name=fc.name,
                        arguments=dict(getattr(fc, "args", {}) or {}),
                    )
                )
    usage = response.usage_metadata
    return GenerationResult(
        text=text,
        tool_calls=tool_calls,
        input_tokens=usage.prompt_token_count if usage else 0,
        output_tokens=usage.candidates_token_count if usage else 0,
        model=full_model,
    )


async def _generate_gemini(
    system: str, messages: list[dict], model_id: str, max_tokens: int, full_model: str
) -> LLMResponse:
    client = get_gemini_client()
    # Convert messages: Anthropic/OpenAI "assistant" -> Gemini "model"
    contents = []
    for msg in messages:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(
            genai.types.Content(
                role=role,
                parts=[genai.types.Part(text=msg["content"])],
            )
        )
    response = await client.aio.models.generate_content(
        model=model_id,
        contents=contents,
        config=genai.types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
        ),
    )
    usage = response.usage_metadata
    return LLMResponse(
        text=response.text or "",
        input_tokens=usage.prompt_token_count if usage else 0,
        output_tokens=usage.candidates_token_count if usage else 0,
        model=full_model,
    )


# ---------------------------------------------------------------------------
# Public API (signature unchanged)
# ---------------------------------------------------------------------------


async def generate(
    system: str,
    messages: list[dict],
    model: str = "claude-sonnet-4-5",
    max_tokens: int = 300,
    tools: list[ToolDef] | None = None,
) -> LLMResponse | GenerationResult:
    """Generate a response from an LLM. Model format: 'provider/model_id' or bare Anthropic name.

    When `tools` is None, returns the legacy `LLMResponse` (unchanged behavior for
    affinity/similarity callers). When `tools` is a non-empty list, returns
    `GenerationResult` with normalized tool_calls extracted from the provider's response.
    """
    provider, model_id = parse_model(model)
    tracer = get_tracer("islume.llm")
    with tracer.start_as_current_span(f"llm.{provider}") as span:
        # GenAI semantic conventions — Langfuse maps these automatically.
        span.set_attribute("gen_ai.system", provider)
        span.set_attribute("gen_ai.request.model", model_id)
        span.set_attribute("gen_ai.request.max_tokens", max_tokens)
        # Langfuse-specific: forces this span to be rendered as a generation
        # observation with the input/output bodies attached.
        span.set_attribute("langfuse.observation.type", "generation")
        span.set_attribute("langfuse.observation.model.name", model)
        span.set_attribute(
            "langfuse.observation.input",
            json.dumps({"system": system, "messages": messages}),
        )
        if tools:
            span.set_attribute(
                "gen_ai.request.tools", json.dumps([t.name for t in tools])
            )

        if tools:
            match provider:
                case "anthropic":
                    result = await _generate_anthropic_tools(
                        system, messages, model_id, max_tokens, tools
                    )
                case "openai":
                    result = await _generate_openai_tools(
                        system,
                        messages,
                        model_id,
                        max_tokens,
                        tools,
                        get_openai_client(),
                        model,
                    )
                case "ollama":
                    result = await _generate_ollama_tools(
                        system, messages, model_id, max_tokens, tools, model
                    )
                case "sakana":
                    result = await _generate_openai_tools(
                        system,
                        messages,
                        model_id,
                        max_tokens,
                        tools,
                        get_sakana_client(),
                        model,
                    )
                case "gemini":
                    result = await _generate_gemini_tools(
                        system, messages, model_id, max_tokens, tools, model
                    )
                case _:
                    raise ValueError(f"Unknown LLM provider: {provider}")
            span.set_attribute("gen_ai.response.model", result.model)
            span.set_attribute("gen_ai.usage.input_tokens", result.input_tokens)
            span.set_attribute("gen_ai.usage.output_tokens", result.output_tokens)
            span.set_attribute(
                "gen_ai.response.tool_call_count", len(result.tool_calls)
            )
            dropped = result.__dict__.get("_action_tags_dropped")
            if dropped:
                span.set_attribute("gen_ai.response.tool_calls_dropped", int(dropped))
            span.set_attribute(
                "langfuse.observation.output",
                json.dumps(
                    {
                        "text": result.text,
                        "tool_calls": [
                            {"name": tc.name, "arguments": tc.arguments}
                            for tc in result.tool_calls
                        ],
                    }
                ),
            )
            span.set_attribute(
                "langfuse.observation.usage_details",
                json.dumps(
                    {
                        "input": result.input_tokens,
                        "output": result.output_tokens,
                        "total": result.input_tokens + result.output_tokens,
                    }
                ),
            )
            return result

        # Legacy path — behavior unchanged for callers that don't pass tools.
        match provider:
            case "anthropic":
                response = await _generate_anthropic(
                    system, messages, model_id, max_tokens
                )
            case "openai":
                response = await _generate_openai(
                    system, messages, model_id, max_tokens, get_openai_client(), model
                )
            case "ollama":
                response = await _generate_openai(
                    system, messages, model_id, max_tokens, get_ollama_client(), model
                )
            case "sakana":
                response = await _generate_openai(
                    system, messages, model_id, max_tokens, get_sakana_client(), model
                )
            case "gemini":
                response = await _generate_gemini(
                    system, messages, model_id, max_tokens, model
                )
            case _:
                raise ValueError(f"Unknown LLM provider: {provider}")

        span.set_attribute("gen_ai.response.model", response.model)
        span.set_attribute("gen_ai.usage.input_tokens", response.input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", response.output_tokens)
        span.set_attribute("langfuse.observation.output", response.text)
        # Pre-computed cost — Langfuse reads this for accurate accounting
        # since it doesn't know our PRICING table.
        span.set_attribute(
            "langfuse.observation.usage_details",
            json.dumps(
                {
                    "input": response.input_tokens,
                    "output": response.output_tokens,
                    "total": response.input_tokens + response.output_tokens,
                }
            ),
        )
        return response
