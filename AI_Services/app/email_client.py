import email
import imaplib
import smtplib
import threading
from dataclasses import dataclass
from time import time
from email.header import decode_header
from email.message import EmailMessage
from email.utils import parseaddr


@dataclass
class _ImapSession:
    mail: imaplib.IMAP4_SSL
    last_used_at: float


_imap_sessions: dict[tuple[str, str, str, int], _ImapSession] = {}
_imap_sessions_lock = threading.Lock()


def _new_imap_connection(email_user: str, email_password: str, imap_host: str, imap_port: int) -> imaplib.IMAP4_SSL:
    mail = imaplib.IMAP4_SSL(imap_host, imap_port)
    mail.login(email_user, email_password)
    return mail


def _get_or_create_imap_connection(
    email_user: str,
    email_password: str,
    imap_host: str,
    imap_port: int,
) -> imaplib.IMAP4_SSL:
    key = (email_user, email_password, imap_host, imap_port)
    with _imap_sessions_lock:
        session = _imap_sessions.get(key)
        if session is None:
            mail = _new_imap_connection(email_user, email_password, imap_host, imap_port)
            _imap_sessions[key] = _ImapSession(mail=mail, last_used_at=time())
            return mail

        try:
            status, _ = session.mail.noop()
            if status == "OK":
                session.last_used_at = time()
                return session.mail
        except Exception:
            # Recreate the connection below.
            pass

        try:
            session.mail.logout()
        except Exception:
            pass

        mail = _new_imap_connection(email_user, email_password, imap_host, imap_port)
        _imap_sessions[key] = _ImapSession(mail=mail, last_used_at=time())
        return mail


def close_imap_sessions() -> None:
    with _imap_sessions_lock:
        for key, session in list(_imap_sessions.items()):
            try:
                session.mail.logout()
            except Exception:
                pass
            _imap_sessions.pop(key, None)


def _decode_mime_words(value: str | None) -> str:
    if not value:
        return ""
    decoded_fragments = decode_header(value)
    fragments: list[str] = []
    for text, encoding in decoded_fragments:
        if isinstance(text, bytes):
            fragments.append(text.decode(encoding or "utf-8", errors="ignore"))
        else:
            fragments.append(text)
    return "".join(fragments)


def _extract_body(message: email.message.Message) -> str:
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            if content_type == "text/plain" and "attachment" not in content_disposition.lower():
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="ignore")
    else:
        payload = message.get_payload(decode=True)
        if payload:
            charset = message.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="ignore")
    return ""


def fetch_unseen_emails(
    email_user: str,
    email_password: str,
    imap_host: str,
    imap_port: int,
    max_count: int = 20,
) -> list[dict[str, str]]:
    mail = _get_or_create_imap_connection(email_user, email_password, imap_host, imap_port)
    mail.select("inbox")

    status, data = mail.uid("search", None, "UNSEEN")
    if status != "OK" or not data or not data[0]:
        return []

    message_ids = data[0].split()[-max_count:]
    emails: list[dict[str, str]] = []

    for msg_id in message_ids:
        # Use BODY.PEEK[] to avoid changing message seen-state during reads.
        fetch_status, fetched = mail.uid("fetch", msg_id, "(BODY.PEEK[])")
        if fetch_status != "OK" or not fetched:
            continue

        raw = fetched[0][1]
        parsed = email.message_from_bytes(raw)

        sender = parseaddr(parsed.get("From", ""))[1]
        subject = _decode_mime_words(parsed.get("Subject", ""))
        body = _extract_body(parsed)
        internet_message_id = (parsed.get("Message-ID", "") or "").strip().strip("<>")
        uid = msg_id.decode()
        dedupe_key = internet_message_id or f"imap-uid:{uid}"

        emails.append(
            {
                "message_id": uid,
                "dedupe_key": dedupe_key,
                "from": sender,
                "subject": subject,
                "body": body,
            }
        )

    return emails


def mark_email_seen(
    email_user: str,
    email_password: str,
    imap_host: str,
    imap_port: int,
    message_id: str,
) -> None:
    mail = _get_or_create_imap_connection(email_user, email_password, imap_host, imap_port)
    mail.select("inbox")
    # Mark a processed message as seen to avoid duplicate ingestion.
    mail.uid("store", message_id, "+FLAGS", "(\\Seen)")

def send_email_reply(
    to_email: str,
    subject: str,
    body: str,
    from_email: str,
    email_password: str,
    smtp_host: str,
    smtp_port: int,
    smtp_use_tls: bool,
) -> None:
    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(smtp_host, smtp_port) as smtp:
        if smtp_use_tls:
            smtp.starttls()
        smtp.login(from_email, email_password)
        smtp.send_message(msg)
