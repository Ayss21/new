"""The demo data → database rows.

database/seed/demo-data.json is exported from the frontend's demo backend (`npm run export:seed` in
demandiq-react), so the FastAPI app starts with exactly the records demo mode shows. build_rows() turns it
into rows of the normalized tables (in load order); load() inserts them through SQLAlchemy (any database,
used by `python -m app.cli seed` and the tests) and write_sql() writes them as the SQL Server seed script
database/02_seed.sql.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from .. import models as m
from ..core.security import hash_password
from ..core.timeutil import parse_iso
from ..domain import constants as c

# Tables in load order (each refers only to tables before it); deleted in the reverse order
LOAD_ORDER = [
    m.Role, m.Screen, m.RoleScreen, m.PermissionAction, m.RolePermission, m.ReportType, m.RoleReportType, m.Module,
    m.User, m.SessionRow, m.ActivityLog, m.ErrorLog, m.Category, m.Region, m.Location, m.Dataset, m.Product,
    m.Inventory, m.InventorySnapshot, m.InventorySnapshotItem, m.Reorder, m.PendingRecord, m.SalesRecord,
    m.ForecastRun, m.ForecastPoint, m.ForecastSource, m.Report,
]
IDENTITY_TABLES = {"regions", "locations"}


def read_seed(path: Path) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _ts(text: str | None) -> datetime | None:
    return parse_iso(text) if text else None


def _d(text: str | None) -> date | None:
    return date.fromisoformat(text[:10]) if text else None


def _money(value) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def build_rows(data: dict, *, bcrypt_rounds: int = 12) -> dict[str, list[dict]]:
    """{table name: [row, …]} for every table, from the exported demo data."""
    ref = data["reference"]
    rows: dict[str, list[dict]] = {t.__tablename__: [] for t in LOAD_ORDER}
    users = {u["id"]: u for u in data["users"]}
    user_by_name = {u["name"]: u["id"] for u in data["users"]}

    # --- Access ------------------------------------------------------------------------------------
    rows["roles"] = [{"role_id": rid, "name": name} for rid, name in c.ROLE_NAMES.items()]
    rows["screens"] = [{"screen_id": s["id"], "name": s["label"], "path": s["path"], "position": i + 1} for i, s in enumerate(ref["screens"])]
    rows["role_screens"] = [{"role_id": int(rid), "screen_id": sid} for rid, ids in ref["roleScreens"].items() for sid in ids]
    rows["permission_actions"] = [
        {
            "action": action,
            "screen_id": ref["permissionScreen"][action],
            "allows_view": "View" in ref["permissionOptions"][action],
            "allows_review": "Review" in ref["permissionOptions"][action],
            "position": i + 1,
        }
        for i, action in enumerate(ref["permissionActions"])
    ]
    rows["role_permissions"] = [{"action": action, "role_id": int(rid), "level": level} for action, levels in data["permissions"].items() for rid, level in levels.items()]
    rows["report_types"] = [{"name": name, "description": desc, "icon": icon, "position": i + 1} for i, (name, desc, icon) in enumerate(ref["reports"])]
    rows["role_report_types"] = [{"role_id": int(rid), "report_type": name} for rid, names in ref["reportsByRole"].items() for name in names]
    modules = list(c.MODULES)
    for source in (data["activity"], data["errors"]):
        for row in source:
            if row["module"] not in modules:
                modules.append(row["module"])
    rows["modules"] = [{"name": name, "position": i + 1} for i, name in enumerate(modules)]

    # --- Accounts and audit --------------------------------------------------------------------------
    first_seen = min(s["loginAt"] for s in data["sessions"]) if data["sessions"] else "2025-06-01T00:00:00.000Z"
    rows["users"] = [
        {
            "user_id": u["id"],
            "name": u["name"],
            "email": u["email"],
            "password_hash": hash_password(u["password"], bcrypt_rounds),
            "role_id": u["roleId"],
            "department": u["department"],
            "status": u["status"],
            "created_at": _ts(first_seen),
        }
        for u in data["users"]
    ]
    rows["sessions"] = [
        {
            "session_id": s["id"],
            "user_id": s["userId"],
            "role_id": s.get("roleId") or users[s["userId"]]["roleId"],
            "login_at": _ts(s["loginAt"]),
            "logout_at": _ts(s.get("logoutAt")),
            "expires_at": _ts(s.get("expiresAt") or s.get("logoutAt") or s["loginAt"]),
            "remember": bool(s.get("remember")),
            "token_hash": None,
        }
        for s in data["sessions"]
    ]
    rows["activity_log"] = [
        {
            "event_id": a["id"],
            "created_at": _ts(a["at"]),
            "session_id": a.get("sessionId"),
            "user_id": a.get("userId"),
            "role_id": a.get("roleId"),
            "attempted_login": None if a.get("userId") else a.get("userName"),
            "action": a["action"],
            "module": a["module"],
            "details": a.get("details") or "",
            "status": a["status"],
        }
        for a in sorted(data["activity"], key=lambda a: a["id"])
    ]
    rows["error_log"] = [
        {
            "error_id": e["id"],
            "created_at": _ts(e["at"]),
            "module": e["module"],
            "error_type": e["type"],
            "severity": e["severity"],
            "message": e["message"],
            "status": e["status"],
            "notes": e.get("notes"),
        }
        for e in sorted(data["errors"], key=lambda e: e["id"])
    ]

    # --- Catalog, locations, inventory ---------------------------------------------------------------
    rows["categories"] = [{"category_id": cat["id"], "name": cat["name"], "description": cat.get("description") or "", "status": cat["status"]} for cat in data["categories"]]
    category_id = {cat["name"]: cat["id"] for cat in data["categories"]}
    regions: dict[str, int] = {}
    locations: dict[str, int] = {}

    def location_id(location: str, region: str) -> int:
        if region not in regions:
            regions[region] = len(regions) + 1
            rows["regions"].append({"region_id": regions[region], "name": region})
        if location not in locations:
            locations[location] = len(locations) + 1
            rows["locations"].append({"location_id": locations[location], "name": location, "region_id": regions[region]})
        return locations[location]

    sku_location = {}
    for item in data["inventory"]:
        sku_location[item["sku"]] = location_id(item["location"], item["region"])

    rows["datasets"] = []
    for d in sorted(data["datasets"], key=lambda d: d["id"]):
        checks = d.get("checks") or {}
        summary = d.get("cleaningSummary") or {}
        coverage = d.get("coverage") or {}
        rows["datasets"].append(
            {
                "dataset_id": d["id"],
                "file_name": d["fileName"],
                "uploaded_at": _ts(d["uploadedAt"]),
                "uploaded_by": d["uploaderId"],
                "total_rows": checks.get("total", 0),
                "valid_rows": checks.get("valid", 0),
                "combined_rows": checks.get("combined", 0),
                "missing_rows": checks.get("missing", 0),
                "duplicate_rows": checks.get("duplicates", 0),
                "invalid_date_rows": checks.get("invalidDates", 0),
                "invalid_numeric_rows": checks.get("invalidNumeric", 0),
                "error": d.get("error"),
                "coverage_first_date": _d(coverage.get("firstDate")),
                "coverage_last_date": _d(coverage.get("lastDate")),
                "coverage_products": coverage.get("products"),
                "cleaning": d["cleaning"],
                "cleaned_at": _ts(d.get("cleanedAt")),
                "cleaned_by": user_by_name.get(summary.get("cleanedBy")) if summary else None,
                "outliers_capped": summary.get("outliersCapped") if summary else None,
                "records_replaced": summary.get("replaced") if summary else None,
                "records_skipped": summary.get("skipped") if summary else None,
                "records_added": summary.get("added") if summary else None,
            }
        )
    rows["products"] = [
        {
            "sku": item["sku"],
            "name": item["name"],
            "category_id": category_id[item["category"]],
            "channel": item["channel"],
            "unit_price": _money(item["unitPrice"]),
            "unit_cost": _money(item.get("unitCost")),
            "position": i + 1,
            "added_from": None,
        }
        for i, item in enumerate(data["inventory"])
    ]
    as_of_now = _ts(max(a["at"] for a in data["activity"])) if data["activity"] else datetime(2025, 6, 26)
    rows["inventory"] = [
        {
            "sku": item["sku"],
            "location_id": sku_location[item["sku"]],
            "stock": item["stock"],
            "reorder_level": item["reorder"],
            "safety_stock": item["safety"],
            "demand_30d": item["demand"],
            "updated_at": as_of_now,
        }
        for item in data["inventory"]
    ]
    rows["inventory_snapshots"] = [{"month": s["month"], "as_of": _d(s["asOf"])} for s in data["snapshots"]]
    rows["inventory_snapshot_items"] = [{"month": s["month"], "sku": i["sku"], "stock": i["stock"], "status": i["status"]} for s in data["snapshots"] for i in s["items"]]
    rows["reorders"] = [
        {
            "reorder_id": r["id"],
            "sku": r["sku"],
            "quantity": r["quantity"],
            "supplier": r["supplier"],
            "status": r["status"],
            "ordered_at": _ts(r["orderedAt"]),
            "delivered_at": _ts(r.get("deliveredAt")),
            "ordered_by": r["userId"],
        }
        for r in sorted(data["reorders"], key=lambda r: r["id"])
    ]

    # --- Sales -----------------------------------------------------------------------------------------
    def sale_location(record) -> int:
        return location_id(record.get("location") or "Unassigned", record.get("region") or "Unassigned")

    rows["dataset_pending_records"] = [
        {
            "record_id": r["id"],
            "dataset_id": d["id"],
            "sale_date": _d(r["date"]),
            "sku": r["sku"],
            "location_id": sale_location(r),
            "units": r["units"],
            "unit_price": _money(r["unitPrice"]),
            "discount_rate": _money(r["discountRate"]),
        }
        for d in data["datasets"]
        for r in d.get("pendingRecords") or []
    ]
    rows["sales_records"] = [
        {
            "sale_id": r["id"],
            "sale_date": _d(r["date"]),
            "sku": r["sku"],
            "location_id": sale_location(r),
            "units": r["units"],
            "unit_price": _money(r["unitPrice"]),
            "discount_rate": _money(r["discountRate"]),
            "dataset_id": r.get("datasetId"),
        }
        for r in data["sales"]
    ]

    # --- Forecasts ---------------------------------------------------------------------------------------
    for run in sorted(data["forecasts"], key=lambda r: r["id"]):
        cfg = run.get("configuration") or {}
        order = cfg.get("order") or [None, None, None]
        rows["forecast_runs"].append(
            {
                "forecast_id": run["id"],
                "sku": run["sku"],
                "model": run["model"],
                "horizon": run["horizon"],
                "start_date": _d(run["startDate"]),
                "end_date": _d(run["endDate"]),
                "window_size": cfg.get("windowSize") if run["model"] == "Moving Average" else None,
                "slope": _money(cfg.get("slope")) if run["model"] == "Linear Regression" else None,
                "arima_p": order[0] if run["model"] == "ARIMA" else None,
                "arima_d": order[1] if run["model"] == "ARIMA" else None,
                "arima_q": order[2] if run["model"] == "ARIMA" else None,
                "mae": run.get("mae"),
                "rmse": run.get("rmse"),
                "mape": run.get("mape"),
                "holdout_days": run.get("holdoutDays") or 0,
                "generated_at": _ts(run["generatedAt"]),
                "generated_by": (run.get("generatedBy") or {}).get("id"),
            }
        )
        rows["forecast_points"] += [{"forecast_id": run["id"], "period": p["period"], "predicted": p["forecast"]} for p in run["points"]]
        lineage = run.get("lineage") or {}
        for kind, key in (("used", "sources"), ("waiting", "waiting")):
            for position, s in enumerate(lineage.get(key) or [], start=1):
                rows["forecast_sources"].append(
                    {"forecast_id": run["id"], "kind": kind, "position": position, "dataset_id": s.get("datasetId"), "records": s["records"], "first_date": _d(s["firstDate"]), "last_date": _d(s["lastDate"])}
                )

    # --- Reports -------------------------------------------------------------------------------------------
    rows["reports"] = [
        {
            "report_id": r["id"],
            "report_type": r["name"],
            "format": r["format"],
            "generated_at": _ts(r["generatedAt"]),
            "completed_at": _ts(r["generatedAt"]) if r["status"] != "Processing" else None,
            "user_id": r["userId"],
            "role_id": r["roleId"],
            "status": r["status"],
            "filters": json.dumps(r["filters"]) if r.get("filters") else None,
            "error": r.get("error"),
        }
        for r in sorted(data["reports"], key=lambda r: r["id"])
    ]
    return rows


def load(db: Session, rows: dict[str, list[dict]]) -> dict[str, int]:
    """Replaces every row of the DemandIQ tables with `rows`. Returns the row count per table."""
    for model in reversed(LOAD_ORDER):
        db.execute(delete(model))
    counts = {}
    for model in LOAD_ORDER:
        table = model.__table__
        data = rows.get(table.name, [])
        if data:
            for start in range(0, len(data), 2000):
                db.execute(insert(table), data[start : start + 2000])
        counts[table.name] = len(data)
    db.flush()
    return counts


# ------------------------------------------------------------------------------------------------
# SQL Server seed script
# ------------------------------------------------------------------------------------------------


def sql_value(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, datetime):
        v = value
        return f"'{v.year:04d}-{v.month:02d}-{v.day:02d}T{v.hour:02d}:{v.minute:02d}:{v.second:02d}.{v.microsecond // 1000:03d}'"
    if isinstance(value, date):
        return f"'{value.isoformat()}'"
    return "N'" + str(value).replace("'", "''") + "'"


def sequence_restarts(rows: dict[str, list[dict]]) -> list[tuple[str, int]]:
    """Each ID sequence restarts after the highest seeded number."""
    import re

    from ..core.ids import SEQUENCES

    sources = {
        "SES": ("sessions", "session_id"), "EVT": ("activity_log", "event_id"), "ERR": ("error_log", "error_id"),
        "DS": ("datasets", "dataset_id"), "RO": ("reorders", "reorder_id"), "FC": ("forecast_runs", "forecast_id"),
        "RPT": ("reports", "report_id"), "UPL": ("dataset_pending_records", "record_id"), "MAIL": (None, None),
    }
    restarts = []
    for prefix, (sequence, _digits, _column) in SEQUENCES.items():
        table, column = sources[prefix]
        highest = 0
        if table:
            pattern = re.compile(rf"^{prefix}-(\d+)$")
            for row in rows.get(table, []):
                match = pattern.match(str(row[column]))
                if match:
                    highest = max(highest, int(match.group(1)))
        restarts.append((sequence, highest + 1))
    return restarts


def write_sql(rows: dict[str, list[dict]], path: Path, *, source: str, time_zone: str) -> None:
    lines = [
        "/* ==============================================================================================",
        "   DemandIQ — seed data for Microsoft SQL Server 2019+ / Azure SQL",
        f"   Generated by `python -m app.cli build-seed-sql` from {source} (times in UTC; the demo's wall-clock",
        f"   times were written in {time_zone}). Run after 01_schema.sql. Re-running replaces all DemandIQ rows.",
        "   Demo passwords are stored as bcrypt hashes (see README for the demo accounts).",
        "   ============================================================================================== */",
        "SET NOCOUNT ON;",
        "SET XACT_ABORT ON;",
        "GO",
        "USE [DemandIQ];",
        "GO",
        "BEGIN TRANSACTION;",
        "",
        "-- Start over: delete in reverse load order",
    ]
    for model in reversed(LOAD_ORDER):
        lines.append(f"DELETE FROM dbo.{model.__tablename__};")
    lines.append("")
    for model in LOAD_ORDER:
        table = model.__table__
        data = rows.get(table.name, [])
        lines.append(f"-- {table.name}: {len(data):,} rows")
        if not data:
            lines.append("")
            continue
        columns = [col.name for col in table.columns if col.computed is None]
        if table.name in IDENTITY_TABLES:
            lines.append(f"SET IDENTITY_INSERT dbo.{table.name} ON;")
        for start in range(0, len(data), 1000):  # SQL Server: at most 1000 rows per VALUES list
            chunk = data[start : start + 1000]
            lines.append(f"INSERT INTO dbo.{table.name} ({', '.join(columns)}) VALUES")
            lines.append(",\n".join("  (" + ", ".join(sql_value(row.get(col)) for col in columns) + ")" for row in chunk) + ";")
        if table.name in IDENTITY_TABLES:
            lines.append(f"SET IDENTITY_INSERT dbo.{table.name} OFF;")
        lines.append("")
    lines.append("COMMIT TRANSACTION;")
    lines.append("GO")
    lines.append("")
    lines.append("-- New IDs continue after the seeded ones (FC-0012, RPT-022, EVT-0057 …)")
    for sequence, value in sequence_restarts(rows):
        lines.append(f"ALTER SEQUENCE dbo.{sequence} RESTART WITH {value};")
    lines.append("GO")
    lines.append("")
    lines.append("PRINT 'DemandIQ seed loaded: ' + CAST((SELECT COUNT(*) FROM dbo.sales_records) AS VARCHAR(12)) + ' sales records.';")
    lines.append("GO")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
