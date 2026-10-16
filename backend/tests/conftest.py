import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_tmp = Path(tempfile.mkdtemp(prefix="policyflow-tests-"))
os.environ["AUDIT_DB_PATH"] = str(_tmp / "test.db")
os.environ["ADMIN_API_KEY"] = "test-admin-key"
os.environ["SEED_KNOWLEDGE_BASE"] = "false"
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")

import pytest  # noqa: E402

from app.rag import workflow  # noqa: E402
from app.rag.prompts import CONDENSE_SYSTEM, KB_GRADER_SYSTEM, REWRITE_SYSTEM, ROUTER_SYSTEM, WEB_GRADER_SYSTEM  # noqa: E402
from app.services import storage  # noqa: E402

storage.init_db()


class FakeStream:
    def __init__(self, text: str, provider: str = "fake"):
        self._text = text
        self.provider = provider
        self.model = "fake-model"

    def __aiter__(self):
        return self._run()

    async def _run(self):
        for word in self._text.split(" "):
            yield word + " "


class FakeRouter:
    def __init__(self, route="kb", kb_grade="good", web_grade="good", rewrite="rewritten query", answer="Grounded answer"):
        self.route = route
        self.kb_grade = kb_grade
        self.web_grade = web_grade
        self.rewrite = rewrite
        self.answer = answer
        self.calls: list[str] = []
        self.fail_router = False
        self.standalone = "What happens if I am off sick for more than 10 days?"

    async def complete(self, messages, tier="fast", max_tokens=None):
        system = messages[0].content
        if system == CONDENSE_SYSTEM:
            self.calls.append("condense")
            return self.standalone, "fake"
        if system == ROUTER_SYSTEM:
            self.calls.append("router")
            if self.fail_router:
                raise RuntimeError("router down")
            return self.route, "fake"
        if system == KB_GRADER_SYSTEM:
            self.calls.append("kb_grader")
            return self.kb_grade, "fake"
        if system == WEB_GRADER_SYSTEM:
            self.calls.append("web_grader")
            return self.web_grade, "fake"
        if system == REWRITE_SYSTEM:
            self.calls.append("rewrite")
            return self.rewrite, "fake"
        self.calls.append("other")
        return "ok", "fake"

    def stream(self, messages, tier="main"):
        self.calls.append("generate")
        return FakeStream(self.answer)


class FakeTavily:
    def __init__(self, results=None):
        self.queries: list[str] = []
        self.results = results if results is not None else [
            {"title": "Public Holidays 2026", "url": "https://example.gov/holidays", "content": "The government announced a holiday on 18 March."}
        ]

    async def search(self, query, **kwargs):
        self.queries.append(query)
        return {"answer": "Holiday on 18 March", "results": self.results}


def make_doc(score: float, text: str = "Full-time employees receive 20 days of paid annual leave.", doc_id: str = "company-hr-handbook"):
    return {
        "id": f"{doc_id}#0000",
        "text": text,
        "score": score,
        "metadata": {"doc_id": doc_id, "source": "company_hr_handbook.md", "title": "Company HR Handbook", "section": "Annual Leave"},
    }


@pytest.fixture
def fake_env(monkeypatch):
    router = FakeRouter()
    tavily = FakeTavily()
    state = {"docs": [make_doc(0.72)], "retrieved": []}

    def fake_retrieve(query):
        state["retrieved"].append(query)
        return list(state["docs"])

    monkeypatch.setattr(workflow, "get_router", lambda: router)
    monkeypatch.setattr(workflow, "retrieve", fake_retrieve)
    monkeypatch.setattr(workflow, "tavily", lambda: tavily)
    return {"router": router, "tavily": tavily, "state": state}
