from typing import Literal, TypedDict


class EmailState(TypedDict):
    sender_email: str
    subject: str
    body: str
    company_namespace: str
    retrieved_context: list[str]
    can_resolve: bool
    draft_reply: str
    escalation_reason: str
    outcome: Literal["auto_resolved", "escalated"]
