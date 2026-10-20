"""SQLAlchemy engine and sessions.

Production uses Microsoft SQL Server through pyodbc (mssql+pyodbc). The automated tests use an in-memory
SQLite database built from the same models, so they run anywhere; nothing in the application is
SQLite-specific.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings

_engine: Engine | None = None
_session_factory: sessionmaker | None = None


def make_engine(url: str, echo: bool = False) -> Engine:
    if url.startswith("sqlite"):
        in_memory = url in ("sqlite://", "sqlite:///:memory:") or ":memory:" in url
        # An in-memory database lives in one connection (tests); a file database gets a normal pool
        extra = {"poolclass": StaticPool} if in_memory else {}
        engine = create_engine(url, echo=echo, connect_args={"check_same_thread": False, "timeout": 30}, **extra)

        @event.listens_for(engine, "connect")
        def _sqlite_fk(dbapi_connection, _record):  # enforce foreign keys like SQL Server does
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine
    kwargs = {"echo": echo, "pool_pre_ping": True, "pool_recycle": 1800}
    if url.startswith("mssql+pyodbc"):
        kwargs["fast_executemany"] = True  # bulk inserts (seed, cleaning) in one round trip
    return create_engine(url, **kwargs)


def configure(url: str | None = None) -> Engine:
    """(Re)creates the engine. Tests call it with an SQLite URL."""
    global _engine, _session_factory
    settings = get_settings()
    _engine = make_engine(url or settings.sqlalchemy_url, echo=settings.db_echo)
    _session_factory = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def get_engine() -> Engine:
    return _engine or configure()


def session_factory() -> sessionmaker:
    if _session_factory is None:
        configure()
    return _session_factory


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, committed by the route, rolled back on errors."""
    db = session_factory()()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def is_mssql(db: Session) -> bool:
    return db.get_bind().dialect.name == "mssql"
