from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    authenticate_human_agent_by_username,
    create_access_token,
    get_current_user,
    get_password_hash,
)
from app.database import get_db
from app.models import Company, SupportUser
from app.schemas import (
    HumanAgentRegisterRequest,
    HumanAgentSimpleLoginRequest,
    SupportAgentRead,
    TokenResponse,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register/human-agent", response_model=SupportAgentRead)
def register_human_agent(payload: HumanAgentRegisterRequest, db: Session = Depends(get_db)):
    normalized_username = payload.username.strip().lower()
    normalized_company_email = payload.company_email.strip().lower()
    if not normalized_username:
        raise HTTPException(status_code=400, detail="Username is required")

    company = (
        db.query(Company)
        .filter(
            or_(
                Company.customer_care_email == normalized_company_email,
                Company.admin_email == normalized_company_email,
            ),
            Company.is_active.is_(True),
        )
        .first()
    )

    if not company:
        raise HTTPException(
            status_code=404,
            detail="Company not found. Ask your company admin to register the company first.",
        )

    existing_username = (
        db.query(SupportUser)
        .filter(
            SupportUser.company_id == company.id,
            SupportUser.username == normalized_username,
        )
        .first()
    )
    if existing_username:
        raise HTTPException(status_code=409, detail="Username already taken in this company")

    synthetic_email = f"{normalized_username}.company{company.id}@agents.resolvex.app"
    agent = SupportUser(
        company_id=company.id,
        email=synthetic_email,
        username=normalized_username,
        role="human_agent",
        hashed_password=get_password_hash(payload.password),
        is_active=True,
    )
    db.add(agent)
    try:
        db.commit()
        db.refresh(agent)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Agent registration conflicts with existing account")
    return agent


@router.post("/login/human", response_model=TokenResponse)
def login_human(payload: HumanAgentSimpleLoginRequest, db: Session = Depends(get_db)):
    normalized_username = payload.username.strip().lower()
    if not normalized_username:
        raise HTTPException(status_code=400, detail="Username is required")

    normalized_company_email = (payload.company_email or "").strip().lower() or None

    candidate_query = (
        db.query(SupportUser)
        .join(Company, Company.id == SupportUser.company_id)
        .filter(
            SupportUser.username == normalized_username,
            SupportUser.role == "human_agent",
            SupportUser.is_active.is_(True),
            Company.is_active.is_(True),
        )
    )

    if normalized_company_email:
        candidate_query = candidate_query.filter(
            or_(
                Company.customer_care_email == normalized_company_email,
                Company.admin_email == normalized_company_email,
            )
        )

    candidate_users = candidate_query.all()
    if not candidate_users:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found. Register human agent first.",
        )

    if len(candidate_users) > 1 and not normalized_company_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Multiple accounts found for this username. Please provide your company email.",
        )

    user = authenticate_human_agent_by_username(
        db,
        username=payload.username,
        password=payload.password,
        company_email=normalized_company_email,
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")

    token = create_access_token(subject=user.username, user_id=user.id, company_id=user.company_id, role=user.role)
    return TokenResponse(access_token=token, role=user.role, company_id=user.company_id)


@router.get("/me", response_model=SupportAgentRead)
def me(current_user: SupportUser = Depends(get_current_user)):
    return current_user
