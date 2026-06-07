"""OpenTelemetry → Langfuse OTLP export.

Wires a TracerProvider whose only span processor is a filtering wrapper that
forwards LLM-related spans (those carrying `gen_ai.system` or
`langfuse.observation.type`) to a BatchSpanProcessor → OTLP/HTTP exporter
pointed at Langfuse's `/api/public/otel/v1/traces` endpoint.

This keeps Langfuse free of unrelated spans (HTTP servers, DB calls, etc.)
even if FastAPI/Redis auto-instrumentation is added later.
"""
import base64

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, Span, TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SpanProcessor,
)

from shared.config import get_settings

_initialized = False


class LLMSpanFilterProcessor(SpanProcessor):
    """Forward only LLM-related spans to the inner processor.

    A span is considered LLM-related when, at end time, it carries either
    `gen_ai.system` (set by `shared/llm.py:generate()`) or
    `langfuse.observation.type` (set on root spans we want Langfuse to
    materialize as a trace).
    """

    def __init__(self, inner: SpanProcessor) -> None:
        self._inner = inner

    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        # NOTE: the SDK calls this as `on_start(span, parent_context=...)` BY
        # KEYWORD (sdk/trace: SynchronousMultiSpanProcessor.on_start), so this
        # parameter MUST be named exactly `parent_context`. Do NOT rename it to
        # `_parent_context` to appease vulture — that raises TypeError on every
        # span start and crashes the worker on the first turn. It is whitelisted
        # in [tool.vulture] ignore_names instead. Filtering happens in on_end;
        # the context is unused here.
        return None

    def on_end(self, span: ReadableSpan) -> None:
        attrs = span.attributes or {}
        if "gen_ai.system" in attrs or "langfuse.observation.type" in attrs:
            self._inner.on_end(span)

    def shutdown(self) -> None:
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return self._inner.force_flush(timeout_millis)


def init_telemetry(service_name: str | None = None) -> None:
    """Initialize the global TracerProvider once per process.

    No-op when `OTEL_ENABLED=false` or Langfuse keys are missing — callers
    can use `get_tracer()` unconditionally; spans just go to the default
    no-op tracer.
    """
    global _initialized
    if _initialized:
        return

    settings = get_settings()
    if not settings.otel_enabled or not settings.langfuse_secret_key:
        _initialized = True
        return

    auth = base64.b64encode(
        f"{settings.langfuse_public_key}:{settings.langfuse_secret_key}".encode()
    ).decode()

    exporter = OTLPSpanExporter(
        endpoint=f"{settings.langfuse_host.rstrip('/')}/api/public/otel/v1/traces",
        headers={
            "Authorization": f"Basic {auth}",
            "x-langfuse-ingestion-version": "4",
        },
    )

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": service_name or settings.otel_service_name,
                "deployment.environment": settings.environment,
            }
        )
    )
    provider.add_span_processor(
        LLMSpanFilterProcessor(BatchSpanProcessor(exporter))
    )
    trace.set_tracer_provider(provider)
    _initialized = True


def get_tracer(name: str = "islume"):
    """Return a tracer. Safe to call before init_telemetry() — falls back
    to the global no-op tracer."""
    return trace.get_tracer(name)
