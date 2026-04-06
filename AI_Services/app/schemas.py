from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr


class CompanyAdminRegisterRequest(BaseModel):
    company_name: str
    admin_email: EmailStr
    admin_username: str
    admin_password: str
    customer_care_email: EmailStr
    customer_care_app_password: str
    imap_host: str = "imap.gmail.com"
    imap_port: int = 993
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_use_tls: bool = True


class CompanyAdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class CompanyProfileResponse(BaseModel):
    id: int
    name: str
    admin_email: EmailStr
    customer_care_email: EmailStr
    total_agents: int
    total_documents: int
    is_active: bool

    class Config:
        from_attributes = True


class DocumentUploadResponse(BaseModel):
    id: int
    file_name: str

    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    id: int
    file_name: str
    created_at: datetime

    class Config:
        from_attributes = True


class CompanyLoginRequest(BaseModel):
    company_email: EmailStr
    app_password: str


class HumanAgentSimpleLoginRequest(BaseModel):
    username: str
    password: str
    company_email: EmailStr | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    company_id: int


class CompanyRegistrationResponse(BaseModel):
    company_id: int
    username: str
    password: str


class HumanAgentRegisterRequest(BaseModel):
    username: str
    company_email: EmailStr
    password: str


class SupportAgentRead(BaseModel):
    id: int
    company_id: int
    email: str
    username: str
    role: str

    class Config:
        from_attributes = True


class TicketRead(BaseModel):
    id: int
    company_id: int
    sender_email: str
    subject: str
    body: str
    reason: str
    status: str
    assigned_to: str | None
    resolution_note: str | None
    reply_sent_by: str | None
    replied_at: datetime | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TicketUpdate(BaseModel):
    status: Literal["open", "in_progress", "resolved"]
    resolution_note: str | None = None


class PollResult(BaseModel):
    processed: int
    auto_resolved: int
    escalated: int


class PollStatus(BaseModel):
    last_run_at: str | None
    last_processed: int
    last_auto_resolved: int
    last_escalated: int
    last_error: str | None
    total_runs: int
