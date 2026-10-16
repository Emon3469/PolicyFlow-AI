import asyncio

from app.rag import prompts, workflow
from conftest import make_doc


def run(question, history=None):
    return asyncio.run(workflow.run(question, history))


def stream(question):
    async def collect():
        return [event async for event in workflow.run_stream(question)]

    return asyncio.run(collect())


def steps(state):
    return [entry["step"] for entry in state["trace"]]


def test_small_talk_skips_router_and_retrieval(fake_env):
    state = run("hello!")
    assert state["source_used"] == "direct"
    assert "router" not in fake_env["router"].calls
    assert fake_env["state"]["retrieved"] == []


def test_strong_kb_match_answers_without_llm_grader(fake_env):
    state = run("How many annual leave days do I get?")
    assert state["source_used"] == "private_kb"
    assert state["answer"].startswith("Grounded answer")
    assert "kb_grader" not in fake_env["router"].calls
    assert state["citations"][0]["section"] == "Annual Leave"
    assert fake_env["state"]["retrieved"] == ["How many annual leave days do I get?"]


def test_medium_kb_match_uses_llm_grader(fake_env):
    fake_env["state"]["docs"] = [make_doc(0.45)]
    state = run("Can I carry over leave?")
    assert state["source_used"] == "private_kb"
    assert "kb_grader" in fake_env["router"].calls


def test_weak_kb_falls_back_to_web(fake_env):
    fake_env["state"]["docs"] = [make_doc(0.12)]
    state = run("Latest government holiday announcement?")
    assert state["source_used"] == "web_search"
    assert state["citations"][0]["url"] == "https://example.gov/holidays"
    assert steps(state) == ["Router", "Retrieve KB", "Grade KB evidence", "Web search", "Grade web evidence", "Generate answer"]


def test_llm_grader_can_reject_kb_evidence(fake_env):
    fake_env["state"]["docs"] = [make_doc(0.45)]
    fake_env["router"].kb_grade = "weak"
    assert run("Pet insurance?")["source_used"] == "web_search"


def test_everything_weak_rewrites_then_declines(fake_env):
    fake_env["state"]["docs"] = [make_doc(0.1)]
    fake_env["router"].web_grade = "weak"
    state = run("Do we get a pet insurance stipend?")
    assert state["source_used"] == "insufficient_evidence"
    assert state["answer"] == prompts.INSUFFICIENT_ANSWER
    assert state["retry_count"] == 1
    assert fake_env["state"]["retrieved"][-1] == "rewritten query"
    assert fake_env["tavily"].queries == ["Do we get a pet insurance stipend?", "rewritten query"]
    assert "generate" not in fake_env["router"].calls


def test_router_failure_defaults_to_knowledge_base(fake_env):
    fake_env["router"].fail_router = True
    assert run("What is the remote work policy?")["source_used"] == "private_kb"


def test_router_can_choose_direct(fake_env):
    fake_env["router"].route = "direct"
    state = run("Tell me a joke about spreadsheets")
    assert state["source_used"] == "direct"
    assert state["citations"] == []


def test_missing_web_search_declines_safely(fake_env, monkeypatch):
    monkeypatch.setattr(workflow, "tavily", lambda: None)
    fake_env["state"]["docs"] = []
    state = run("What changed in labour law this week?")
    assert state["source_used"] == "insufficient_evidence"


def test_retrieval_errors_do_not_crash(fake_env, monkeypatch):
    def broken(query):
        raise ConnectionError("pinecone down")

    monkeypatch.setattr(workflow, "retrieve", broken)
    fake_env["router"].web_grade = "good"
    assert run("How many sick days?")["source_used"] == "web_search"


def test_history_is_forwarded_to_generation(fake_env):
    captured = {}
    original = fake_env["router"].stream

    def spy(messages, tier="main"):
        captured["messages"] = messages
        return original(messages, tier)

    fake_env["router"].stream = spy
    run("And sick leave?", [{"role": "user", "content": "How much annual leave?"}, {"role": "assistant", "content": "20 days."}])
    kinds = [m.type for m in captured["messages"]]
    assert kinds == ["system", "human", "ai", "human"]


def test_stream_emits_trace_meta_tokens_and_final_state(fake_env):
    events = stream("How many annual leave days do I get?")
    kinds = [e["type"] for e in events]
    assert kinds[0] == "trace"
    assert "meta" in kinds and "token" in kinds
    assert kinds[-1] == "final"
    assert kinds.index("meta") < kinds.index("token")
    text = "".join(e["text"] for e in events if e["type"] == "token")
    assert text.strip() == "Grounded answer"
    final = events[-1]["state"]
    assert final["source_used"] == "private_kb" and final["provider"] == "fake"


def test_follow_up_is_rewritten_into_standalone_question(fake_env):
    history = [{"role": "user", "content": "How many sick days do I get?"}, {"role": "assistant", "content": "10 paid sick days."}]
    state = run("What if I'm out for longer than that?", history)
    standalone = fake_env["router"].standalone
    assert fake_env["router"].calls[0] == "condense"
    assert state["standalone"] == standalone
    assert fake_env["state"]["retrieved"] == [standalone]
    assert "follow-up read as" in state["trace"][0]["detail"]
    assert state["source_used"] == "private_kb"


def test_first_question_skips_condensing(fake_env):
    run("How many sick days do I get?")
    assert "condense" not in fake_env["router"].calls
