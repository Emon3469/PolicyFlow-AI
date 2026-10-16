import asyncio
import time

import httpx
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage

from app.core.config import Settings
from app.llm import providers
from app.llm.providers import AllProvidersFailed, LLMRouter, Provider


class FailingModel(GenericFakeChatModel):
    error: Exception

    def _generate(self, *args, **kwargs):
        raise self.error

    async def _agenerate(self, *args, **kwargs):
        raise self.error

    def _stream(self, *args, **kwargs):
        raise self.error

    async def _astream(self, *args, **kwargs):
        raise self.error
        yield


class HalfStreamModel(GenericFakeChatModel):
    async def _astream(self, *args, **kwargs):
        from langchain_core.outputs import ChatGenerationChunk
        from langchain_core.messages import AIMessageChunk

        yield ChatGenerationChunk(message=AIMessageChunk(content="partial "))
        raise RuntimeError("connection dropped")


def ok_model(text: str):
    return GenericFakeChatModel(messages=iter([AIMessage(content=text)] * 50))


def http_error(status: int, message: str = "error", headers: dict | None = None):
    request = httpx.Request("POST", "https://api.example.com")
    response = httpx.Response(status, request=request, headers=headers or {})

    class ApiError(Exception):
        def __init__(self):
            super().__init__(message)
            self.status_code = status
            self.response = response

    return ApiError()


def make_provider(name: str, models: dict[str, list[str]], behaviour: dict[str, object]) -> Provider:
    def factory(model, tier):
        item = behaviour[model]
        if isinstance(item, Exception):
            return FailingModel(messages=iter([]), error=item)
        if item == "half":
            return HalfStreamModel(messages=iter([]))
        if item == "":
            return ok_model("")
        return ok_model(item)

    return Provider(name, factory, models)


def router_with(*provider_list: Provider) -> LLMRouter:
    router = LLMRouter(Settings(_env_file=None, llm_providers=""))
    router.providers = list(provider_list)
    return router


MESSAGES = [HumanMessage("hello")]


def run(coro):
    return asyncio.run(coro)


async def collect(stream):
    return "".join([chunk async for chunk in stream])


def test_first_healthy_provider_answers():
    first = make_provider("groq", {"fast": ["a"], "main": ["a"]}, {"a": "kb"})
    second = make_provider("gemini", {"fast": ["b"], "main": ["b"]}, {"b": "direct"})
    text, name = run(router_with(first, second).complete(MESSAGES))
    assert (text, name) == ("kb", "groq")


def test_falls_back_to_next_provider_on_error():
    first = make_provider("openai", {"fast": ["a"], "main": ["a"]}, {"a": http_error(500, "server error")})
    second = make_provider("groq", {"fast": ["b"], "main": ["b"]}, {"b": "kb"})
    router = router_with(first, second)
    text, name = run(router.complete(MESSAGES))
    assert (text, name) == ("kb", "groq")
    assert first.failures == 1 and second.successes == 1
    assert router.candidates("fast")[0][0].name == "groq"


def test_model_failover_within_provider_on_rate_limit():
    groq = make_provider(
        "groq",
        {"fast": ["qwen", "oss-20b"], "main": ["oss-120b"]},
        {"qwen": http_error(429, "rate limit", {"retry-after": "7"}), "oss-20b": "kb", "oss-120b": "x"},
    )
    router = router_with(groq)
    text, name = run(router.complete(MESSAGES))
    assert (text, name) == ("kb", "groq")
    remaining = groq.model_cooldowns["qwen"] - time.monotonic()
    assert 5 < remaining <= 7
    assert groq.ready_models("fast") == ["oss-20b"]
    assert groq.available


def test_auth_or_billing_error_disables_whole_provider():
    anthropic = make_provider(
        "anthropic",
        {"fast": ["haiku"], "main": ["sonnet"]},
        {"haiku": http_error(400, "Your credit balance is too low"), "sonnet": "never"},
    )
    groq = make_provider("groq", {"fast": ["q"], "main": ["q"]}, {"q": "kb"})
    router = router_with(anthropic, groq)
    assert run(router.complete(MESSAGES))[1] == "groq"
    assert not anthropic.available
    assert [p.name for p, _ in router.candidates("main")] == ["groq"]


def test_missing_model_is_skipped_but_provider_stays_up():
    groq = make_provider("groq", {"fast": ["old", "new"], "main": ["new"]}, {"old": http_error(404, "model_not_found"), "new": "kb"})
    router = router_with(groq)
    assert run(router.complete(MESSAGES)) == ("kb", "groq")
    assert groq.ready_models("fast") == ["new"]


def test_empty_response_counts_as_failure():
    first = make_provider("groq", {"fast": ["a"], "main": ["a"]}, {"a": ""})
    second = make_provider("gemini", {"fast": ["b"], "main": ["b"]}, {"b": "kb"})
    assert run(router_with(first, second).complete(MESSAGES)) == ("kb", "gemini")


def test_all_providers_failing_raises():
    first = make_provider("groq", {"fast": ["a"], "main": ["a"]}, {"a": http_error(500)})
    second = make_provider("gemini", {"fast": ["b"], "main": ["b"]}, {"b": http_error(503)})
    with pytest.raises(AllProvidersFailed):
        run(router_with(first, second).complete(MESSAGES))


def test_no_providers_configured_raises():
    with pytest.raises(AllProvidersFailed):
        run(router_with().complete(MESSAGES))


def test_cooling_providers_are_retried_when_nothing_else_is_left():
    groq = make_provider("groq", {"fast": ["a"], "main": ["a"]}, {"a": "kb"})
    groq.model_cooldowns["a"] = time.monotonic() + 60
    assert run(router_with(groq).complete(MESSAGES)) == ("kb", "groq")


def test_stream_falls_back_before_first_token():
    first = make_provider("openai", {"fast": ["a"], "main": ["a"]}, {"a": http_error(503)})
    second = make_provider("groq", {"fast": ["b"], "main": ["b"]}, {"b": "Annual leave is 20 days"})
    stream = router_with(first, second).stream(MESSAGES)
    assert run(collect(stream)) == "Annual leave is 20 days"
    assert (stream.provider, stream.model) == ("groq", "b")


def test_stream_keeps_partial_answer_when_connection_drops_mid_way():
    first = make_provider("groq", {"fast": ["a"], "main": ["a"]}, {"a": "half"})
    second = make_provider("gemini", {"fast": ["b"], "main": ["b"]}, {"b": "should not be used"})
    stream = router_with(first, second).stream(MESSAGES)
    assert run(collect(stream)) == "partial "
    assert stream.provider == "groq"


def test_stream_raises_when_every_model_fails():
    first = make_provider("groq", {"fast": ["a"], "main": ["a"]}, {"a": http_error(500)})
    with pytest.raises(AllProvidersFailed):
        run(collect(router_with(first).stream(MESSAGES)))


def test_status_reports_configured_and_missing_providers():
    router = LLMRouter(Settings(_env_file=None, llm_providers="groq,openai", groq_api_key="gsk_test", openai_api_key=""))
    status = {row["name"]: row for row in router.status()}
    assert status["groq"]["configured"] and status["groq"]["healthy"]
    assert status["groq"]["models"]
    assert not status["openai"]["configured"]


def test_placeholder_keys_are_ignored():
    settings = Settings(_env_file=None, openai_api_key="YOUR_OPENAI_API_KEY", groq_api_key="  gsk_real  ")
    assert settings.openai_api_key == ""
    assert settings.groq_api_key == "gsk_real"


def test_comma_separated_models_are_parsed():
    assert providers._split(" a, b ,,c ") == ["a", "b", "c"]
    router = LLMRouter(Settings(_env_file=None, llm_providers="groq", groq_api_key="gsk_test", groq_fast_model="m1,m2"))
    assert router.providers[0].models["fast"] == ["m1", "m2"]


def test_fast_tier_token_budget_is_small_for_non_reasoning_models():
    assert providers._max_tokens("qwen/qwen3.8-27b", "fast") == providers.FAST_MAX_TOKENS
    assert providers._max_tokens("openai/gpt-oss-20b", "fast") == providers.FAST_REASONING_MAX_TOKENS
    assert providers._max_tokens("anything", "main") == providers.MAIN_MAX_TOKENS


def test_startup_probe_marks_broken_providers_unhealthy():
    broken = make_provider("anthropic", {"fast": ["haiku"], "main": ["sonnet"]}, {"haiku": http_error(400, "Your credit balance is too low"), "sonnet": "x"})
    healthy = make_provider("groq", {"fast": ["q"], "main": ["q"]}, {"q": "ok"})
    router = router_with(healthy, broken)
    run(router.warm_up())
    status = {row.name: row.available for row in router.providers}
    assert status == {"groq": True, "anthropic": False}
