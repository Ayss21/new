"""/dashboard — the KPI cards for the signed-in user's role, with the global filters."""
from __future__ import annotations

from dataclasses import replace

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..core.deps import Principal, current_principal
from ..core.timeutil import iso, utcnow
from ..database import get_db
from ..domain import constants as c
from ..domain.dashboard import dashboard_kpis, sales_growth
from ..domain.filters import parse_filters
from ..schemas import SummaryOut

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def filter_query(start, end, category, sku, region, model, status) -> dict:
    return {"start": start, "end": end, "category": category, "sku": sku, "region": region, "model": model, "status": status}


@router.get("/summary", response_model=SummaryOut, summary="KPI cards for the signed-in user's role")
def summary(
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    category: list[str] | None = Query(None),
    sku: list[str] | None = Query(None),
    region: list[str] | None = Query(None),
    model: list[str] | None = Query(None),
    status: list[str] | None = Query(None, description="Safe, Warning, Critical (Inventory Supervisor)"),
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    bounds = repo.sales_bounds(db)
    f = parse_filters(filter_query(start, end, category, sku, region, model, status), bounds)
    role = principal.role_id
    totals = repo.sales_totals(db, f)
    growth = None
    if role == c.STORE_MANAGER:
        growth = sales_growth(lambda s, e: repo.sales_totals(db, replace(f, start=s, end=e))["revenue"], f, bounds)
    needs_runs = role in (c.DATA_ANALYST, c.ADMIN)
    forecasts = repo.load_forecasts(db) if needs_runs else []
    datasets = repo.load_datasets(db) if role in (c.DATA_ANALYST, c.ADMIN) else []
    kpis = dashboard_kpis(
        role,
        f,
        totals=totals,
        growth=growth,
        inventory=repo.load_inventory(db),
        forecasts=forecasts,
        datasets=datasets,
        users_active=db.execute(select(func.count()).select_from(m.User).where(m.User.status == "Active")).scalar_one() if role == c.ADMIN else 0,
        unresolved_errors=db.execute(select(func.count()).select_from(m.ErrorLog).where(m.ErrorLog.status != "Resolved")).scalar_one() if role == c.ADMIN else 0,
        total_sales=db.execute(select(func.count()).select_from(m.SalesRecord)).scalar_one() if role == c.DATA_ANALYST else 0,
    )
    return {"roleId": role, "generatedAt": iso(utcnow()), "startDate": f.start, "endDate": f.end, "kpis": kpis}
