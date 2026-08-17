from fastapi import FastAPI

app = FastAPI(
    title="AI Document Intelligence & RAG Platform",
    version="1.0.0"
)


@app.get("/")
def root():
    return {
        "message": "AI Document Intelligence API is running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }