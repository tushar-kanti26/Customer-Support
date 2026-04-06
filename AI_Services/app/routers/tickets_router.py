from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_company, get_current_user, require_roles
from app.database import get_db
from app.email_client import send_email_reply
from app.models import Company, SupportUser, UnresolvedTicket
from app.schemas import TicketRead, TicketUpdate


router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("", response_model=list[TicketRead])
def list_tickets(
    status: str | None = None,
    db: Session = Depends(get_db),
    user: SupportUser = Depends(get_current_user),
):
    query = db.query(UnresolvedTicket).filter(UnresolvedTicket.company_id == user.company_id)
    if status and status != "all":
        query = query.filter(UnresolvedTicket.status == status)
    elif not status:
        query = query.filter(UnresolvedTicket.status != "resolved")
    return query.order_by(UnresolvedTicket.created_at.desc()).all()


@router.patch("/{ticket_id}", response_model=TicketRead)
def update_ticket(
    ticket_id: int,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    user: SupportUser = Depends(require_roles("human_agent", "company_admin")),
    company: Company = Depends(get_current_company),
):
    ticket = (
        db.query(UnresolvedTicket)
        .filter(UnresolvedTicket.id == ticket_id, UnresolvedTicket.company_id == user.company_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if payload.status == "resolved" and not (payload.resolution_note or "").strip():
        raise HTTPException(status_code=400, detail="Resolution note is required to send reply to customer")

    if payload.status == "resolved" and ticket.reply_sent_by and ticket.reply_sent_by != "human":
        raise HTTPException(status_code=409, detail="Ticket already replied by automation")

    ticket.status = payload.status
    ticket.assigned_to = user.email
    ticket.resolution_note = payload.resolution_note

    if payload.status == "resolved":
        if ticket.reply_sent_by == "human":
            raise HTTPException(status_code=409, detail="Customer already received a human reply for this ticket")
        try:
            send_email_reply(
                to_email=ticket.sender_email,
                subject=f"Re: {ticket.subject}",
                body=(
                    "Hello,\n\n"
                    f"{ticket.resolution_note}\n\n"
                    "If you need any further help, please reply to this email.\n\n"
                    "Regards,\nResolveX Team"
                ),
                from_email=company.customer_care_email,
                email_password=company.customer_care_app_password,
                smtp_host=company.smtp_host,
                smtp_port=company.smtp_port,
                smtp_use_tls=company.smtp_use_tls,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to send customer reply: {exc.__class__.__name__}")
        ticket.reply_sent_by = "human"
        ticket.replied_at = datetime.utcnow()

    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    return ticket
