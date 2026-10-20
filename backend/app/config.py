"""Configuration from environment variables (and a .env file next to the backend).

Every setting has a safe development default except the database credentials. See .env.example.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DemandIQ API"
    environment: str = Field("development", description="development | test | production")

    # --- Database -------------------------------------------------------------------------------
    # Either a full SQLAlchemy URL in DATABASE_URL, or the MSSQL_* parts below (the URL wins).
    database_url: str | None = None
    mssql_server: str = "localhost"
    mssql_port: int = 1433
    mssql_database: str = "DemandIQ"
    mssql_user: str | None = None
    mssql_password: str | None = None
    mssql_driver: str = "ODBC Driver 18 for SQL Server"
    mssql_trusted_connection: bool = False  # Windows authentication (no user / password)
    mssql_trust_server_certificate: bool = True  # local / self-signed development servers
    db_echo: bool = False

    # --- Sessions -------------------------------------------------------------------------------
    session_hours: int = 8  # without "Remember me"
    remember_days: int = 7  # with "Remember me"
    bcrypt_rounds: int = 12

    # --- HTTP -----------------------------------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_upload_mb: int = 50

    # --- Reports and email ----------------------------------------------------------------------
    reports_dir: Path = BACKEND_DIR / "storage" / "reports"
    # Times in reports ("14 Oct 2026, 10:42") are written in this zone
    app_timezone: str = "Asia/Kolkata"
    # SMTP for POST /reports/email. Without SMTP_HOST the request is recorded (activity log: Pending) but no
    # email is sent.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "DemandIQ <no-reply@demandiq.local>"
    smtp_starttls: bool = True

    # --- Seed -----------------------------------------------------------------------------------
    seed_file: Path = PROJECT_DIR / "database" / "seed" / "demo-data.json"

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        params = f"driver={quote_plus(self.mssql_driver)}"
        if self.mssql_trust_server_certificate:
            params += "&TrustServerCertificate=yes"
        host = f"{self.mssql_server}:{self.mssql_port}" if self.mssql_port else self.mssql_server
        if self.mssql_trusted_connection:
            return f"mssql+pyodbc://@{host}/{self.mssql_database}?{params}&Trusted_Connection=yes"
        user = quote_plus(self.mssql_user or "")
        password = quote_plus(self.mssql_password or "")
        return f"mssql+pyodbc://{user}:{password}@{host}/{self.mssql_database}?{params}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
