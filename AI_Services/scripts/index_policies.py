import argparse
from pathlib import Path

from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone

from app.config import settings


def chunk_text(text: str, chunk_size: int = 900, overlap: int = 120) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = max(0, end - overlap)
    return chunks


def load_documents(path: Path) -> list[tuple[str, str]]:
    docs: list[tuple[str, str]] = []
    for file in path.rglob("*.txt"):
        docs.append((file.name, file.read_text(encoding="utf-8", errors="ignore")))
    for file in path.rglob("*.md"):
        docs.append((file.name, file.read_text(encoding="utf-8", errors="ignore")))
    return docs


def main() -> None:
    parser = argparse.ArgumentParser(description="Index company policies to Pinecone")
    parser.add_argument("--docs", default="./data", help="Path to policy documents")
    parser.add_argument("--namespace", default=settings.pinecone_namespace, help="Pinecone namespace")
    args = parser.parse_args()

    docs_path = Path(args.docs)
    if not docs_path.exists():
        raise FileNotFoundError(f"Documents folder not found: {docs_path}")

    pc = Pinecone(api_key=settings.pinecone_api_key)
    index = pc.Index(settings.pinecone_index_name)
    embedding_model = GoogleGenerativeAIEmbeddings(
        model=settings.gemini_embedding_model,
        google_api_key=settings.gemini_api_key,
    )

    vectors = []
    for source, text in load_documents(docs_path):
        for i, chunk in enumerate(chunk_text(text)):
            vec = embedding_model.embed_query(
                chunk,
                output_dimensionality=settings.gemini_embedding_dimension,
            )
            vectors.append(
                {
                    "id": f"{source}-{i}",
                    "values": vec,
                    "metadata": {"text": chunk, "source": source},
                }
            )

    if not vectors:
        print("No .txt or .md documents found to index.")
        return

    index.upsert(vectors=vectors, namespace=args.namespace)
    print(f"Indexed {len(vectors)} chunks to Pinecone namespace '{args.namespace}'.")


if __name__ == "__main__":
    main()
