"""DemandIQ API: FastAPI application. Run with `uvicorn app.main:app --reload --port 8000` from backend/.

Every route is under /api (the React app's Vite dev server forwards /api to port 8000). Interactive docs:
http://localhost:8000/docs (Swagger UI) and http://localhost:8000/redoc.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import __version__
from .config import get_settings
from .core import errors
from .database import get_engine
from .routers import admin, auth, dashboard, forecasts, inventory, logs, reports, sales
from .schemas import HealthOut

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

TAGS = [
    {"name": "Authentication", "description": "Sign in with a role, the current user, sign out. Send `Authorization: Bearer <accessToken>` on every other request."},
    {"name": "Dashboard", "description": "KPI cards per role, calculated with the global filters."},
    {"name": "Sales data", "description": "Sales history, uploads of any layout (CSV, TSV, text, .xlsx) and cleaning."},
    {"name": "Forecasting", "description": "Moving Average, Linear Regression and ARIMA runs, comparison, lineage and model recommendation."},
    {"name": "Inventory", "description": "Stock positions, adjustments, alerts, month-end snapshots and reorders."},
    {"name": "Catalog", "description": "Product categories."},
    {"name": "Administration", "description": "Users, action permissions and screen access (Admin only)."},
    {"name": "Reports & Exports", "description": "Role-authorised reports as PDF, XLSX or CSV, generated in the background; email."},
    {"name": "Logs", "description": "Audit log, sessions and error log (Admin only)."},
    {"name": "System", "description": "Health check."},
]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "Backend for DemandIQ — demand forecasting and inventory management on Microsoft SQL Server. "
            "The request and response shapes follow docs/API_CONTRACT.md. Errors are "
            '`{"detail": {"code", "message", "fields"?}}`. Sign in with `POST /api/auth/login`, then click **Authorize** '
            "and paste the `accessToken`."
        ),
        openapi_tags=TAGS,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/api/openapi.json",
        swagger_ui_parameters={"persistAuthorization": True},
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
        expose_headers=["Content-Disposition"],
    )
    errors.install(app)

    api = APIRouter(prefix="/api")
    for module in (auth, dashboard, sales, forecasts, inventory, admin, reports, logs):
        api.include_router(module.router)

    @api.get("/health", response_model=HealthOut, tags=["System"], summary="Is the API up, and can it reach the database?")
    def health():
        try:
            with get_engine().connect() as connection:
                connection.execute(text("SELECT 1"))
            database = "ok"
        except Exception as error:  # noqa: BLE001
            database = f"unavailable: {type(error).__name__}"
        return {"status": "ok", "database": database, "version": __version__}

    app.include_router(api)
    _add_bearer_scheme(app)
    return app


def _add_bearer_scheme(app: FastAPI) -> None:
    """Swagger's Authorize button: a bearer token on every route except the public ones."""
    from fastapi.openapi.utils import get_openapi

    public = {("/api/auth/login", "post"), ("/api/auth/roles", "get"), ("/api/auth/password-reset", "post"), ("/api/health", "get")}

    def openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes, tags=TAGS)
        schema.setdefault("components", {}).setdefault("securitySchemes", {})["bearerAuth"] = {"type": "http", "scheme": "bearer", "description": "The accessToken from POST /api/auth/login"}
        for path, methods in schema.get("paths", {}).items():
            for method, operation in methods.items():
                if (path, method) not in public:
                    operation["security"] = [{"bearerAuth": []}]
        app.openapi_schema = schema
        return schema

    app.openapi = openapi


app = create_app()
