# Nexus RAG

Ask questions about your own PDFs and get answers with citations, running entirely on
your own machine. Nothing is sent to a hosted model — extraction, embedding, retrieval
and generation all happen locally.

```
PDF ─► PyMuPDF ─► sentence-aware chunks ─► BGE embeddings ─► Postgres + pgvector
                                                                     │
                            answer ◄── Ollama (Llama 3.2) ◄── hybrid retrieval
```

## What it does

Upload a PDF and it is split into overlapping, sentence-aligned passages, embedded with
`BAAI/bge-small-en-v1.5`, and stored as 384-dimension vectors in Postgres. When you ask
a question, the query is embedded, the closest passages are retrieved by cosine distance,
re-ranked with a keyword-coverage boost, and handed to a local Llama 3.2 model as
grounding context. The answer streams back token by token, and every source passage is
shown in full so you can check the model against the document.

Uploaded documents stay in a sidebar library, so you can switch between them without
re-uploading, and each one keeps its own conversation thread.

## Requirements

- Python 3.10 or newer
- PostgreSQL 14+ with the [pgvector](https://github.com/pgvector/pgvector) extension available
- [Ollama](https://ollama.com) running locally, with a model pulled: `ollama pull llama3.2:3b`
- Node.js 20 or newer

## Setup

**1. Create the database**

```bash
createdb nexus_rag
```

**2. Configure the environment**

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your own credentials. Every other setting has a
working default — see `.env.example` for what each one does. `.env` is gitignored.

**3. Install the backend**

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**4. Create the tables and indexes**

```bash
python -m app.db.init_db
```

This enables the pgvector extension, creates the tables, adds the vector index (HNSW
where pgvector supports it, otherwise IVFFlat), and is safe to re-run at any time — it
also backfills columns and repairs passage numbering on an existing database.

**5. Install the frontend**

```bash
cd ../frontend
npm install
```

## Running

Three processes, in three terminals:

```bash
ollama serve                                        # if not already running
cd backend && source venv/bin/activate && uvicorn app.main:app --reload
cd frontend && npm run dev
```

Then open http://localhost:5173. The Vite dev server proxies `/api` and `/health` to the
backend on port 8000, so there is no API URL to configure and no CORS to worry about
during development. Interactive API docs are at http://localhost:8000/docs.

If the backend runs somewhere other than port 8000, copy `frontend/.env.example` to
`frontend/.env` and set `VITE_BACKEND_ORIGIN`. Nothing else in the frontend needs
configuring.

The status pill at the bottom of the sidebar reports whether the database and Ollama are
actually reachable — click it to re-check, which also refetches the document list.

## Project layout

```
backend/
  app/
    api/                 HTTP routes: documents, questions, health, session
    core/                settings (env-driven) and time helpers
    db/                  engine, session factory, init_db
    document_processing/ PDF extraction, chunking, safe file storage
    models/              SQLAlchemy models
    rag/                 embeddings, vector search, LLM client, orchestration
    schemas/             Pydantic request/response models
  tests/                 dependency-free chunker tests
  uploads/               stored PDFs (gitignored)
frontend/
  src/
    components/          presentational UI, plus the top-level error boundary
    hooks/               session, documents and chat state
    lib/                 API client, formatting, localStorage threads
    styles/              design tokens (index.css) and components (app.css)
  tests/                 storage and SSE-parser suites, run with plain node
  verify_static.py       static check for the JSX that node cannot parse
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health`, `/health/db`, `/health/full` | liveness, database, and Ollama checks |
| `GET` | `/api/session` | resolve the current user |
| `GET` | `/api/documents` | list documents |
| `POST` | `/api/documents/upload` | upload and index a PDF |
| `DELETE` | `/api/documents/{id}` | delete a document, its passages and its file |
| `POST` | `/api/questions` | ask a question, single JSON response |
| `POST` | `/api/questions/stream` | ask a question, streamed over SSE |

## Tests

```bash
cd backend  && python -m tests.test_chunker   # chunker invariants + 2000 fuzz cases
cd frontend && npm test                       # storage + SSE parser + static checks
cd frontend && npm run lint && npm run build  # oxlint, then a real production build
```

`npm test` needs nothing but node — no `node_modules`, no test framework, no browser:

| Suite | What it covers |
| --- | --- |
| `tests/storage.test.mjs` | Per-document thread persistence: round-trips, the 100-message trim, corrupt/wrong-shape values, quota failures, pruning, and the invariant that `saveThread` itself refuses to store a message still flagged `streaming`. |
| `tests/stream.test.mjs` | The server-sent-event parser, driven by a fake `fetch`: frames split across chunks, CRLF endings, multi-byte characters straddling a chunk boundary, malformed JSON, error frames, a stream that ends without a `done` frame, and an abort surfacing as an `AbortError` rather than a stream failure. |
| `verify_static.py` | Every import resolves and matches the target's exports, every `className` has a CSS rule, every `var(--token)` is declared, every `<Icon name>` exists, and brackets, quotes and JSX tags all balance. |

The two `.mjs` suites execute the real modules, so they catch behaviour a static pass
cannot. `verify_static.py` covers the JSX that node cannot parse. Both are checked against
deliberately broken copies of the code they test, so they fail when they should rather
than passing vacuously.

## Notes on performance

Passages are embedded in batches rather than one call per chunk, which is the difference
between a slow ingest and a quick one on a large PDF. Query embeddings are memoised, so
repeating a question skips the encoder entirely. Ollama is asked to keep the model
resident (`LLM_KEEP_ALIVE`), which avoids a multi-second cold start on every question.
Uploads are deduplicated by content hash, so re-uploading the same file returns
immediately instead of re-indexing it. Retrieval never selects the embedding column, so
Postgres is not shipping 384 floats per row back to Python just to rank them.

## Troubleshooting

**"Local model unavailable"** — Ollama is not running or the model is not pulled. Check
`ollama list`, then `ollama pull llama3.2:3b`.

**`extension "vector" is not available`** — pgvector is not installed for your Postgres
server. On macOS with Homebrew: `brew install pgvector`, then re-run
`python -m app.db.init_db`.

**Uploads fail with a 422** — the PDF is likely scanned images with no extractable text
layer. This project does not OCR; run the file through an OCR tool first.

**The first question after startup is slow** — the embedding model is loading. Set
`WARM_UP_EMBEDDING_MODEL=true` (the default) so it loads during startup instead.
