import threading
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from config import settings
from database import Base, SessionLocal, engine, get_db
from email_client import close_imap_sessions
from models import Company
from pinecone_client import build_company_namespace
from routers.auth_router import router as auth_router
from routers.ingest_router import router as ingest_router
from routers.tickets_router import router as tickets_router
from routers.company_router import router as company_router
from routers.documents_router import router as documents_router
from services.email_processor import poll_inbox_once


app = FastAPI(title=settings.app_name)
_stop_event = threading.Event()
_poll_thread: threading.Thread | None = None


def _ensure_legacy_schema_compatibility() -> None:
    """Upgrade older single-tenant tables to the current multi-tenant shape."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    if not {"companies", "support_users", "unresolved_tickets"}.issubset(tables):
        return

    with engine.begin() as conn:
        support_cols = {col["name"] for col in inspector.get_columns("support_users")}
        ticket_cols = {col["name"] for col in inspector.get_columns("unresolved_tickets")}
        company_cols = {col["name"] for col in inspector.get_columns("companies")}
        doc_cols = {col["name"] for col in inspector.get_columns("company_documents")} if "company_documents" in tables else set()

        if "email" not in support_cols:
            conn.execute(text("ALTER TABLE support_users ADD COLUMN email VARCHAR(255)"))
        if "role" not in support_cols:
            conn.execute(text("ALTER TABLE support_users ADD COLUMN role VARCHAR(32)"))
        if "company_id" not in support_cols:
            conn.execute(text("ALTER TABLE support_users ADD COLUMN company_id INTEGER"))
        if "username" not in support_cols:
            conn.execute(text("ALTER TABLE support_users ADD COLUMN username VARCHAR(128)"))

        if "company_id" not in ticket_cols:
            conn.execute(text("ALTER TABLE unresolved_tickets ADD COLUMN company_id INTEGER"))
        if "source_message_id" not in ticket_cols:
            conn.execute(text("ALTER TABLE unresolved_tickets ADD COLUMN source_message_id VARCHAR(255)"))
        if "reply_sent_by" not in ticket_cols:
            conn.execute(text("ALTER TABLE unresolved_tickets ADD COLUMN reply_sent_by VARCHAR(32)"))
        if "replied_at" not in ticket_cols:
            conn.execute(text("ALTER TABLE unresolved_tickets ADD COLUMN replied_at TIMESTAMP"))

        if "details" not in company_cols:
            conn.execute(text("ALTER TABLE companies ADD COLUMN details TEXT"))
        if "policy_notes" not in company_cols:
            conn.execute(text("ALTER TABLE companies ADD COLUMN policy_notes TEXT"))

        # Add file_content column to company_documents if it exists
        if "company_documents" in tables and "file_content" not in doc_cols:
            conn.execute(text("ALTER TABLE company_documents ADD COLUMN file_content TEXT"))

        bootstrap_company_id = conn.execute(text("SELECT id FROM companies ORDER BY id LIMIT 1")).scalar()
        if bootstrap_company_id is None:
            bootstrap_company_id = conn.execute(
                text(
                    """
                    INSERT INTO companies (
                        name, admin_email, customer_care_email, customer_care_app_password,
                        imap_host, imap_port, smtp_host, smtp_port, smtp_use_tls,
                        pinecone_namespace, is_active, created_at, updated_at
                    ) VALUES (
                        :name, :admin_email, :customer_care_email, :customer_care_app_password,
                        :imap_host, :imap_port, :smtp_host, :smtp_port, :smtp_use_tls,
                        :pinecone_namespace, :is_active, NOW(), NOW()
                    ) RETURNING id
                    """
                ),
                {
                    "name": "Bootstrap Company",
                    "admin_email": "bootstrap-admin@local",
                    "customer_care_email": "bootstrap-support@local",
                    "customer_care_app_password": "bootstrap",
                    "imap_host": "imap.gmail.com",
                    "imap_port": 993,
                    "smtp_host": "smtp.gmail.com",
                    "smtp_port": 587,
                    "smtp_use_tls": True,
                    "pinecone_namespace": "company-bootstrap",
                    "is_active": True,
                },
            ).scalar()

        conn.execute(text("UPDATE support_users SET email = username WHERE email IS NULL AND username IS NOT NULL"))
        conn.execute(text("UPDATE support_users SET username = email WHERE username IS NULL AND email IS NOT NULL"))
        conn.execute(text("UPDATE support_users SET email = CONCAT('user-', id, '@local') WHERE email IS NULL"))
        conn.execute(text("UPDATE support_users SET username = email WHERE username IS NULL"))
        conn.execute(text("UPDATE support_users SET role = 'human_agent' WHERE role IS NULL"))
        conn.execute(
            text("UPDATE support_users SET company_id = :company_id WHERE company_id IS NULL"),
            {"company_id": bootstrap_company_id},
        )
        conn.execute(
            text("UPDATE unresolved_tickets SET company_id = :company_id WHERE company_id IS NULL"),
            {"company_id": bootstrap_company_id},
        )

        conn.execute(text("ALTER TABLE support_users ALTER COLUMN email SET NOT NULL"))
        conn.execute(text("ALTER TABLE support_users ALTER COLUMN username SET NOT NULL"))
        conn.execute(text("ALTER TABLE support_users ALTER COLUMN role SET NOT NULL"))
        conn.execute(text("ALTER TABLE support_users ALTER COLUMN company_id SET NOT NULL"))
        conn.execute(text("ALTER TABLE unresolved_tickets ALTER COLUMN company_id SET NOT NULL"))

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_support_users_company_id ON support_users(company_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_support_users_email ON support_users(email)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_support_users_username ON support_users(username)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_support_users_role ON support_users(role)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_unresolved_tickets_company_id ON unresolved_tickets(company_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_unresolved_tickets_source_message_id ON unresolved_tickets(source_message_id)"))

        conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'uq_unresolved_tickets_company_message'
                    ) THEN
                        ALTER TABLE unresolved_tickets
                        ADD CONSTRAINT uq_unresolved_tickets_company_message UNIQUE (company_id, source_message_id);
                    END IF;
                END
                $$;
                """
            )
        )

        conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'uq_support_users_company_email'
                    ) THEN
                        ALTER TABLE support_users
                        ADD CONSTRAINT uq_support_users_company_email UNIQUE (company_id, email);
                    END IF;
                END
                $$;
                """
            )
        )

        conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'uq_support_users_company_username'
                    ) THEN
                        ALTER TABLE support_users
                        ADD CONSTRAINT uq_support_users_company_username UNIQUE (company_id, username);
                    END IF;
                END
                $$;
                """
            )
        )

    # Ensure each company has a deterministic, unique Pinecone namespace.
    db = SessionLocal()
    try:
        companies = db.query(Company).all()
        changed = False
        for company in companies:
            expected_namespace = build_company_namespace(company.id, company.name)
            if company.pinecone_namespace != expected_namespace:
                company.pinecone_namespace = expected_namespace
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()


def _auto_poll_worker() -> None:
    while not _stop_event.is_set():
        db = next(get_db())
        try:
            companies = db.query(Company).filter(Company.is_active.is_(True)).all()
            for company in companies:
                poll_inbox_once(db, company=company, max_count=settings.poll_max_count)
        finally:
            db.close()
        _stop_event.wait(settings.auto_poll_interval_seconds)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_legacy_schema_compatibility()
    print("Database is ready.")

    global _poll_thread
    if settings.auto_poll_enabled and _poll_thread is None:
        _stop_event.clear()
        _poll_thread = threading.Thread(target=_auto_poll_worker, daemon=True)
        _poll_thread.start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    _stop_event.set()
    close_imap_sessions()


app.include_router(auth_router)
app.include_router(ingest_router)
app.include_router(tickets_router)
app.include_router(company_router)
app.include_router(documents_router)

static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
def root():
    return FileResponse(static_dir / "index.html")


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}

