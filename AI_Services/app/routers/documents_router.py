from io import BytesIO
from pathlib import Path

from PyPDF2 import PdfReader
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth import get_current_company, get_current_user, require_roles
from database import get_db
from models import Company, CompanyDocument, SupportUser
from pinecone_client import build_company_namespace, delete_policy_document, upsert_policy_documents
from schemas import DocumentListResponse, DocumentUploadResponse

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _extract_text_from_upload(file_name: str, content: bytes) -> str:
    suffix = Path(file_name).suffix.lower()

    if suffix in {".txt", ".md", ".csv", ".log"}:
        return content.decode("utf-8", errors="ignore")

    if suffix == ".pdf":
        reader = PdfReader(BytesIO(content))
        pages: list[str] = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return "\n".join(pages)

    raise HTTPException(
        status_code=400,
        detail="Unsupported document format. Please upload .txt, .md, .csv, .log, or .pdf files.",
    )


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: SupportUser = Depends(require_roles("company_admin")),
    company: Company = Depends(get_current_company),
):
    """Upload and store a company policy document."""
    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    # Read file content
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    # Extract readable text from supported file types.
    try:
        file_content = _extract_text_from_upload(file.filename, content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {str(e)}")

    # PostgreSQL text fields cannot store NUL bytes.
    sanitized_content = file_content.replace("\x00", "")
    if not sanitized_content.strip():
        raise HTTPException(
            status_code=400,
            detail="Uploaded file has no readable text content. Please upload a text-based document.",
        )

    # Save to database
    doc = CompanyDocument(
        company_id=company.id,
        file_name=file.filename,
        uploaded_by_user_id=user.id,
        file_content=sanitized_content,
    )
    db.add(doc)

    try:
        db.flush()

        namespace = company.pinecone_namespace or build_company_namespace(company.id, company.name)
        source = f"doc-{doc.id}-{file.filename}"
        upserted = upsert_policy_documents(
            namespace=namespace,
            documents=[(source, sanitized_content, doc.id)],
        )
        if upserted == 0:
            raise HTTPException(status_code=400, detail="Document has no embeddable content")

        db.commit()
        db.refresh(doc)
    except HTTPException:
        db.rollback()
        raise
    except (SQLAlchemyError, ValueError):
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save document")
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=f"Failed to index document in Pinecone: {exc}")

    return DocumentUploadResponse(id=doc.id, file_name=doc.file_name)


@router.get("/list", response_model=list[DocumentListResponse])
def list_documents(
    db: Session = Depends(get_db),
    user: SupportUser = Depends(require_roles("company_admin", "human_agent")),
    company: Company = Depends(get_current_company),
):
    """List all documents for the company."""
    docs = (
        db.query(CompanyDocument).filter(CompanyDocument.company_id == company.id).order_by(CompanyDocument.created_at.desc()).all()
    )
    return [
        DocumentListResponse(
            id=d.id,
            file_name=d.file_name,
            created_at=d.created_at,
        )
        for d in docs
    ]


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    user: SupportUser = Depends(require_roles("company_admin")),
    company: Company = Depends(get_current_company),
):
    """Delete a document."""
    doc = db.query(CompanyDocument).filter(
        CompanyDocument.id == doc_id, CompanyDocument.company_id == company.id
    ).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    namespace = company.pinecone_namespace or build_company_namespace(company.id, company.name)

    try:
        delete_policy_document(namespace=namespace, doc_id=doc.id)
    except Exception:
        # Keep DB delete non-blocking even if vector cleanup fails.
        pass

    db.delete(doc)
    db.commit()
    return {"message": "Document deleted successfully"}


@router.get("/{doc_id}/content")
def get_document_content(
    doc_id: int,
    db: Session = Depends(get_db),
    user: SupportUser = Depends(require_roles("company_admin", "human_agent")),
    company: Company = Depends(get_current_company),
):
    """Get the content of a document."""
    doc = db.query(CompanyDocument).filter(
        CompanyDocument.id == doc_id, CompanyDocument.company_id == company.id
    ).first()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return {"id": doc.id, "file_name": doc.file_name, "content": doc.file_content}

