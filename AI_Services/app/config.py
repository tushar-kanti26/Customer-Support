from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "ResolveX"
    debug_mode: bool = False
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 480

    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-flash"
    gemini_embedding_model: str = "models/gemini-embedding-001"
    gemini_embedding_dimension: int = 384

    pinecone_api_key: str = ""
    pinecone_index_name: str = "customer-care-docs"
    pinecone_namespace: str = "default"
    top_k_docs: int = 5

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/customer_care"

    imap_host: str = "imap.gmail.com"
    imap_port: int = 993
    email_user: str = ""
    email_password: str = ""

    auto_poll_enabled: bool = True
    auto_poll_interval_seconds: int = 30
    poll_max_count: int = 20

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_use_tls: bool = True

    human_support_email: str = "human-support@company.com"


settings = Settings()
