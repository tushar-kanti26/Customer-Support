from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Company, SupportUser


# Prefer pbkdf2 for local stability; keep bcrypt verification for backward compatibility.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login/human")


class TokenPayloadError(Exception):
    pass


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str, user_id: int, company_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "uid": user_id, "cid": company_id, "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def authenticate_human_agent_by_username(
    db: Session,
    username: str,
    password: str,
    company_email: str | None = None,
) -> SupportUser | None:
    normalized_username = username.strip().lower()
    query = (
        db.query(SupportUser)
        .join(Company, Company.id == SupportUser.company_id)
        .filter(
            SupportUser.username == normalized_username,
            SupportUser.role == "human_agent",
            SupportUser.is_active.is_(True),
            Company.is_active.is_(True),
        )
    )

    if company_email:
        normalized_company_email = company_email.strip().lower()
        query = query.filter(
            or_(
                Company.customer_care_email == normalized_company_email,
                Company.admin_email == normalized_company_email,
            )
        )

    user = query.first()
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def authenticate_company_admin(db: Session, admin_email: str, password: str) -> SupportUser | None:
    """Authenticate a company admin by email and password."""
    user = (
        db.query(SupportUser)
        .join(Company, Company.id == SupportUser.company_id)
        .filter(
            SupportUser.email == admin_email,
            SupportUser.role == "company_admin",
            SupportUser.is_active.is_(True),
            Company.is_active.is_(True),
        )
        .first()
    )
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> SupportUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = payload.get("uid")
        if user_id is None:
            raise TokenPayloadError()
    except (JWTError, TokenPayloadError):
        raise credentials_exception

    user = db.query(SupportUser).filter(SupportUser.id == user_id, SupportUser.is_active.is_(True)).first()
    if user is None:
        raise credentials_exception
    company = db.query(Company).filter(Company.id == user.company_id, Company.is_active.is_(True)).first()
    if company is None:
        raise credentials_exception
    return user


def get_current_company(user: SupportUser = Depends(get_current_user), db: Session = Depends(get_db)) -> Company:
    company = db.query(Company).filter(Company.id == user.company_id, Company.is_active.is_(True)).first()
    if company is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Company is not active")
    return company


def require_roles(*roles: str):
    role_set = set(roles)

    def _role_guard(user: SupportUser = Depends(get_current_user)) -> SupportUser:
        if role_set and user.role not in role_set:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")
        return user

    return _role_guard
