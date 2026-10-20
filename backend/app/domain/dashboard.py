"""The KPI cards of each role's dashboard (dashboardKpis / salesGrowth in src/lib/dashboard.js)."""
from __future__ import annotations

from ..core.timeutil import add_days, days_between, format_range
from . import constants as c
from .filters import Filters, filter_forecasts, filter_inventory


def kpi(id_: str, label: str, value, fmt: str, detail: str, icon: str, tone: str = "") -> dict:
    return {"id": id_, "label": label, "value": value, "format": fmt, "detail": detail, "icon": icon, "tone": tone}


def sales_growth(revenue_between, f: Filters, bounds: tuple[str, str]) -> dict:
    """Net revenue in the range against the period of the same length before it (daily averages when the
    history starts or ends inside either period). revenue_between(start, end) sums the filtered sales."""
    days = days_between(f.start, f.end)
    previous_end = add_days(f.start, -1)
    previous_start = add_days(previous_end, -(days - 1))
    first, last = bounds

    def covered(start: str, end: str):
        frm = start if start > first else first
        to = end if end < last else last
        return frm, to, 0 if frm > to else days_between(frm, to)

    _, _, current_days = covered(f.start, f.end)
    compared_start, _, previous_days = covered(previous_start, previous_end)
    current = revenue_between(f.start, f.end)
    previous = revenue_between(previous_start, previous_end)
    value = None
    if current_days and previous_days and previous > 0:
        value = ((current / current_days) / (previous / previous_days) - 1) * 100
    return {
        "value": value,
        "previousStart": compared_start if previous_days else previous_start,
        "previousEnd": previous_end,
        "partial": current_days < days or previous_days < days,
    }


def dashboard_kpis(role_id: int, f: Filters, *, totals: dict, growth: dict | None, inventory: list[dict], forecasts: list[dict], datasets: list[dict], users_active: int, unresolved_errors: int, total_sales: int) -> list[dict]:
    records = filter_inventory(inventory, f)
    runs = filter_forecasts(forecasts, f, inventory)

    if role_id == c.STORE_MANAGER:
        detail = "No sales in the previous period"
        if growth and growth["value"] is not None:
            detail = f"vs {format_range(growth['previousStart'], growth['previousEnd'])}{' · daily average' if growth['partial'] else ''}"
        return [
            kpi("total_revenue", "Total sales revenue", totals["revenue"], "currency_millions", "Net of recorded discounts", "trend"),
            kpi("units_sold", "Total units sold", totals["units"], "number", f"{totals['records']:,} sales records", "box"),
            kpi("active_skus", "Active products / SKUs", totals["skus"], "number", f"{len(records):,} inventory records", "grid"),
            kpi("sales_growth", "Sales growth", growth["value"] if growth else None, "growth", detail, "trend"),
        ]
    if role_id == c.DATA_ANALYST:
        waiting = sum(1 for d in datasets if d["cleaning"] == "Pending" and d["pendingCount"] > 0)
        latest = runs[0] if runs else None
        mape = latest["metrics"]["mape"] if latest else None
        accuracy = None if mape is None else max(0.0, 100 - mape)
        return [
            kpi("uploaded_datasets", "Uploaded datasets", len(datasets), "number", f"{waiting} waiting for cleaning" if waiting else f"{total_sales:,} total records", "upload"),
            kpi("valid_records", "Valid records", totals["records"], "number", "After active filters", "check"),
            kpi("forecast_runs", "Forecast runs", len(runs), "number", "Saved executions", "trend"),
            kpi("forecast_accuracy", "Forecast accuracy", accuracy, "percent", "Run a model to evaluate" if accuracy is None else "100 − evaluation MAPE", "check"),
        ]
    if role_id == c.INVENTORY_SUPERVISOR:
        def count(status):
            return sum(1 for row in records if row["status"] == status)

        return [
            kpi("active_skus", "Active SKUs", len(records), "number", "Matching products", "box"),
            kpi("safe_items", "Safe stock items", count("Safe"), "number", "Above reorder level", "check"),
            kpi("low_items", "Low stock items", count("Warning"), "number", "Below reorder level", "warning", "warning"),
            kpi("critical_items", "Critical stock alerts", count("Critical"), "number", "Immediate review", "warning", "critical"),
            kpi("suggested_reorder", "Suggested reorder", sum(row["suggested"] for row in records), "units", f"Across {sum(1 for row in records if row['suggested'] > 0):,} products", "trend"),
        ]
    return [
        kpi("active_users", "Active users", users_active, "number", "Across four roles", "shield"),
        kpi("dataset_uploads", "Dataset uploads", len(datasets), "number", "Recorded uploads", "upload"),
        kpi("forecast_runs", "Forecast runs", len(forecasts), "number", "Saved executions", "trend"),
        kpi("unresolved_errors", "Unresolved errors", unresolved_errors, "number", "Requires attention", "warning", "critical"),
    ]
