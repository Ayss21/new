"""Test setup: the FastAPI app on an in-memory SQLite database built from the same models and loaded with
the same demo data as SQL Server (database/seed/demo-data.json). Nothing here needs SQL Server; see
tests/test_sqlserver.py for the checks that run against a real server when TEST_MSSQL_URL is set."""
from __future__ import annotations

import os
import tempfile

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("BCRYPT_ROUNDS", "4")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("REPORTS_DIR", tempfile.mkdtemp(prefix="demandiq-reports-"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.core import ids  # noqa: E402
from app.database import configure, session_factory  # noqa: E402
from app.seed.loader import build_rows, load, read_seed  # noqa: E402

_ROWS = None

ACCOUNTS = {
    "manager": ("store.manager@demo.demandiq", "Store123!", 1),
    "analyst": ("analyst@demo.demandiq", "Analyze123!", 2),
    "inventory": ("inventory@demo.demandiq", "Stock123!", 3),
    "admin": ("admin@demo.demandiq", "Admin123!", 4),
}


def seed_rows():
    global _ROWS
    if _ROWS is None:
        _ROWS = build_rows(read_seed(get_settings().seed_file), bcrypt_rounds=4)
    return _ROWS


@pytest.fixture()
def client():
    """A fresh, seeded database and a TestClient for every test."""
    engine = configure(os.environ["DATABASE_URL"])
    models.Base.metadata.drop_all(engine)
    models.Base.metadata.create_all(engine)
    ids.reset_memory_counters()
    with session_factory()() as db:
        load(db, seed_rows())
        db.commit()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def sign_in(client: TestClient, who: str) -> str:
    login, password, role = ACCOUNTS[who]
    response = client.post("/api/auth/login", json={"login": login, "password": password, "roleId": role})
    assert response.status_code == 200, response.text
    return response.json()["accessToken"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def as_user(client):
    """as_user("analyst") → headers for that demo account."""

    def make(who: str) -> dict:
        return auth(sign_in(client, who))

    return make
