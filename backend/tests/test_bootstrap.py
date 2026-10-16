from app.services import bootstrap, storage


def test_registry_is_rebuilt_from_vector_metadata_after_restart(monkeypatch):
    ids = ["leave-policy#0000", "leave-policy#0001", "travel#0000"]
    metadata = {
        "leave-policy#0000": {"source": "leave_policy.md", "title": "Leave Policy", "file_type": "md", "origin": "seed", "size_bytes": 2175},
        "travel#0000": {"source": "travel.pdf", "title": "Travel", "file_type": "pdf", "origin": "upload", "size_bytes": 9000},
    }
    monkeypatch.setattr(bootstrap.vectorstore, "list_ids", lambda prefix=None: ids)
    monkeypatch.setattr(bootstrap.vectorstore, "fetch_metadata", lambda wanted: {k: metadata[k] for k in wanted if k in metadata})
    storage.upsert_document({"doc_id": "stale-doc", "name": "old.md", "title": "Old", "file_type": "md", "chunks": 1, "size_bytes": 1, "origin": "upload"})

    bootstrap.sync_registry()

    docs = {d["doc_id"]: d for d in storage.list_documents()}
    assert "stale-doc" not in docs
    assert docs["leave-policy"]["chunks"] == 2
    assert docs["leave-policy"]["origin"] == "seed" and docs["leave-policy"]["size_bytes"] == 2175
    assert docs["travel"]["file_type"] == "pdf" and docs["travel"]["origin"] == "upload"
    assert bootstrap.state["vectors"] == 3
