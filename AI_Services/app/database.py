from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings


# PostgreSQL-optimized engine configuration
engine_kwargs = {
    "future": True,
    "pool_pre_ping": True,
    "pool_size": 20,  # Connection pool size for PostgreSQL
    "max_overflow": 40,  # Maximum overflow connections
}

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
