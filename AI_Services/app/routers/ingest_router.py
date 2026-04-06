from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_company, require_roles
from app.database import get_db
from app.models import Company, SupportUser
from app.schemas import PollResult, PollStatus
from app.services.email_processor import poll_inbox_once
from app.services.polling_status import get_poll_status


router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post("/poll", response_model=PollResult)
def poll_and_process(
    db: Session = Depends(get_db),
    user: SupportUser = Depends(require_roles("company_admin", "human_agent")),
    company: Company = Depends(get_current_company),
):
    processed, auto_resolved, escalated = poll_inbox_once(db, company=company)
    return PollResult(processed=processed, auto_resolved=auto_resolved, escalated=escalated)


@router.get("/status", response_model=PollStatus)
def poll_status():
    return PollStatus(**get_poll_status())
