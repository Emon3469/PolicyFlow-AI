import sys
from pathlib import Path

from app.core.config import get_settings
from app.services.ingestion import ingest_folder
from app.services.storage import init_db


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(get_settings().knowledge_base_dir)
    init_db()
    results = ingest_folder(folder, origin="seed")
    for doc in results:
        print(f"{doc['name']}: {doc['chunks']} chunks")
    print(f"Indexed {len(results)} documents, {sum(d['chunks'] for d in results)} chunks")


if __name__ == "__main__":
    main()
