# PolicyFlow AI

HR policy copilot. Employees ask questions in plain language and get grounded answers streamed back with citations drawn from the company knowledge base, plus web search when the handbook is not enough.

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, SWR, command palette, light and dark themes, streamed answers with source citations
- **Backend**: FastAPI, LangGraph, Pinecone, fastembed local embeddings, Tavily web search, SQLite audit log
- **LLM gateway**: ordered fallback across Groq, OpenAI, Anthropic and Gemini with per-provider cooldowns

## Repository layout

```
PolicyFlow-AI/
├── backend/             FastAPI service (deployed to Render)
│   ├── app/
│   │   ├── api/         routes, SSE streaming, schemas
│   │   ├── core/        settings and logging
│   │   ├── llm/         multi-provider router with fallback
│   │   ├── rag/         retrieval workflow, embeddings, vector store
│   │   └── services/    bootstrap, ingestion, storage
│   ├── data/            SQLite audit log and knowledge base
│   └── docs/            problem statement and architecture
├── frontend/            Next.js app (deployed to Vercel)
├── docker-compose.yml   API + web stack for local Docker runs
└── render.yaml          Render blueprint
```

## Running with Docker

Requirements: Docker only.

```bash
cp backend/.env.example backend/.env   # add at least one LLM key, plus Pinecone and Tavily for full function
docker compose up --build
```

- Web app: http://localhost:3000
- API: http://localhost:8000, interactive docs at http://localhost:8000/docs

Notes:

- `docker-compose.yml` builds `backend/Dockerfile` (Python 3.13 slim, non-root, `HEALTHCHECK` on `/api/health`) and `frontend/Dockerfile` (Next.js standalone output on Node 22 alpine). The web container waits for the API to report healthy.
- The embedding model is downloaded during the image build (the same `prepare.py` step Render runs), so the first request does not pay the download.
- SQLite, uploads and the seed knowledge base live in the `api-data` volume. Docker seeds that volume from the bundled handbook on first run, so the seeded documents are there and later uploads persist.
- `NEXT_PUBLIC_API_URL` is compiled into the browser bundle at build time and defaults to `http://localhost:8000`. Set it before `docker compose up` if the API lives somewhere else.

`.github/workflows/docker.yml` builds both images on every push and pull request so Dockerfile changes cannot rot unnoticed.

## Running locally

Requirements: Python 3.13+, Node.js 20+.

1. Copy `backend/.env.example` to `backend/.env` and fill in the keys.
2. Start the API:

   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate            # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python prepare.py                   # pre-download the embedding model
   uvicorn app.main:app --reload --port 8000
   ```

3. Start the web app:

   ```bash
   cd frontend
   cp .env.example .env.local
   npm install
   npm run dev
   ```

Open http://localhost:3000.

## Testing

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

```bash
cd frontend
npm test
npm run typecheck
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat/stream` | Streamed answer as Server-Sent Events |
| `POST` | `/api/chat` | Same pipeline, single JSON response |
| `POST` | `/api/feedback` | Thumbs up or down on an answer |
| `GET` | `/api/stats` | Usage statistics |
| `GET` | `/api/logs` | Recent queries |
| `GET` | `/api/documents` | Knowledge base contents |
| `POST` | `/api/ingest` | Upload and index a document (admin key) |
| `DELETE` | `/api/documents/{doc_id}` | Remove a document (admin key) |
| `GET` | `/api/health` | Liveness and readiness probe |

## Configuration

All settings are environment variables, listed in [backend/.env.example](backend/.env.example). Only providers with a key set are used, so the app runs with any subset of Groq, OpenAI, Anthropic and Gemini. Retrieval needs `PINECONE_API_KEY`; web search needs `TAVILY_API_KEY`; the admin routes need `ADMIN_API_KEY`.

## Deployment

- Backend: Render web service from `render.yaml` (root directory `backend`).
- Frontend: Vercel project with root directory `frontend` and `NEXT_PUBLIC_API_URL` pointing at the Render URL.