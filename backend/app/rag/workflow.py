import asyncio
import logging
import re
import time
from typing import Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.core.config import get_settings
from app.llm.providers import get_router
from app.rag import prompts, vectorstore
from app.rag.state import AgentState

logger = logging.getLogger(__name__)
settings = get_settings()

SMALL_TALK = re.compile(
    r"^\s*(hi|hello|hey|hiya|yo|thanks|thank you|thx|ok|okay|cool|great|good (morning|afternoon|evening)|"
    r"bye|goodbye|who are you|what can you do)[\s!.?]*$",
    re.IGNORECASE,
)
HISTORY_TURNS = 6
GRADE_CONTEXT_CHARS = 700

_tavily = None


def tavily():
    global _tavily
    if _tavily is None and settings.tavily_api_key:
        from tavily import AsyncTavilyClient

        _tavily = AsyncTavilyClient(api_key=settings.tavily_api_key)
    return _tavily


def emit(state: AgentState, step: str, detail: str, started: float, status: str = "done") -> list:
    entry = {"step": step, "detail": detail, "status": status, "ms": int((time.perf_counter() - started) * 1000)}
    get_stream_writer()({"type": "trace", **entry})
    return [*state.get("trace", []), entry]


def history_messages(state: AgentState) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for turn in (state.get("history") or [])[-HISTORY_TURNS:]:
        content = str(turn.get("content", ""))[:2000]
        if not content:
            continue
        messages.append(AIMessage(content) if turn.get("role") == "assistant" else HumanMessage(content))
    return messages


def one_word(text: str, positive: str, negative: str, default: str) -> str:
    lowered = text.lower()
    if negative in lowered and positive not in lowered:
        return negative
    if positive in lowered and negative not in lowered:
        return positive
    return default


def kb_context(docs: list[dict], limit: int | None = None) -> str:
    blocks = []
    for doc in docs:
        meta = doc["metadata"]
        label = meta.get("title") or meta.get("source", "Document")
        if meta.get("section"):
            label += f" — {meta['section']}"
        if meta.get("page"):
            label += f" (page {meta['page']})"
        text = doc["text"] if limit is None else doc["text"][:limit]
        blocks.append(f"[{label}]\n{text}")
    return "\n\n".join(blocks)


def web_context(results: list[dict], summary: str, limit: int | None = None) -> str:
    lines = [f"Search summary: {summary}"] if summary else []
    for number, item in enumerate(results, start=1):
        content = item["content"] if limit is None else item["content"][:limit]
        lines.append(f"[{number}] {item['title']}\nURL: {item['url']}\n{content}")
    return "\n\n".join(lines)


def kb_citations(docs: list[dict]) -> list[dict]:
    citations, seen = [], set()
    for doc in docs:
        meta = doc["metadata"]
        key = (meta.get("doc_id"), meta.get("section"), meta.get("page"))
        if key in seen:
            continue
        seen.add(key)
        citations.append({
            "type": "private_kb",
            "title": meta.get("title") or meta.get("source", "Private KB"),
            "source": meta.get("source", ""),
            "section": meta.get("section", ""),
            "page": meta.get("page"),
            "score": doc["score"],
            "snippet": doc["text"][:240],
            "url": "",
        })
    return citations


def retrieve(query: str) -> list[dict]:
    return [chunk.as_dict() for chunk in vectorstore.search(query)]


def first_line(text: str, fallback: str) -> str:
    line = text.strip().strip('"').splitlines()[0].strip() if text.strip() else ""
    return line[:300] or fallback


def question_of(state: AgentState) -> str:
    return state.get("standalone") or state["question"]


def asked(state: AgentState) -> str:
    standalone = state.get("standalone")
    if standalone and standalone != state["question"]:
        return f"{state['question']}\n(Interpreted as: {standalone})"
    return state["question"]


async def condense(question: str, history: list[BaseMessage]) -> str:
    transcript = "\n".join(f"{m.type}: {str(m.content)[:400]}" for m in history[-4:])
    text, _ = await get_router().complete(
        [SystemMessage(prompts.CONDENSE_SYSTEM), HumanMessage(f"Conversation:\n{transcript}\n\nLatest message: {question}")],
        tier="fast",
        max_tokens=96,
    )
    return first_line(text, question)


async def classify(question: str) -> str:
    text, _ = await get_router().complete(
        [SystemMessage(prompts.ROUTER_SYSTEM), HumanMessage(f"Message: {question}")], tier="fast"
    )
    return one_word(text, "direct", "kb", "kb")


async def route_question(state: AgentState):
    started = time.perf_counter()
    question = state["question"]
    if SMALL_TALK.match(question):
        return {"route": "direct", "trace": emit(state, "Router", "Small talk detected → direct reply", started)}

    update: dict = {}
    history = history_messages(state)
    if history:
        try:
            standalone = await condense(question, history)
        except Exception as exc:
            logger.warning("Follow-up rewrite failed: %s", exc)
            standalone = question
        if standalone != question:
            update.update(standalone=standalone, current_query=standalone)
            question = standalone

    route_task = asyncio.create_task(classify(question))
    prefetch_task = asyncio.create_task(asyncio.to_thread(retrieve, question))
    try:
        route = await route_task
    except Exception as exc:
        logger.warning("Routing failed, defaulting to knowledge base: %s", exc)
        route = "kb"

    update["route"] = route
    if route == "kb":
        try:
            update["kb_docs"] = await prefetch_task
            update["kb_query"] = question
        except Exception as exc:
            logger.error("Knowledge base prefetch failed: %s", exc)
    else:
        prefetch_task.cancel()
    detail = "HR question → search private knowledge base" if route == "kb" else "General message → direct reply"
    if update.get("standalone"):
        detail += f" · follow-up read as “{question}”"
    update["trace"] = emit(state, "Router", detail, started)
    return update


def after_router(state: AgentState) -> Literal["retrieve_kb", "direct_answer"]:
    return "retrieve_kb" if state.get("route") == "kb" else "direct_answer"


async def retrieve_kb(state: AgentState):
    started = time.perf_counter()
    query = state["current_query"]
    if state.get("kb_query") == query and state.get("kb_docs") is not None:
        docs = state["kb_docs"]
    else:
        try:
            docs = await asyncio.to_thread(retrieve, query)
        except Exception as exc:
            logger.error("Knowledge base retrieval failed: %s", exc)
            docs = []
    top = max((d["score"] for d in docs), default=0.0)
    detail = f"{len(docs)} chunks from Pinecone (top relevance {top:.2f})" if docs else "No matching chunks found"
    return {"kb_docs": docs, "kb_query": query, "trace": emit(state, "Retrieve KB", detail, started)}


async def grade_kb(state: AgentState):
    started = time.perf_counter()
    docs = sorted(
        (d for d in state.get("kb_docs", []) if d["score"] >= settings.min_relevance_score),
        key=lambda d: d["score"],
        reverse=True,
    )
    if not docs:
        return {"kb_docs": [], "kb_grade": "weak",
                "trace": emit(state, "Grade KB evidence", "WEAK → below relevance threshold", started)}
    if docs[0]["score"] >= settings.strong_relevance_score:
        return {"kb_docs": docs, "kb_grade": "good",
                "trace": emit(state, "Grade KB evidence", "GOOD → high-relevance match", started)}
    try:
        text, _ = await get_router().complete([
            SystemMessage(prompts.KB_GRADER_SYSTEM),
            HumanMessage(f"Question: {question_of(state)}\n\nDocuments:\n{kb_context(docs, GRADE_CONTEXT_CHARS)}"),
        ], tier="fast")
        grade = one_word(text, "good", "weak", "weak")
    except Exception as exc:
        logger.warning("KB grading failed: %s", exc)
        grade = "good" if docs[0]["score"] >= 0.5 else "weak"
    detail = "GOOD → evidence is sufficient" if grade == "good" else "WEAK → evidence is not enough"
    return {"kb_docs": docs, "kb_grade": grade, "trace": emit(state, "Grade KB evidence", detail, started)}


def after_kb(state: AgentState) -> Literal["generate_from_kb", "search_web"]:
    return "generate_from_kb" if state.get("kb_grade") == "good" else "search_web"


async def search_web(state: AgentState):
    started = time.perf_counter()
    client = tavily()
    if client is None:
        return {"web_results": [], "web_answer": "",
                "trace": emit(state, "Web search", "Skipped → web search is not configured", started)}
    try:
        response = await client.search(
            state["current_query"],
            max_results=settings.web_search_max_results,
            search_depth="basic",
            include_answer=True,
        )
    except Exception as exc:
        logger.error("Web search failed: %s", exc)
        return {"web_results": [], "web_answer": "",
                "trace": emit(state, "Web search", "Failed → search provider unavailable", started)}
    results = [
        {"title": item.get("title") or item.get("url", ""), "url": item.get("url", ""),
         "content": (item.get("content") or "")[:1500]}
        for item in response.get("results", [])
    ]
    return {
        "web_results": results,
        "web_answer": response.get("answer") or "",
        "trace": emit(state, "Web search", f"Tavily returned {len(results)} results", started),
    }


async def grade_web(state: AgentState):
    started = time.perf_counter()
    results = state.get("web_results") or []
    if not results:
        return {"web_grade": "weak", "trace": emit(state, "Grade web evidence", "WEAK → no results", started)}
    try:
        text, _ = await get_router().complete([
            SystemMessage(prompts.WEB_GRADER_SYSTEM),
            HumanMessage(f"Question: {question_of(state)}\n\nResults:\n{web_context(results, state.get('web_answer', ''), 500)}"),
        ], tier="fast")
        grade = one_word(text, "good", "weak", "good")
    except Exception as exc:
        logger.warning("Web grading failed: %s", exc)
        grade = "good"
    detail = "GOOD → evidence is sufficient" if grade == "good" else "WEAK → evidence is not enough"
    return {"web_grade": grade, "trace": emit(state, "Grade web evidence", detail, started)}


def after_web(state: AgentState) -> Literal["generate_from_web", "rewrite_query", "insufficient"]:
    if state.get("web_grade") == "good":
        return "generate_from_web"
    if state.get("retry_count", 0) < settings.max_retries:
        return "rewrite_query"
    return "insufficient"


async def rewrite_query(state: AgentState):
    started = time.perf_counter()
    try:
        text, _ = await get_router().complete(
            [SystemMessage(prompts.REWRITE_SYSTEM), HumanMessage(question_of(state))], tier="fast", max_tokens=96
        )
        rewritten = first_line(text, question_of(state))
    except Exception as exc:
        logger.warning("Query rewrite failed: %s", exc)
        rewritten = question_of(state)
    return {
        "current_query": rewritten,
        "retry_count": state.get("retry_count", 0) + 1,
        "trace": emit(state, "Rewrite query", f"Retrying with “{rewritten}”", started),
    }


async def stream_answer(state: AgentState, messages: list[BaseMessage], step: str, detail: str):
    started = time.perf_counter()
    writer = get_stream_writer()
    writer({"type": "trace", "step": step, "detail": detail, "status": "running", "ms": 0})
    stream = get_router().stream(messages, tier="main")
    parts: list[str] = []
    async for text in stream:
        parts.append(text)
        writer({"type": "token", "text": text})
    answer = "".join(parts).strip()
    trace = emit(state, step, f"{detail} · {stream.provider}", started)
    return answer, stream.provider, trace


async def generate_from_kb(state: AgentState):
    docs = state["kb_docs"]
    citations = kb_citations(docs)
    get_stream_writer()({"type": "meta", "source_used": "private_kb", "citations": citations})
    messages = [
        SystemMessage(prompts.KB_ANSWER_SYSTEM),
        *history_messages(state),
        HumanMessage(f"Company knowledge base excerpts:\n\n{kb_context(docs)}\n\nEmployee question: {asked(state)}"),
    ]
    answer, provider, trace = await stream_answer(state, messages, "Generate answer", "Grounded in private KB")
    return {"answer": answer, "provider": provider, "source_used": "private_kb", "citations": citations, "trace": trace}


async def generate_from_web(state: AgentState):
    results = state.get("web_results") or []
    citations = [
        {"type": "web", "title": r["title"], "url": r["url"], "snippet": r["content"][:240], "source": r["url"]}
        for r in results
    ]
    get_stream_writer()({"type": "meta", "source_used": "web_search", "citations": citations})
    messages = [
        SystemMessage(prompts.WEB_ANSWER_SYSTEM),
        *history_messages(state),
        HumanMessage(f"Web results:\n\n{web_context(results, state.get('web_answer', ''))}\n\n"
                     f"Employee question: {asked(state)}"),
    ]
    answer, provider, trace = await stream_answer(state, messages, "Generate answer", "Grounded in web evidence")
    return {"answer": answer, "provider": provider, "source_used": "web_search", "citations": citations, "trace": trace}


async def direct_answer(state: AgentState):
    get_stream_writer()({"type": "meta", "source_used": "direct", "citations": []})
    messages = [SystemMessage(prompts.DIRECT_SYSTEM), *history_messages(state), HumanMessage(state["question"])]
    answer, provider, trace = await stream_answer(state, messages, "Respond", "Direct reply")
    return {"answer": answer, "provider": provider, "source_used": "direct", "citations": [], "trace": trace}


async def insufficient(state: AgentState):
    started = time.perf_counter()
    writer = get_stream_writer()
    writer({"type": "meta", "source_used": "insufficient_evidence", "citations": []})
    writer({"type": "token", "text": prompts.INSUFFICIENT_ANSWER})
    return {
        "answer": prompts.INSUFFICIENT_ANSWER,
        "source_used": "insufficient_evidence",
        "citations": [],
        "trace": emit(state, "Stop", "Not enough reliable evidence to answer", started),
    }


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("route_question", route_question)
    graph.add_node("retrieve_kb", retrieve_kb)
    graph.add_node("grade_kb", grade_kb)
    graph.add_node("search_web", search_web)
    graph.add_node("grade_web", grade_web)
    graph.add_node("rewrite_query", rewrite_query)
    graph.add_node("generate_from_kb", generate_from_kb)
    graph.add_node("generate_from_web", generate_from_web)
    graph.add_node("direct_answer", direct_answer)
    graph.add_node("insufficient", insufficient)

    graph.add_edge(START, "route_question")
    graph.add_conditional_edges("route_question", after_router)
    graph.add_edge("retrieve_kb", "grade_kb")
    graph.add_conditional_edges("grade_kb", after_kb)
    graph.add_edge("search_web", "grade_web")
    graph.add_conditional_edges("grade_web", after_web)
    graph.add_edge("rewrite_query", "retrieve_kb")
    for terminal in ("generate_from_kb", "generate_from_web", "direct_answer", "insufficient"):
        graph.add_edge(terminal, END)
    return graph.compile()


agent_graph = build_graph()


def initial_state(question: str, history: list[dict] | None = None) -> AgentState:
    return {
        "question": question,
        "history": history or [],
        "current_query": question,
        "standalone": "",
        "route": "",
        "kb_docs": [],
        "kb_query": "",
        "kb_grade": "",
        "web_results": [],
        "web_answer": "",
        "web_grade": "",
        "retry_count": 0,
        "answer": "",
        "source_used": "",
        "provider": "",
        "citations": [],
        "trace": [],
    }


async def run(question: str, history: list[dict] | None = None) -> AgentState:
    return await agent_graph.ainvoke(initial_state(question, history))


async def run_stream(question: str, history: list[dict] | None = None):
    final: AgentState = {}
    async for mode, payload in agent_graph.astream(
        initial_state(question, history), stream_mode=["custom", "values"]
    ):
        if mode == "custom":
            yield payload
        else:
            final = payload
    yield {"type": "final", "state": final}
