import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.api import routes
from app.services import ingestion

ADMIN = {"X-Admin-Key": "test-admin-key"}


@pytest.fixture
def client(fake_env, monkeypatch):
    async def no_warm_up():
        return None

    monkeypatch.setattr(main, "start_background_bootstrap", lambda: None)
    monkeypatch.setattr(main.get_router(), "warm_up", no_warm_up)
    with TestClient(main.app) as test_client:
        yield test_client


def parse_sse(body: str):
    events = []
    for block in body.strip().split("\n\n"):
        event, data = None, None
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:].strip())
        if event:
            events.append((event, data))
    return events


def test_root_and_health(client):
    assert client.get("/").json()["status"] == "ok"
    health = client.get("/api/health").json()
    assert health["status"] == "ok"
    assert {"knowledge_base", "providers", "web_search", "index"} <= health.keys()


def test_chat_returns_answer_and_is_audited(client):
    response = client.post("/api/chat", json={"question": "How many annual leave days?"})
    assert response.status_code == 200
    body = response.json()
    assert body["source_used"] == "private_kb"
    assert body["answer"].startswith("Grounded answer")
    assert len(body["id"]) == 32 and body["latency_ms"] >= 0
    logs = client.get("/api/logs", params={"limit": 5}).json()
    assert logs["items"][0]["id"] == body["id"]
    assert logs["items"][0]["trace"]


def test_chat_validation(client):
    assert client.post("/api/chat", json={"question": ""}).status_code == 422
    assert client.post("/api/chat", json={"question": "x" * 3001}).status_code == 422
    assert client.post("/api/chat", json={"question": "hi", "history": [{"role": "system", "content": "x"}]}).status_code == 422


def test_stream_emits_events_in_order(client):
    with client.stream("POST", "/api/chat/stream", json={"question": "How many annual leave days?"}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(response.iter_text())
    events = parse_sse(body)
    names = [name for name, _ in events]
    assert names[0] == "trace" and names[-1] == "done"
    assert "meta" in names and "token" in names
    done = events[-1][1]
    assert done["source_used"] == "private_kb" and done["provider"] == "fake"
    answer = "".join(data["text"] for name, data in events if name == "token")
    assert answer.strip() == "Grounded answer"


def test_stream_reports_provider_outage_as_error_event(client, fake_env):
    from app.llm.providers import AllProvidersFailed

    def broken_stream(messages, tier="main"):
        raise AllProvidersFailed("all down")

    fake_env["router"].stream = broken_stream
    with client.stream("POST", "/api/chat/stream", json={"question": "How many annual leave days?"}) as response:
        events = parse_sse("".join(response.iter_text()))
    assert events[-1][0] == "error"
    assert "temporarily unavailable" in events[-1][1]["message"]


def test_chat_returns_503_when_all_providers_fail(client, fake_env):
    from app.llm.providers import AllProvidersFailed

    def broken_stream(messages, tier="main"):
        raise AllProvidersFailed("all down")

    fake_env["router"].stream = broken_stream
    assert client.post("/api/chat", json={"question": "Annual leave?"}).status_code == 503


def test_feedback_flow(client):
    query_id = client.post("/api/chat", json={"question": "Sick leave?"}).json()["id"]
    assert client.post("/api/feedback", json={"query_id": query_id, "rating": 1}).status_code == 200
    assert client.post("/api/feedback", json={"query_id": "0" * 32, "rating": 1}).status_code == 404
    assert client.post("/api/feedback", json={"query_id": query_id, "rating": 5}).status_code == 422
    stats = client.get("/api/stats").json()
    assert stats["feedback_total"] >= 1 and stats["feedback_positive"] >= 1


def test_logs_pagination_and_filter(client, fake_env):
    client.post("/api/chat", json={"question": "hello"})
    page = client.get("/api/logs", params={"limit": 1, "offset": 0}).json()
    assert len(page["items"]) == 1 and page["total"] >= 1
    direct = client.get("/api/logs", params={"source": "direct"}).json()
    assert direct["items"] and all(i["source_used"] == "direct" for i in direct["items"])
    assert client.get("/api/logs", params={"limit": 0}).status_code == 422


def test_stats_shape(client):
    client.post("/api/chat", json={"question": "Annual leave?"})
    stats = client.get("/api/stats").json()
    assert stats["total_queries"] >= 1 and stats["queries_today"] >= 1
    assert len(stats["trend"]) == 7
    assert stats["recent"] and "providers" in stats


def test_admin_verification(client, monkeypatch):
    assert client.get("/api/admin/verify", headers=ADMIN).status_code == 200
    assert client.get("/api/admin/verify", headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert client.get("/api/admin/verify").status_code == 401
    monkeypatch.setattr(routes.settings, "admin_api_key", "")
    assert client.get("/api/admin/verify", headers=ADMIN).status_code == 503


def test_ingest_validation(client):
    files = {"file": ("policy.md", b"## Leave\n20 days", "text/markdown")}
    assert client.post("/api/ingest", files=files, headers={"X-Admin-Key": "nope"}).status_code == 401
    bad = {"file": ("data.exe", b"MZ", "application/octet-stream")}
    assert client.post("/api/ingest", files=bad, headers=ADMIN).status_code == 400
    empty = {"file": ("empty.md", b"", "text/markdown")}
    assert client.post("/api/ingest", files=empty, headers=ADMIN).status_code == 400
    big = {"file": ("big.txt", b"a" * (10 * 1024 * 1024 + 10), "text/plain")}
    assert client.post("/api/ingest", files=big, headers=ADMIN).status_code == 413
    blank = {"file": ("blank.txt", b"    ", "text/plain")}
    assert client.post("/api/ingest", files=blank, headers=ADMIN).status_code == 422


def test_ingest_list_and_delete_document(client, monkeypatch):
    monkeypatch.setattr(ingestion.vectorstore, "delete_document", lambda doc_id, known=0: 0)
    monkeypatch.setattr(ingestion.vectorstore, "upsert_chunks", lambda doc_id, texts, metas: len(texts))
    files = {"file": ("travel_policy.md", b"## Travel\nBook economy class for flights under 6 hours.", "text/markdown")}
    response = client.post("/api/ingest", files=files, headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["doc_id"] == "travel-policy"

    docs = client.get("/api/documents").json()
    assert any(d["doc_id"] == "travel-policy" for d in docs["items"])

    deleted = {}
    monkeypatch.setattr(routes.vectorstore, "delete_document", lambda doc_id, known=0: deleted.setdefault(doc_id, known))
    assert client.delete("/api/documents/travel-policy", headers={"X-Admin-Key": "nope"}).status_code == 401
    assert client.delete("/api/documents/travel-policy", headers=ADMIN).status_code == 200
    assert deleted["travel-policy"] == 1
    monkeypatch.setattr(routes.vectorstore, "delete_document", lambda doc_id, known=0: 0)
    assert client.delete("/api/documents/travel-policy", headers=ADMIN).status_code == 404


def test_cors_allows_configured_frontend(client):
    response = client.options(
        "/api/chat/stream",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    blocked = client.options(
        "/api/chat", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in blocked.headers
