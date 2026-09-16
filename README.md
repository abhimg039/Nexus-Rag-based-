# Nexus RAG Document Intelligence

A privacy-first **local RAG application** that lets you ask questions about your PDF documents and get grounded answers with source citations.

Everything runs locally using **Ollama, PostgreSQL, pgvector, and BGE embeddings**.

## Features

- PDF upload and document indexing
- Sentence-aware text chunking
- Semantic vector search
- Hybrid retrieval with keyword boosting
- Local Llama 3.2 LLM via Ollama
- BGE embeddings using `BAAI/bge-small-en-v1.5`
- PostgreSQL + pgvector storage
- Source citations for retrieved passages
- Streaming AI responses using SSE
- Per-document conversation history
- Duplicate document detection
- Local-first and privacy-focused

## Architecture

```text
PDF
 ↓
PyMuPDF
 ↓
Sentence-Aware Chunking
 ↓
BGE Embeddings
 ↓
PostgreSQL + pgvector
 ↓
Hybrid Retrieval
 ↓
Ollama + Llama 3.2
 ↓
Grounded Answer + Sources
```

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | FastAPI + Python |
| Database | PostgreSQL + pgvector |
| Embeddings | BAAI/bge-small-en-v1.5 |
| LLM | Llama 3.2 3B |
| Local AI | Ollama |
| PDF Processing | PyMuPDF |

## Requirements

- Python 3.10+
- PostgreSQL 14+
- pgvector
- Node.js 20+
- Ollama

Pull the required model:

```bash
ollama pull llama3.2:3b
```

## Setup

### 1. Clone

```bash
git clone <YOUR_REPOSITORY_URL>
cd nexus-rag-document-intelligent
```

### 2. Database

```bash
createdb nexus_rag
```

Install pgvector on macOS:

```bash
brew install pgvector
```

### 3. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Configure your `.env`:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/nexus_rag
```

Initialize the database:

```bash
python -m app.db.init_db
```

### 4. Frontend

```bash
cd ../frontend
npm install
```

## Run

Start Ollama:

```bash
ollama serve
```

Start the backend:

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

Start the frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:5173
```

API documentation:

```text
http://localhost:8000/docs
```

## Project Structure

```text
nexus-rag-document-intelligent/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── db/
│   │   ├── models/
│   │   ├── rag/
│   │   └── document_processing/
│   ├── tests/
│   └── uploads/
│
├── frontend/
│   ├── src/
│   └── tests/
│
├── .env.example
└── README.md
```

## Testing

Backend:

```bash
cd backend
python -m tests.test_chunker
```

Frontend:

```bash
cd frontend
npm test
npm run lint
npm run build
```

## Limitations

- Currently supports PDF documents.
- Scanned/image-only PDFs require OCR before uploading.
- AI processing depends on your local hardware.

## License

MIT License
