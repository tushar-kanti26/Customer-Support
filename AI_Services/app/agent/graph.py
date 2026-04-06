import json
import re

from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, StateGraph

from app.agent.state import EmailState
from app.config import settings
from app.pinecone_client import retrieve_context


_llm: ChatGoogleGenerativeAI | None = None


def get_llm() -> ChatGoogleGenerativeAI:
    global _llm
    if _llm is None:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is missing. Set it in backend/.env before polling emails.")
        _llm = ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.gemini_api_key,
            temperature=0,
        )
    return _llm


def _extract_json_object(text: str) -> dict:
    # Accept fenced and unfenced model output and parse first JSON object safely.
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", cleaned)
    if not match:
        return {}

    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _deterministic_resolution(subject: str, body: str, context: list[str]) -> tuple[bool, str, str]:
    if not context:
        return False, "", "No knowledge-base context available to safely auto-resolve this query."
    return False, "", "The query could not be confidently resolved from uploaded knowledge-base documents."


def retrieve_and_decide(state: EmailState) -> EmailState:
    query = f"Subject: {state['subject']}\nBody: {state['body']}"
    context = retrieve_context(query, namespace=state["company_namespace"])

    prompt = f"""
You are a customer care triage assistant.
Given the customer email and company policy context, decide if this can be fully answered.
If yes, produce a concise and helpful reply.
If no, explain why escalation to human support is needed.

Customer email:
Subject: {state['subject']}
Body: {state['body']}

Policy context:
{chr(10).join(context) if context else 'No context found.'}

Return strict JSON with keys:
can_resolve (boolean)
draft_reply (string)
escalation_reason (string)
Do not include markdown or code fences.
Rule: can_resolve must be true only when the reply is supported by the provided policy context.
"""
    try:
        response = get_llm().invoke(prompt)
        content = response.content if isinstance(response.content, str) else str(response.content)
    except Exception as exc:
        fallback_can_resolve, fallback_reply, fallback_reason = _deterministic_resolution(
            state["subject"], state["body"], context
        )
        state["retrieved_context"] = context
        state["can_resolve"] = fallback_can_resolve
        state["draft_reply"] = fallback_reply or "Thank you for contacting us. We are reviewing your request."
        state["escalation_reason"] = (
            f"Agent decision failed ({exc.__class__.__name__}: {exc}). {fallback_reason}".strip()
        )[:240]
        return state

    data = _extract_json_object(content)

    can_resolve = bool(data.get("can_resolve", False))
    draft_reply = str(data.get("draft_reply", "")).strip()
    escalation_reason = str(data.get("escalation_reason", "")).strip() or "Insufficient policy clarity."

    # Auto-resolution is allowed only when KB context exists.
    if not context:
        can_resolve = False
        if not escalation_reason:
            escalation_reason = "No knowledge-base context available to safely auto-resolve this query."

    if not draft_reply and can_resolve:
        # Fall back to deterministic resolver when model does not return usable JSON payload.
        can_resolve, draft_reply, escalation_reason = _deterministic_resolution(
            state["subject"], state["body"], context
        )

    if not can_resolve:
        fallback_can_resolve, fallback_reply, fallback_reason = _deterministic_resolution(
            state["subject"], state["body"], context
        )
        if fallback_can_resolve:
            can_resolve = True
            draft_reply = fallback_reply
            escalation_reason = ""
        elif not escalation_reason:
            escalation_reason = fallback_reason

    state["retrieved_context"] = context
    state["can_resolve"] = can_resolve
    state["draft_reply"] = draft_reply or "Thank you for contacting us. We are reviewing your request."
    state["escalation_reason"] = escalation_reason
    return state


def route_resolution(state: EmailState) -> str:
    return "resolve" if state["can_resolve"] else "escalate"


def mark_resolved(state: EmailState) -> EmailState:
    state["outcome"] = "auto_resolved"
    return state


def mark_escalated(state: EmailState) -> EmailState:
    state["outcome"] = "escalated"
    return state


def build_graph():
    graph = StateGraph(EmailState)
    graph.add_node("retrieve_and_decide", retrieve_and_decide)
    graph.add_node("resolve", mark_resolved)
    graph.add_node("escalate", mark_escalated)

    graph.set_entry_point("retrieve_and_decide")
    graph.add_conditional_edges("retrieve_and_decide", route_resolution, {"resolve": "resolve", "escalate": "escalate"})
    graph.add_edge("resolve", END)
    graph.add_edge("escalate", END)

    return graph.compile()


agent_graph = build_graph()
