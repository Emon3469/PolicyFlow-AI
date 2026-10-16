import re
from dataclasses import dataclass
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import get_settings
from app.rag import vectorstore
from app.services import storage

SUPPORTED = {".pdf", ".txt", ".md", ".docx"}
HEADING = re.compile(r"^(#{1,4})\s+(.+?)\s*#*\s*$")

settings = get_settings()


@dataclass
class Section:
    text: str
    title: str = ""
    page: int | None = None


def slugify(name: str) -> str:
    stem = Path(name).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return slug[:60] or "document"


ACRONYMS = {"hr", "it", "pto", "faq", "sop", "kb", "ai", "us", "uk", "eu", "nda"}


def humanize(name: str) -> str:
    words = re.sub(r"[_\-]+", " ", Path(name).stem).split()
    return " ".join(w.upper() if w.lower() in ACRONYMS else w.capitalize() for w in words) or name


def _markdown_sections(text: str) -> list[Section]:
    sections: list[Section] = []
    title, buffer = "", []
    for line in text.splitlines():
        match = HEADING.match(line)
        if match and match.group(1) != "#":
            if "".join(buffer).strip():
                sections.append(Section("\n".join(buffer).strip(), title))
            title, buffer = match.group(2), []
        elif match:
            continue
        else:
            buffer.append(line)
    if "".join(buffer).strip():
        sections.append(Section("\n".join(buffer).strip(), title))
    return sections


def _pdf_sections(path: Path) -> list[Section]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    return [
        Section(text.strip(), page=number)
        for number, page in enumerate(reader.pages, start=1)
        if (text := page.extract_text() or "").strip()
    ]


def _docx_sections(path: Path) -> list[Section]:
    from docx import Document

    document = Document(str(path))
    sections: list[Section] = []
    title, buffer = "", []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        if paragraph.style is not None and paragraph.style.name.lower().startswith("heading"):
            if buffer:
                sections.append(Section("\n".join(buffer), title))
            title, buffer = text, []
        else:
            buffer.append(text)
    if buffer:
        sections.append(Section("\n".join(buffer), title))
    return sections


def load_sections(path: Path) -> list[Section]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _pdf_sections(path)
    if suffix == ".docx":
        return _docx_sections(path)
    if suffix in {".md", ".txt"}:
        text = path.read_text(encoding="utf-8", errors="ignore")
        return _markdown_sections(text) if suffix == ".md" else [Section(text.strip())]
    raise ValueError(f"Unsupported file type: {suffix}")


def build_chunks(sections: list[Section], source: str) -> tuple[list[str], list[dict]]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )
    texts, metadatas = [], []
    for section in sections:
        for piece in splitter.split_text(section.text):
            body = f"{section.title}\n{piece}" if section.title else piece
            meta = {"source": source, "section": section.title}
            if section.page is not None:
                meta["page"] = section.page
            texts.append(body)
            metadatas.append(meta)
    return texts, metadatas


def ingest_file(path: Path, display_name: str | None = None, origin: str = "upload") -> dict:
    name = display_name or path.name
    sections = load_sections(path)
    texts, metadatas = build_chunks(sections, name)
    if not texts:
        raise ValueError("No readable text was found in this document")

    doc_id = slugify(name)
    previous = storage.get_document(doc_id)
    vectorstore.delete_document(doc_id, previous["chunks"] if previous else 0)
    size = path.stat().st_size
    for meta in metadatas:
        meta["title"] = humanize(name)
        meta["file_type"] = path.suffix.lower().lstrip(".")
        meta["origin"] = origin
        meta["size_bytes"] = size
    count = vectorstore.upsert_chunks(doc_id, texts, metadatas)

    record = {
        "doc_id": doc_id,
        "name": name,
        "title": humanize(name),
        "file_type": path.suffix.lower().lstrip("."),
        "chunks": count,
        "size_bytes": size,
        "origin": origin,
    }
    storage.upsert_document(record)
    return record


def ingest_folder(folder: Path, origin: str = "seed") -> list[dict]:
    results = []
    for path in sorted(folder.iterdir()):
        if path.is_file() and path.suffix.lower() in SUPPORTED:
            results.append(ingest_file(path, origin=origin))
    return results
