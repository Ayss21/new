"""Optional checks against a real SQL Server. Set TEST_MSSQL_URL to a DemandIQ database that has
01_schema.sql and 02_seed.sql loaded, e.g.
  TEST_MSSQL_URL="mssql+pyodbc://demandiq_app:<password>@localhost:1433/DemandIQ?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"
"""
import os

import pytest
from sqlalchemy import create_engine, func, select, text

from app import models

URL = os.environ.get("TEST_MSSQL_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_MSSQL_URL is not set (SQL Server checks skipped)")


def test_connects_and_has_the_seed():
    engine = create_engine(URL)
    with engine.connect() as connection:
        assert "Microsoft SQL Server" in connection.execute(text("SELECT @@VERSION")).scalar()
        assert connection.execute(select(func.count()).select_from(models.SalesRecord)).scalar() > 7000
        assert connection.execute(text("SELECT COUNT(*) FROM dbo.vw_inventory_status")).scalar() >= 11
        statuses = dict(connection.execute(text("SELECT dataset_id, forecasting FROM dbo.vw_dataset_status")).all())
        assert statuses["DS-0005"] == "Completed" and statuses["DS-0007"] == "Pending"
        first = connection.execute(text("SELECT NEXT VALUE FOR dbo.seq_forecast_id")).scalar()
        assert first >= 12


def test_the_api_on_sql_server(monkeypatch):
    from fastapi.testclient import TestClient

    from app.database import configure

    configure(URL)
    from app.main import app

    client = TestClient(app)
    login = client.post("/api/auth/login", json={"login": "analyst@demo.demandiq", "password": "Analyze123!", "roleId": 2})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}
    assert client.get("/api/health").json()["database"] == "ok"
    assert len(client.get("/api/sales", headers=headers, params={"start": "2025-03-19", "end": "2025-06-18"}).json()) > 0
    client.post("/api/auth/logout", headers=headers)
