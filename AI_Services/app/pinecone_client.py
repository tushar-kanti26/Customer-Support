from pinecone import Pinecone
from langchain_google_genai import GoogleGenerativeAIEmbeddings

from app.config import settings


_client: Pinecone | None = None
_embeddings: GoogleGenerativeAIEmbeddings | None = None


def build_company_namespace(company_id: int, company_name: str | None = None) -> str:
    if company_name:
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in company_name).strip("-")
        slug = "-".join(part for part in slug.split("-") if part)
        if slug:
            return slug[:120]
    return f"company-{company_id}"


def get_index():
    global _client
    if _client is None:
        _client = Pinecone(api_key=settings.pinecone_api_key)
    return _client.Index(settings.pinecone_index_name)


def get_embedding_model() -> GoogleGenerativeAIEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = GoogleGenerativeAIEmbeddings(
            model=settings.gemini_embedding_model,
            google_api_key=settings.gemini_api_key,
        )
    return _embeddings


def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    vector = model.embed_query(text, output_dimensionality=settings.gemini_embedding_dimension)
    if len(vector) != settings.gemini_embedding_dimension:
        raise ValueError(
            f"Embedding dimension mismatch: expected {settings.gemini_embedding_dimension}, got {len(vector)}"
        )
    return vector


def _chunk_text(text: str, chunk_size: int = 900, overlap: int = 120) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = max(0, end - overlap)
    return chunks


def upsert_policy_documents(namespace: str, documents: list[tuple[str, str, int | None]]) -> int:
    index = get_index()

    vectors: list[dict] = []
    for source, text, doc_id in documents:
        for i, chunk in enumerate(_chunk_text(text)):
            if not chunk.strip():
                continue
            vec = embed_text(chunk)
            vector_id = f"{source}-{i}"[:512]
            vectors.append(
                {
                    "id": vector_id,
                    "values": vec,
                    "metadata": {
                        "text": chunk,
                        "source": source,
                        "doc_id": doc_id,
                    },
                }
            )

    if not vectors:
        return 0

    index.upsert(vectors=vectors, namespace=namespace)
    return len(vectors)


def delete_policy_document(namespace: str, doc_id: int) -> None:
    index = get_index()
    # Delete all chunks for a given document by metadata filter.
    index.delete(namespace=namespace, filter={"doc_id": doc_id})


def retrieve_context(query: str, namespace: str | None = None) -> list[str]:
    try:
        index = get_index()
        query_vector = embed_text(query)

        response = index.query(
            namespace=namespace or settings.pinecone_namespace,
            vector=query_vector,
            top_k=settings.top_k_docs,
            include_metadata=True,
        )

        contexts: list[str] = []
        records = response.get("matches", []) if isinstance(response, dict) else getattr(response, "matches", [])
        for item in records:
            metadata = item.get("metadata", {}) if isinstance(item, dict) else getattr(item, "metadata", {})
            text = metadata.get("text")
            source = metadata.get("source", "policy")
            if text:
                contexts.append(f"[{source}] {text}")

        return contexts
    except Exception:
        # Retrieval failures should not block ticket creation.
        return []
