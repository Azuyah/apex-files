from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
database_url = settings.sqlalchemy_database_url
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    ensure_user_profile_columns()


def ensure_user_profile_columns() -> None:
    existing = {column["name"] for column in inspect(engine).get_columns("users")}
    columns = {
        "vat_number": "VARCHAR(80) DEFAULT ''",
        "phone_number": "VARCHAR(80) DEFAULT ''",
        "country": "VARCHAR(120) DEFAULT ''",
        "selected_package": "VARCHAR(40) DEFAULT 'free'",
        "session_version": "INTEGER NOT NULL DEFAULT 0",
    }
    missing = [(name, ddl) for name, ddl in columns.items() if name not in existing]
    if not missing:
        return
    with engine.begin() as connection:
        for name, ddl in missing:
            connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))
