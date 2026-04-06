from datetime import datetime
import hashlib

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from agent.graph import agent_graph
from email_client import fetch_unseen_emails
from email_client import mark_email_seen
from email_client import send_email_reply
from models import Company, UnresolvedTicket
from services.polling_status import record_poll_error, record_poll_result


def _clip(value: str, max_len: int) -> str:
    text = (value or "").replace("\x00", "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."


def _new_ticket(
    company_id: int,
    source_message_id: str,
    sender_email: str,
    subject: str,
    body: str,
    reason: str,
    status: str,
    reply_sent_by: str | None = None,
    resolution_note: str | None = None,
    replied_at: datetime | None = None,
) -> UnresolvedTicket:
    return UnresolvedTicket(
        company_id=company_id,
        source_message_id=_clip(source_message_id, 255),
        sender_email=_clip(sender_email, 255),
        subject=_clip(subject, 255),
        body=(body or "").replace("\x00", ""),
        reason=_clip(reason or "Needs human support", 255),
        status=status,
        reply_sent_by=reply_sent_by,
        resolution_note=(resolution_note or "").replace("\x00", "") if resolution_note is not None else None,
        replied_at=replied_at,
    )


def _build_message_key(email_data: dict[str, str]) -> str:
    candidate = (email_data.get("dedupe_key") or email_data.get("message_id") or "").strip()
    if candidate:
        return candidate
    raw = f"{email_data.get('from', '').strip()}|{email_data.get('subject', '').strip()}|{email_data.get('body', '').strip()}"
    digest = hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()
    return f"content-hash:{digest}"


def _existing_ticket_outcome(db: Session, company_id: int, source_message_id: str) -> str | None:
    existing = (
        db.query(UnresolvedTicket)
        .filter(
            UnresolvedTicket.company_id == company_id,
            UnresolvedTicket.source_message_id == source_message_id,
        )
        .order_by(UnresolvedTicket.id.desc())
        .first()
    )
    if not existing:
        return None
    return "auto_resolved" if existing.status == "resolved" else "escalated"


def _save_ticket(db: Session, ticket: UnresolvedTicket) -> None:
    db.add(ticket)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def _send_escalation_acknowledgement(
    email_data: dict[str, str],
    company: Company,
    ticket: UnresolvedTicket,
) -> None:
    ticket_ref = f"#{ticket.id}" if getattr(ticket, "id", None) is not None else ""
    ticket_line = f"Your ticket {ticket_ref} has been created." if ticket_ref else "Your message ticket has been created."

    send_email_reply(
        to_email=email_data["from"],
        subject=f"Re: {email_data['subject']}",
        body=(
            "Hello,\n\n"
            f"{ticket_line} "
            "Our system expert will review your issue and resolve it as soon as possible.\n\n"
            "Regards,\nResolveX Team"
        ),
        from_email=company.customer_care_email,
        email_password=company.customer_care_app_password,
        smtp_host=company.smtp_host,
        smtp_port=company.smtp_port,
        smtp_use_tls=company.smtp_use_tls,
    )


def process_email(db: Session, email_data: dict[str, str], company: Company) -> str:
    source_message_id = _build_message_key(email_data)
    duplicate_outcome = _existing_ticket_outcome(db, company.id, source_message_id)
    if duplicate_outcome:
        # Message already ingested for this company.
        return duplicate_outcome

    initial_state = {
        "sender_email": email_data["from"],
        "subject": email_data["subject"],
        "body": email_data["body"],
        "company_namespace": company.pinecone_namespace,
        "retrieved_context": [],
        "can_resolve": False,
        "draft_reply": "",
        "escalation_reason": "",
        "outcome": "escalated",
    }

    try:
        result = agent_graph.invoke(initial_state)
    except Exception as exc:
        error_text = f"{exc.__class__.__name__}: {exc}".strip()
        ticket = _new_ticket(
            company_id=company.id,
            source_message_id=source_message_id,
            sender_email=email_data["from"],
            subject=email_data["subject"],
            body=email_data["body"],
            reason=f"Agent processing error: {error_text}",
            status="open",
        )
        _save_ticket(db, ticket)
        try:
            _send_escalation_acknowledgement(email_data, company, ticket)
        except Exception:
            # Ticket creation must succeed even if acknowledgement delivery fails.
            pass
        return "escalated"

    if result["outcome"] == "auto_resolved":
        try:
            send_email_reply(
                to_email=email_data["from"],
                subject=f"Re: {email_data['subject']}",
                body=result["draft_reply"],
                from_email=company.customer_care_email,
                email_password=company.customer_care_app_password,
                smtp_host=company.smtp_host,
                smtp_port=company.smtp_port,
                smtp_use_tls=company.smtp_use_tls,
            )
            # Record auto-resolved ticket as resolved in database
            ticket = _new_ticket(
                company_id=company.id,
                source_message_id=source_message_id,
                sender_email=email_data["from"],
                subject=email_data["subject"],
                body=email_data["body"],
                reason="Auto-resolved by AI agent",
                status="resolved",
                reply_sent_by="automation",
                resolution_note=result["draft_reply"],
                replied_at=datetime.utcnow(),
            )
            _save_ticket(db, ticket)
            return "auto_resolved"
        except Exception:
            ticket = _new_ticket(
                company_id=company.id,
                source_message_id=source_message_id,
                sender_email=email_data["from"],
                subject=email_data["subject"],
                body=email_data["body"],
                reason="Auto-reply failed to send",
                status="open",
            )
            _save_ticket(db, ticket)
            try:
                _send_escalation_acknowledgement(email_data, company, ticket)
            except Exception:
                # Ticket creation must succeed even if acknowledgement delivery fails.
                pass
            return "escalated"

    ticket = _new_ticket(
        company_id=company.id,
        source_message_id=source_message_id,
        sender_email=email_data["from"],
        subject=email_data["subject"],
        body=email_data["body"],
        reason=result.get("escalation_reason") or "Needs human support",
        status="open",
    )
    _save_ticket(db, ticket)
    try:
        _send_escalation_acknowledgement(email_data, company, ticket)
    except Exception:
        # Ticket creation must succeed even if acknowledgement delivery fails.
        pass
    return "escalated"


def poll_inbox_once(db: Session, company: Company, max_count: int = 20) -> tuple[int, int, int]:
    try:
        emails = fetch_unseen_emails(
            email_user=company.customer_care_email,
            email_password=company.customer_care_app_password,
            imap_host=company.imap_host,
            imap_port=company.imap_port,
            max_count=max_count,
        )
    except Exception as exc:
        record_poll_error(exc)
        return 0, 0, 0

    auto_resolved = 0
    escalated = 0

    for item in emails:
        try:
            outcome = process_email(db, item, company)
            if outcome == "auto_resolved":
                auto_resolved += 1
            else:
                escalated += 1

            # Avoid duplicate reprocessing of the same unread email.
            mark_email_seen(
                email_user=company.customer_care_email,
                email_password=company.customer_care_app_password,
                imap_host=company.imap_host,
                imap_port=company.imap_port,
                message_id=item["message_id"],
            )
        except Exception as exc:
            # Keep polling other emails even if one message fails processing/storage.
            db.rollback()
            record_poll_error(exc)
            escalated += 1

    record_poll_result(len(emails), auto_resolved, escalated)
    return len(emails), auto_resolved, escalated

