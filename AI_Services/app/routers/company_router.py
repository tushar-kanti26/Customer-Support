from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    authenticate_company_admin,
    create_access_token,
    get_current_company,
    get_current_user,
    get_password_hash,
    require_roles,
)
from app.database import get_db
from app.models import Company, CompanyDocument, SupportUser
from app.pinecone_client import build_company_namespace
from app.schemas import (
    CompanyAdminLoginRequest,
    CompanyAdminRegisterRequest,
    CompanyProfileResponse,
    TokenResponse,
)

router = APIRouter(prefix="/api/company", tags=["company"])


@router.post("/register", response_model=dict)
def register_company(req: CompanyAdminRegisterRequest, db: Session = Depends(get_db)):
    """Register a new company with admin user."""
    # Check if admin email already exists
    existing_company = db.query(Company).filter(Company.admin_email == req.admin_email).first()
    if existing_company:
        raise HTTPException(status_code=409, detail="Company email already registered")

    # Check if company name already exists
    existing_name = db.query(Company).filter(Company.name == req.company_name).first()
    if existing_name:
        raise HTTPException(status_code=409, detail="Company name already in use")

    # Some deployments have a legacy global unique constraint on username.
    existing_username = db.query(SupportUser).filter(SupportUser.username == req.admin_username).first()
    if existing_username:
        raise HTTPException(status_code=409, detail="Admin username already in use")

    # Create company
    company = Company(
        name=req.company_name,
        admin_email=req.admin_email,
        customer_care_email=req.customer_care_email,
        customer_care_app_password=req.customer_care_app_password,
        imap_host=req.imap_host,
        imap_port=req.imap_port,
        smtp_host=req.smtp_host,
        smtp_port=req.smtp_port,
        smtp_use_tls=req.smtp_use_tls,
        pinecone_namespace="pending",
        is_active=True,
    )
    db.add(company)
    db.flush()
    company.pinecone_namespace = build_company_namespace(company.id, company.name)

    # Create admin user
    admin = SupportUser(
        company_id=company.id,
        email=req.admin_email,
        username=req.admin_username,
        hashed_password=get_password_hash(req.admin_password),
        role="company_admin",
        is_active=True,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()

        message = str(exc.orig)
        if "support_users_username_key" in message or "uq_support_users_company_username" in message:
            raise HTTPException(status_code=409, detail="Admin username already in use")
        if "companies_admin_email_key" in message:
            raise HTTPException(status_code=409, detail="Company email already registered")
        if "companies_name_key" in message:
            raise HTTPException(status_code=409, detail="Company name already in use")
        raise HTTPException(status_code=409, detail="Duplicate data violates a uniqueness rule")

    return {"message": "Company registered successfully", "company_id": company.id, "admin_id": admin.id}


@router.post("/login", response_model=TokenResponse)
def company_login(req: CompanyAdminLoginRequest, db: Session = Depends(get_db)):
    """Login company admin and return JWT token."""
    company = db.query(Company).filter(Company.admin_email == req.email).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    admin = authenticate_company_admin(db, req.email, req.password)
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(
        subject=admin.email, user_id=admin.id, company_id=company.id, role="company_admin"
    )
    return TokenResponse(access_token=token, role="company_admin", company_id=company.id)


@router.get("/profile", response_model=CompanyProfileResponse)
def get_company_profile(
    user: SupportUser = Depends(require_roles("company_admin")),
    company: Company = Depends(get_current_company),
    db: Session = Depends(get_db),
):
    """Get company profile with agent and document counts."""
    agent_count = db.query(func.count(SupportUser.id)).filter(SupportUser.company_id == company.id).scalar()
    doc_count = (
        db.query(func.count(CompanyDocument.id)).filter(CompanyDocument.company_id == company.id).scalar()
    )

    return CompanyProfileResponse(
        id=company.id,
        name=company.name,
        admin_email=company.admin_email,
        customer_care_email=company.customer_care_email,
        total_agents=agent_count or 0,
        total_documents=doc_count or 0,
        is_active=company.is_active,
    )


@router.get("/agents")
def list_company_agents(
    user: SupportUser = Depends(require_roles("company_admin")),
    company: Company = Depends(get_current_company),
    db: Session = Depends(get_db),
):
    """List all support agents for the company."""
    agents = (
        db.query(SupportUser)
        .filter(SupportUser.company_id == company.id, SupportUser.role == "human_agent")
        .all()
    )
    return [{"id": a.id, "username": a.username, "email": a.email, "is_active": a.is_active} for a in agents]


@router.post("/settings")
def update_company_settings(
    updates: dict,
    user: SupportUser = Depends(require_roles("company_admin")),
    company: Company = Depends(get_current_company),
    db: Session = Depends(get_db),
):
    """Update company email settings (customer care email, imap config, etc)."""
    allowed_fields = {
        "customer_care_email",
        "customer_care_app_password",
        "imap_host",
        "imap_port",
        "smtp_host",
        "smtp_port",
        "smtp_use_tls",
    }

    for key, value in updates.items():
        if key not in allowed_fields:
            raise HTTPException(status_code=400, detail=f"Cannot update field: {key}")
        setattr(company, key, value)

    db.commit()
    return {"message": "Settings updated successfully"}
