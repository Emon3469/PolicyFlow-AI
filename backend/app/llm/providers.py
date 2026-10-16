import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

Tier = Literal["fast", "main"]

FAST_MAX_TOKENS = 24
FAST_REASONING_MAX_TOKENS = 320
MAIN_MAX_TOKENS = 1024
PROVIDER_COOLDOWN_SECONDS = 600
RATE_LIMIT_COOLDOWN_SECONDS = 20
MAX_RATE_LIMIT_COOLDOWN_SECONDS = 90
FATAL_MARKERS = ("credit balance", "invalid api key", "invalid x-api-key", "incorrect api key", "api key not valid", "permission")
MODEL_MARKERS = ("model_not_found", "does not exist", "no longer available", "decommissioned")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


class AllProvidersFailed(RuntimeError):
    pass


def _message_text(message) -> str:
    text = getattr(message, "text", "")
    if isinstance(text, str):
        if text:
            return str(text)
    elif callable(text):
        return str(text() or "")
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return ""


def _status_code(error: Exception) -> int | None:
    code = getattr(error, "status_code", None)
    if code is None:
        code = getattr(getattr(error, "response", None), "status_code", None)
    return code if isinstance(code, int) else None


def _retry_after(error: Exception) -> float | None:
    headers = getattr(getattr(error, "response", None), "headers", None)
    value = headers.get("retry-after") if headers is not None and hasattr(headers, "get") else None
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _is_reasoning_model(model: str) -> bool:
    return "gpt-oss" in model or model.startswith(("o1", "o3", "o4", "gpt-5"))


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass
class Provider:
    name: str
    factory: Callable[[str, Tier], BaseChatModel]
    models: dict[str, list[str]]
    cooldown_until: float = 0.0
    model_cooldowns: dict[str, float] = field(default_factory=dict)
    last_error: str = ""
    failures: int = 0
    successes: int = 0
    _cache: dict[tuple[str, str, int], BaseChatModel] = field(default_factory=dict)

    def client(self, model: str, tier: Tier) -> BaseChatModel:
        try:
            loop_id = id(asyncio.get_running_loop())
        except RuntimeError:
            loop_id = 0
        key = (model, tier, loop_id)
        if key not in self._cache:
            if len(self._cache) > 64:
                self._cache.clear()
            self._cache[key] = self.factory(model, tier)
        return self._cache[key]

    def ready_models(self, tier: Tier) -> list[str]:
        now = time.monotonic()
        if now < self.cooldown_until:
            return []
        return [m for m in self.models[tier] if now >= self.model_cooldowns.get(m, 0.0)]

    @property
    def available(self) -> bool:
        return bool(self.ready_models("fast") or self.ready_models("main"))

    def mark_failed(self, model: str, error: Exception, default_cooldown: int) -> None:
        self.failures += 1
        self.last_error = f"{model}: {str(error)[:280]}"
        code = _status_code(error)
        message = str(error).lower()
        now = time.monotonic()
        if code in (401, 402, 403) or any(marker in message for marker in FATAL_MARKERS):
            self.cooldown_until = now + PROVIDER_COOLDOWN_SECONDS
        elif code == 404 or any(marker in message for marker in MODEL_MARKERS):
            self.model_cooldowns[model] = now + PROVIDER_COOLDOWN_SECONDS
        elif code == 429:
            wait = _retry_after(error) or RATE_LIMIT_COOLDOWN_SECONDS
            self.model_cooldowns[model] = now + min(max(wait, 1.0), MAX_RATE_LIMIT_COOLDOWN_SECONDS)
        else:
            self.model_cooldowns[model] = now + default_cooldown

    def mark_ok(self, model: str) -> None:
        self.successes += 1
        self.model_cooldowns.pop(model, None)
        self.last_error = ""


def _max_tokens(model: str, tier: Tier) -> int:
    if tier == "main":
        return MAIN_MAX_TOKENS
    return FAST_REASONING_MAX_TOKENS if _is_reasoning_model(model) else FAST_MAX_TOKENS


def _build_openai(settings: Settings) -> Provider:
    from langchain_openai import ChatOpenAI

    def factory(model: str, tier: Tier) -> BaseChatModel:
        extra = {"reasoning_effort": "low"} if _is_reasoning_model(model) else {"temperature": 0}
        return ChatOpenAI(
            model=model,
            api_key=settings.openai_api_key,
            max_tokens=_max_tokens(model, tier),
            timeout=settings.llm_timeout_seconds,
            max_retries=0,
            stream_usage=False,
            **extra,
        )

    models = {"main": _split(settings.openai_model), "fast": _split(settings.openai_fast_model)}
    return Provider("openai", factory, models)


def _build_anthropic(settings: Settings) -> Provider:
    from langchain_anthropic import ChatAnthropic

    def factory(model: str, tier: Tier) -> BaseChatModel:
        return ChatAnthropic(
            model=model,
            api_key=settings.anthropic_api_key,
            max_tokens=MAIN_MAX_TOKENS if tier == "main" else 32,
            timeout=settings.llm_timeout_seconds,
            max_retries=0,
        )

    models = {"main": _split(settings.anthropic_model), "fast": _split(settings.anthropic_fast_model)}
    return Provider("anthropic", factory, models)


def _build_groq(settings: Settings) -> Provider:
    from langchain_groq import ChatGroq

    def factory(model: str, tier: Tier) -> BaseChatModel:
        if model.startswith("qwen/"):
            extra = {"reasoning_effort": "none"}
        elif _is_reasoning_model(model):
            extra = {"reasoning_effort": "low"}
        else:
            extra = {}
        return ChatGroq(
            model=model,
            api_key=settings.groq_api_key,
            temperature=0,
            max_tokens=_max_tokens(model, tier),
            timeout=settings.llm_timeout_seconds,
            max_retries=0,
            **extra,
        )

    models = {"main": _split(settings.groq_model), "fast": _split(settings.groq_fast_model)}
    return Provider("groq", factory, models)


def _build_gemini(settings: Settings) -> Provider:
    from langchain_openai import ChatOpenAI

    def factory(model: str, tier: Tier) -> BaseChatModel:
        return ChatOpenAI(
            model=model,
            api_key=settings.gemini_api_key,
            base_url=GEMINI_BASE_URL,
            temperature=0,
            max_tokens=MAIN_MAX_TOKENS if tier == "main" else 256,
            timeout=settings.llm_timeout_seconds,
            max_retries=0,
            stream_usage=False,
        )

    models = {"main": _split(settings.gemini_model), "fast": _split(settings.gemini_fast_model)}
    return Provider("gemini", factory, models)


BUILDERS = {
    "openai": (_build_openai, "openai_api_key"),
    "anthropic": (_build_anthropic, "anthropic_api_key"),
    "groq": (_build_groq, "groq_api_key"),
    "gemini": (_build_gemini, "gemini_api_key"),
}


class TextStream:
    def __init__(self, router: "LLMRouter", messages: list[BaseMessage], tier: Tier):
        self._router = router
        self._messages = messages
        self._tier = tier
        self.provider: str = ""
        self.model: str = ""

    def __aiter__(self) -> AsyncIterator[str]:
        return self._run()

    async def _run(self) -> AsyncIterator[str]:
        errors: list[str] = []
        for provider, model in self._router.candidates(self._tier):
            emitted = False
            try:
                async for chunk in provider.client(model, self._tier).astream(self._messages):
                    text = _message_text(chunk)
                    if text:
                        if not emitted:
                            self.provider, self.model = provider.name, model
                            emitted = True
                        yield text
                if emitted:
                    provider.mark_ok(model)
                    return
                raise ValueError("empty response")
            except Exception as exc:
                provider.mark_failed(model, exc, self._router.settings.llm_cooldown_seconds)
                logger.warning("%s/%s failed while streaming: %s", provider.name, model, str(exc)[:300])
                if emitted:
                    return
                errors.append(f"{provider.name}/{model}: {str(exc)[:200]}")
        raise AllProvidersFailed("; ".join(errors) or "No language model provider is configured")


class LLMRouter:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.providers: list[Provider] = []
        for name in settings.provider_order:
            builder = BUILDERS.get(name)
            if builder and getattr(settings, builder[1]):
                self.providers.append(builder[0](settings))
        if not self.providers:
            logger.error("No LLM provider keys configured. Set GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY.")

    def candidates(self, tier: Tier) -> list[tuple[Provider, str]]:
        ready = [(p, m) for p in self.providers for m in p.ready_models(tier)]
        if ready:
            return ready
        return [(p, m) for p in self.providers for m in p.models[tier]]

    async def complete(
        self, messages: list[BaseMessage], tier: Tier = "fast", max_tokens: int | None = None
    ) -> tuple[str, str]:
        errors: list[str] = []
        for provider, model in self.candidates(tier):
            try:
                kwargs = {}
                if max_tokens:
                    kwargs["max_tokens"] = max_tokens + (FAST_REASONING_MAX_TOKENS if _is_reasoning_model(model) else 0)
                result = await provider.client(model, tier).ainvoke(messages, **kwargs)
                text = _message_text(result).strip()
                if not text:
                    raise ValueError("empty response")
                provider.mark_ok(model)
                return text, provider.name
            except Exception as exc:
                provider.mark_failed(model, exc, self.settings.llm_cooldown_seconds)
                logger.warning("%s/%s failed: %s", provider.name, model, str(exc)[:300])
                errors.append(f"{provider.name}/{model}: {str(exc)[:200]}")
        raise AllProvidersFailed("; ".join(errors) or "No language model provider is configured")

    def stream(self, messages: list[BaseMessage], tier: Tier = "main") -> TextStream:
        return TextStream(self, messages, tier)

    async def probe(self, provider: Provider) -> bool:
        if not provider.models["fast"]:
            return False
        model = provider.models["fast"][0]
        try:
            result = await provider.client(model, "fast").ainvoke([HumanMessage("Reply with the single word: ok")])
            if not _message_text(result).strip():
                raise ValueError("empty response")
            provider.mark_ok(model)
            return True
        except Exception as exc:
            provider.mark_failed(model, exc, self.settings.llm_cooldown_seconds)
            logger.warning("Startup check failed for %s/%s: %s", provider.name, model, str(exc)[:200])
            return False

    async def warm_up(self) -> None:
        for provider in self.providers:
            for tier in ("fast", "main"):
                for model in provider.models[tier]:
                    provider.client(model, tier)
        if self.providers:
            results = await asyncio.gather(*(self.probe(p) for p in self.providers))
            healthy = [p.name for p, ok in zip(self.providers, results) if ok]
            logger.info("LLM providers online: %s", ", ".join(healthy) or "none")

    def status(self) -> list[dict]:
        configured = {p.name: p for p in self.providers}
        rows = []
        for name in self.settings.provider_order:
            provider = configured.get(name)
            rows.append({
                "name": name,
                "configured": provider is not None,
                "healthy": bool(provider and provider.available),
                "model": provider.models["main"][0] if provider and provider.models["main"] else None,
                "fast_model": provider.models["fast"][0] if provider and provider.models["fast"] else None,
                "models": sorted({m for tier in provider.models.values() for m in tier}) if provider else [],
                "successes": provider.successes if provider else 0,
                "failures": provider.failures if provider else 0,
                "last_error": provider.last_error if provider else "",
            })
        return rows


_router: LLMRouter | None = None


def get_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter(get_settings())
    return _router
