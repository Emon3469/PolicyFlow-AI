import asyncio

import pytest
from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import get_settings
from app.llm.providers import _message_text, get_router
from app.rag import vectorstore, workflow

pytestmark = pytest.mark.live
settings = get_settings()
LOOP = asyncio.new_event_loop()


def run(coro):
    return LOOP.run_until_complete(coro)


def provider_models():
    pairs = []
    for provider in get_router().providers:
        for tier in ("fast", "main"):
            for model in provider.models[tier]:
                pairs.append(pytest.param(provider, model, tier, id=f"{provider.name}:{tier}:{model}"))
    return pairs


@pytest.mark.parametrize("provider,model,tier", provider_models())
def test_each_configured_model_generates_and_streams(provider, model, tier):
    messages = [SystemMessage("Reply with exactly one word."), HumanMessage("Is 20 days of annual leave a number? Answer yes or no.")]

    async def check():
        client = provider.client(model, tier)
        result = await client.ainvoke(messages)
        chunks = [_message_text(chunk) async for chunk in client.astream(messages)]
        return _message_text(result), "".join(chunks)

    try:
        text, streamed = run(check())
    except Exception as exc:
        pytest.fail(f"{provider.name}/{model} unavailable: {str(exc)[:200]}")
    assert text.strip(), "empty completion"
    assert streamed.strip(), "empty stream"


def test_router_serves_both_tiers():
    router = get_router()
    assert router.providers, "no LLM provider configured"

    async def check():
        text, name = await router.complete([HumanMessage("Reply with the single word: ok")], tier="fast")
        stream = router.stream([HumanMessage("Say hello in five words.")], tier="main")
        streamed = "".join([t async for t in stream])
        return text, name, streamed, stream.provider

    text, name, streamed, streamed_by = run(check())
    assert text and name and streamed and streamed_by


@pytest.mark.skipif(not settings.pinecone_api_key, reason="PINECONE_API_KEY not set")
def test_pinecone_index_and_semantic_search():
    assert vectorstore.vector_count() > 0, "knowledge base is empty - start the API once to seed it"
    results = vectorstore.search("How many days of annual leave do employees get?")
    assert results and results[0].score > 0.5
    assert "20 days" in " ".join(r.text for r in results)


@pytest.mark.skipif(not settings.tavily_api_key, reason="TAVILY_API_KEY not set")
def test_tavily_web_search():
    response = run(workflow.tavily().search("public holidays 2026", max_results=2, search_depth="basic"))
    assert response.get("results")


def test_end_to_end_private_kb_answer():
    state = run(workflow.run("How many annual leave days do employees receive?"))
    assert state["source_used"] == "private_kb"
    assert "20" in state["answer"]
    assert state["provider"]


@pytest.mark.skipif(not settings.tavily_api_key, reason="TAVILY_API_KEY not set")
def test_end_to_end_web_fallback():
    state = run(workflow.run("What is the UK national minimum wage per hour in 2026?"))
    assert state["source_used"] in {"web_search", "insufficient_evidence"}
    assert state["answer"]


def test_end_to_end_follow_up_uses_conversation_context():
    history = [
        {"role": "user", "content": "How many sick days do I get?"},
        {"role": "assistant", "content": "You get up to 10 paid sick days per calendar year."},
    ]
    state = run(workflow.run("What if I'm out for longer than that?", history))
    assert state["standalone"] and state["standalone"] != "What if I'm out for longer than that?"
    assert state["source_used"] == "private_kb"
    assert "medical" in state["answer"].lower() or "document" in state["answer"].lower()
