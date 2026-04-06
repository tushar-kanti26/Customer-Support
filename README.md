# ResolveX (LangGraph + Pinecone + Postgres)

This project is an AI-powered customer support resolution system with:

- Email ingestion from company inbox (IMAP)
- LangGraph agent to decide whether an email can be auto-resolved
- Pinecone retrieval from company policies/documents
- Automatic reply to customers for resolvable queries (SMTP)
- Human escalation path for unresolved queries
- Multi-company onboarding with company admin login
- Role-based auth (`company_admin`, `human_agent`)
- Postgres storage for unresolved tickets
- Support team web console for login and manual ticket resolution

## Architecture

1. Poll unread emails from inbox.
2. For each email, run LangGraph workflow:
   - Retrieve company-specific policy context from Pinecone namespace.
   - Ask LLM if issue can be resolved using policy context.
   - If resolvable, send AI reply to customer.
   - Else, create unresolved ticket in Postgres for that company.
3. Human support agents login and resolve escalated tickets.

## Stack

- Backend: FastAPI
- Agent orchestration: LangGraph
- LLM: Gemini via `langchain-google-genai`
- Vector DB: Pinecone
- Relational DB: PostgreSQL
- UI: Static HTML/CSS/JS served by FastAPI

## Project Structure

- `backend/app/main.py`: FastAPI entrypoint
- `backend/app/agent/graph.py`: LangGraph workflow
- `backend/app/pinecone_client.py`: Pinecone retrieval helper
- `backend/app/email_client.py`: IMAP/SMTP integration
- `backend/app/services/email_processor.py`: end-to-end email processing
- `backend/app/routers/*`: APIs for auth, ingestion, and tickets
- `backend/app/static/*`: support team dashboard
- `backend/scripts/index_policies.py`: policy indexing script

## Setup

### 1) Start local PostgreSQL

Ensure PostgreSQL is installed and running on your machine, and create database `customer_care`.

Example with `psql`:

```bash
psql -U postgres -c "CREATE DATABASE customer_care;"
```

### 2) Python environment and dependencies

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 3) Configure environment

```bash
copy .env.example .env
```

Update `.env` values:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_EMBEDDING_MODEL`
- `PINECONE_API_KEY`
- `PINECONE_INDEX_NAME`
- `DATABASE_URL`
- `EMAIL_USER`, `EMAIL_PASSWORD`
- `IMAP_HOST`, `SMTP_HOST` if different from defaults
- `HUMAN_SUPPORT_EMAIL`

### 4) Index company docs/policies to Pinecone

Place docs under `backend/data` (`.txt` or `.md`) and run:

```bash
python scripts/index_policies.py --docs ./data
```

### 5) Run API

```bash
uvicorn app.main:app --reload
```

Open: `http://localhost:8000`

## Customer Care Login

1. Register human agent via `POST /api/auth/register/human-agent` using `username + company_email + password`.
2. Human login via `POST /api/auth/login/human` using `username + password`.
3. Customer care agents see and resolve unresolved tickets only for their own company.

The built-in web console now supports:
- simple customer care login with username and password
- unresolved ticket listing and resolution

## API Endpoints

- `POST /api/auth/register/human-agent` - human agent registration (username + company email + password)
- `POST /api/auth/login/human` - human agent login (username + password)
- `GET /api/auth/me` - get current authenticated user profile
- `POST /api/ingest/poll` - poll current company inbox + process unread emails (auth required)
- `GET /api/tickets` - list company unresolved/resolved tickets (auth required)
- `PATCH /api/tickets/{ticket_id}` - resolve/update ticket (auth required)
- `GET /health` - health check

## Reply Ownership Rule

- Auto-resolved messages are replied by AI and do not create unresolved tickets.
- Escalated tickets are replied by human agents on resolve.
- A ticket prevents duplicate customer replies from multiple responders.

## Notes for Production

- Add scheduler/worker (e.g., APScheduler, Celery, or cron) to invoke `/api/ingest/poll` automatically.
- Replace default login with proper user management + password reset.
- Add audit logs and role-based permissions.
- Secure email credentials via secret manager.
- Add robust JSON parsing in `graph.py` and guardrails for AI outputs.

## Render Deployment (Production)

Use `AI_Services/app` as the service root directory.

- Root directory: `AI_Services/app`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/health`

Required environment variables:

- `DATABASE_URL` (from Render PostgreSQL connection string)
- `SECRET_KEY`
- `GEMINI_API_KEY`
- `PINECONE_API_KEY`
- `PINECONE_INDEX_NAME`

Recommended production values:

- `DEBUG_MODE=false`
- `AUTO_POLL_ENABLED=false`
