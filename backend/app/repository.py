"""Database repository for DemandIQ ERD v3.

Maps SQLAlchemy models to the camelCase JSON shapes used by the API.
The database schema is fixed; this module does not create or alter tables.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, timedelta

from .domain import constants as c

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models as m
from .core.ids import next_id
from .core.timeutil import day, iso, utcnow
from .domain import constants as c
from .domain.filters import Filters
from .domain.inventory import derive, inventory_status
from .domain.lineage import by_source, forecasting_status
from .domain.sales_import import validation_label

DEFAULT_BOUNDS = ("2025-03-19", "2025-06-18")

# API modules mapped to the screens required by activity_log and error_log.
SCREEN_BY_MODULE = {
    "dashboard": "SCR-01",
    "sales": "SCR-02",
    "sales data": "SCR-02",
    "datasets": "SCR-02",
    "inventory": "SCR-03",
    "reorders": "SCR-03",
    "reports": "SCR-04",
    "forecast": "SCR-05",
    "forecasts": "SCR-05",
    "admin": "SCR-06",
    "administration": "SCR-06",
    "auth": "SCR-01",
    "authentication": "SCR-01",
}


def num(value):
    """Convert Decimal/float values to JSON-friendly numbers."""
    if value is None:
        return None
    value = float(value)
    return int(value) if value.is_integer() else value


def _screen_id(module: str | None) -> str:
    return SCREEN_BY_MODULE.get((module or "").lower(), "SCR-01")


def _user_name(db: Session, user_id: str | None) -> str | None:
    if not user_id:
        return None
    return db.get(m.User, user_id).full_name if db.get(m.User, user_id) else None


# ======================================================================================
# Users, roles, permissions
# ======================================================================================

def public_user(user: m.User) -> dict:
    return {
        "id": user.user_id,
        "name": user.full_name,
        "email": user.email,
        "roleId": user.role_id,
        "initials": c.initials_of(user.full_name),
        "department": user.department,
        "status": user.status,
    }


def permission_matrix(db: Session) -> dict[str, dict[str, str]]:
    rows = db.execute(
        select(m.RolePermission).order_by(m.RolePermission.action)
    ).scalars().all()

    matrix = {
        action: {str(role): "No" for role in c.ROLE_IDS}
        for action in c.PERMISSION_SCREEN
    }

    for row in rows:
        matrix.setdefault(
            row.action, {str(role): "No" for role in c.ROLE_IDS}
        )[str(row.role_id)] = row.access_level

    return matrix


def screen_map(db: Session) -> dict[str, list[str]]:
    order = {sid: i for i, sid in enumerate(c.SCREEN_IDS)}
    result = {str(role): [] for role in c.ROLE_IDS}

    for row in db.execute(select(m.RoleScreen)).scalars():
        result.setdefault(str(row.role_id), []).append(row.screen_id)

    return {
        role: sorted(screens, key=lambda sid: order.get(sid, 99))
        for role, screens in result.items()
    }


def screens_for(db: Session, role_id: int) -> list[str]:
    return screen_map(db).get(str(role_id), [])


def effective_levels(db: Session, role_id: int) -> dict[str, str]:
    matrix = permission_matrix(db)
    allowed_screens = set(screens_for(db, role_id))

    action_screens = {
        row.action: row.screen_id
        for row in db.execute(select(m.RolePermission)).scalars()
    }

    result = {}
    for action, role_levels in matrix.items():
        level = role_levels.get(str(role_id), "No")
        if role_id == c.ADMIN and action in c.ADMIN_VIEW_ONLY:
            level = c.ADMIN_VIEW_ONLY[action]

        screen = action_screens.get(
            action, c.PERMISSION_SCREEN.get(action)
        )
        if screen and screen not in allowed_screens:
            level = "No"

        result[action] = level

    return result



def report_types_for(db: Session, role_id: int) -> list[dict]:
    rows = db.execute(
        select(m.RoleReportType)
        .where(m.RoleReportType.role_id == role_id)
        .order_by(m.RoleReportType.report_type_id)
    ).scalars().all()

    # Get the descriptions and icons defined in constants.py
    report_defaults = {
        name: {
            "description": description,
            "icon": icon,
        }
        for name, description, icon in c.REPORT_TYPES
    }

    return [
        {
            "id": row.report_type_id,
            "name": row.report_name,
            "description": row.description or report_defaults.get(
                row.report_name, {}
            ).get("description", ""),
            "icon": report_defaults.get(
                row.report_name, {}
            ).get("icon", "file-text"),
        }
        for row in rows
    ]



# ======================================================================================
# Activity and error logs
# ======================================================================================

def log_event(
    db: Session,
    action: str,
    module: str,
    status: str = "Completed",
    details: str = "",
    *,
    user: m.User | None = None,
    session_id: str | None = None,
    attempted_login: str | None = None,
    role_id: int | None = None,
) -> m.ActivityLog:
    """Write to the new activity_log table.

    The schema has no session_id or attempted_login columns. Those values,
    when provided, are retained in details instead.
    """
    extra = details or ""
    if session_id:
        extra = f"{extra} | Session: {session_id}".strip(" |")
    if attempted_login and user is None:
        extra = f"{extra} | Login: {attempted_login}".strip(" |")

    row = m.ActivityLog(
        activity_id=next_id(db, "ACT"),
        timestamp=utcnow(),
        user_id=user.user_id if user else None,
        role_id=(
            role_id if role_id is not None
            else (user.role_id if user else None)
        ),
        screen_id=_screen_id(module),
        action=action[:150],
        reference_id=session_id[:50] if session_id else None,
        details=extra or None,
        status=status if status in {"Completed", "Failed", "Pending"}
        else "Completed",
    )
    db.add(row)
    db.flush()
    return row


def log_error(
    db: Session,
    module: str,
    error_type: str,
    severity: str,
    message: str,
) -> m.ErrorLog:
    """Write to the new error_log table; severity is not a stored column."""
    details = f"[{severity}] {message}" if severity else message

    row = m.ErrorLog(
        error_id=next_id(db, "ERR"),
        timestamp=utcnow(),
        user_id=None,
        role_id=None,
        screen_id=_screen_id(module),
        error_type=error_type[:100],
        message=details,
        status="Open",
    )
    db.add(row)
    db.flush()
    return row



def activity_json(
    row: m.ActivityLog,
    user_name: str | None = None,
) -> dict:
    return {
        "id": row.activity_id,
        "at": iso(row.timestamp),
        "sessionId": row.reference_id,
        "userId": row.user_id,
        "userName": user_name or "Unknown",
        "roleId": row.role_id,
        "action": row.action,
        "module": row.screen_id,
        "details": row.details,
        "status": row.status,
    }



def error_json(row: m.ErrorLog) -> dict:
    message = row.message or ""
    severity = "Error"

    # log_error() stores severity in the message as "[severity] message".
    if message.startswith("[") and "]" in message:
        end = message.find("]")
        severity = message[1:end].strip() or "Error"
        message = message[end + 1:].strip()

    return {
        "id": row.error_id,
        "at": iso(row.timestamp),
        "module": row.screen_id,
        "type": row.error_type,
        "severity": severity,
        "message": message,
        "status": row.status,
        "notes": None,
    }



# ======================================================================================
# Sales
# ======================================================================================

def sales_bounds(db: Session) -> tuple[str, str]:
    first, last = db.execute(
        select(
            func.min(m.SalesRecord.sale_date),
            func.max(m.SalesRecord.sale_date),
        ).where(m.SalesRecord.record_status == "Cleaned")
    ).one()

    if first is None:
        return DEFAULT_BOUNDS
    return day(first), day(last)


def _sales_query(f: Filters | None):
    revenue = (
        m.SalesRecord.units
        * m.SalesRecord.unit_price
        * (1 - m.SalesRecord.discount_rate)
    )

    query = (
        select(
            m.SalesRecord.sale_id,
            m.SalesRecord.sale_date,
            m.SalesRecord.sku,
            m.ProductFamily.family_name.label("category"),
            m.SalesRecord.region.label("region"),
            m.SalesRecord.units,
            m.SalesRecord.unit_price,
            m.SalesRecord.discount_rate,
            revenue.label("net_revenue"),
            m.SalesRecord.dataset_id,
            m.Product.product_name.label("product_name"),
        )
        .join(m.Product, m.Product.sku == m.SalesRecord.sku)
        .join(
            m.ProductFamily,
            m.ProductFamily.family_id == m.Product.family_id,
        )
        .where(m.SalesRecord.record_status == "Cleaned")
    )

    if f is not None:
        query = query.where(
            m.SalesRecord.sale_date >= date.fromisoformat(f.start),
            m.SalesRecord.sale_date <= date.fromisoformat(f.end),
        )
        if f.category:
            query = query.where(m.ProductFamily.family_name.in_(f.category))
        if f.sku:
            query = query.where(m.SalesRecord.sku.in_(f.sku))
        if f.region:
            query = query.where(m.SalesRecord.region.in_(f.region))

    return query


def sale_json(row) -> dict:
    return {
        "id": row.sale_id,
        "date": day(row.sale_date),
        "sku": row.sku,
        "category": row.category,
        "location": None,
        "region": row.region,
        "channel": None,
        "units": row.units,
        "unitPrice": num(row.unit_price),
        "discountRate": num(row.discount_rate),
        "netRevenue": num(row.net_revenue),
        "datasetId": row.dataset_id,
        "productName": row.product_name,
    }


def load_sales(db: Session, f: Filters | None = None) -> list[dict]:
    rows = db.execute(
        _sales_query(f).order_by(
            m.SalesRecord.sale_date, m.SalesRecord.sku
        )
    ).all()
    return [sale_json(row) for row in rows]


def sales_for_sku(
    db: Session, sku: str, start: str, end: str
) -> list[dict]:
    rows = db.execute(
        select(
            m.SalesRecord.sale_date,
            m.SalesRecord.units,
            m.SalesRecord.dataset_id,
        ).where(
            m.SalesRecord.sku == sku,
            m.SalesRecord.record_status == "Cleaned",
            m.SalesRecord.sale_date >= date.fromisoformat(start),
            m.SalesRecord.sale_date <= date.fromisoformat(end),
        ).order_by(m.SalesRecord.sale_date)
    ).all()

    return [
        {
            "date": day(row.sale_date),
            "sku": sku,
            "units": row.units,
            "datasetId": row.dataset_id,
        }
        for row in rows
    ]


def sales_totals(db: Session, f: Filters) -> dict:
    query = _sales_query(f).subquery()
    revenue, units, records, skus = db.execute(
        select(
            func.sum(query.c.net_revenue),
            func.sum(query.c.units),
            func.count(),
            func.count(func.distinct(query.c.sku)),
        )
    ).one()

    return {
        "revenue": float(revenue or 0),
        "units": int(units or 0),
        "records": int(records or 0),
        "skus": int(skus or 0),
    }


# ======================================================================================
# Inventory and reorders
# ======================================================================================

def _latest_inventory_subquery():
    return (
        select(
            m.Inventory.sku,
            func.max(m.Inventory.snapshot_date).label("latest_date"),
        )
        .group_by(m.Inventory.sku)
        .subquery()
    )


def _inventory_rows(db: Session):
    latest = _latest_inventory_subquery()

    return db.execute(
        select(m.Inventory, m.Product, m.ProductFamily.family_name)
        .join(
            latest,
            (latest.c.sku == m.Inventory.sku)
            & (latest.c.latest_date == m.Inventory.snapshot_date),
        )
        .join(m.Product, m.Product.sku == m.Inventory.sku)
        .join(
            m.ProductFamily,
            m.ProductFamily.family_id == m.Product.family_id,
        )
        .order_by(m.Product.sku)
    ).all()



def inventory_json(
    inv: m.Inventory,
    product: m.Product,
    category: str,
) -> dict:
    derived = derive(
        inv.stock,
        product.reorder_level,
        product.safety_stock,
        inv.demand_30d,
    )

    return {
        "sku": product.sku,
        "name": product.product_name,
        "category": category,
        "region": "All",
        "unitPrice": num(product.unit_price),
        "unitCost": num(product.unit_cost),
        "reorder": product.reorder_level,
        "safety": product.safety_stock,
        "stock": inv.stock,
        "demand": inv.demand_30d,
        "snapshotDate": day(inv.snapshot_date),
        **derived,
    }



def load_inventory(db: Session) -> list[dict]:
    return [inventory_json(*row) for row in _inventory_rows(db)]


def inventory_item(db: Session, sku: str) -> dict | None:
    return next(
        (item for item in load_inventory(db) if item["sku"] == sku),
        None,
    )


def catalog(db: Session) -> list[dict]:
    return [
        {
            key: item[key]
            for key in (
                "sku", "name", "category", "location",
                "region", "channel", "unitPrice",
            )
        }
        for item in load_inventory(db)
    ]


def current_snapshot_month(db: Session) -> str:
    latest = db.execute(
        select(func.max(m.Inventory.snapshot_date))
    ).scalar()
    return latest.strftime("%Y-%m") if latest else utcnow().strftime("%Y-%m")


def sync_snapshot(
    db: Session,
    sku: str,
    stock: int,
    reorder: int,
    safety: int,
) -> None:
    """Update today's inventory snapshot or insert it if it doesn't exist."""
    today = utcnow().date()
    row = db.get(m.Inventory, (sku, today))

    latest = db.execute(
        select(m.Inventory)
        .where(m.Inventory.sku == sku)
        .order_by(m.Inventory.snapshot_date.desc())
        .limit(1)
    ).scalar_one_or_none()

    demand = latest.demand_30d if latest else 0

    if row is None:
        row = m.Inventory(
            sku=sku,
            snapshot_date=today,
            stock=stock,
            demand_30d=demand,
            status=inventory_status(stock, reorder, safety),
        )
        db.add(row)
    else:
        row.stock = stock
        row.status = inventory_status(stock, reorder, safety)

    db.flush()



def load_snapshots(
    db: Session,
    start: str | None = None,
    end: str | None = None,
) -> list[dict]:
    query = (
        select(m.Inventory)
        .order_by(m.Inventory.snapshot_date, m.Inventory.sku)
    )

    if start:
        start_date = date.fromisoformat(f"{start}-01")
        query = query.where(
            m.Inventory.snapshot_date >= start_date
        )

    if end:
        year, month = map(int, end.split("-"))
        if month == 12:
            end_date = date(year + 1, 1, 1)
        else:
            end_date = date(year, month + 1, 1)

        query = query.where(
            m.Inventory.snapshot_date < end_date
        )

    grouped = defaultdict(list)

    for row in db.execute(query).scalars():
        grouped[row.snapshot_date].append({
            "sku": row.sku,
            "stock": row.stock,
            "status": row.status,
        })

    return [
        {
            "month": day(snapshot_date)[:7],
            "asOf": day(snapshot_date),
            "items": items,
        }
        for snapshot_date, items in sorted(grouped.items())
    ]


def reorder_json(row: m.Reorder) -> dict:
    return {
        "id": row.reorder_id,
        "sku": row.sku,
        "quantity": row.quantity,
        "supplier": row.supplier,
        "status": row.status,
        "orderedAt": iso(row.ordered_at),
        "deliveredAt": iso(row.delivered_at),
        "userId": row.ordered_by,
        "userName": row.orderer.full_name if hasattr(row, "orderer") and row.orderer else _user_name_from_row(row),
    }


def _user_name_from_row(row):
    # The schema has no ORM relationship named orderer.
    return None


def load_reorders(db: Session) -> list[dict]:
    rows = db.execute(
        select(m.Reorder).order_by(
            m.Reorder.ordered_at.desc(), m.Reorder.reorder_id.desc()
        )
    ).scalars()
    result = []
    for row in rows:
        item = reorder_json(row)
        item["userName"] = _user_name(db, row.ordered_by)
        result.append(item)
    return result


def category_json(
    db: Session,
    category: m.ProductFamily,
    counts: dict | None = None,
) -> dict:
    if counts is None:
        counts = dict(
            db.execute(
                select(m.Product.family_id, func.count())
                .group_by(m.Product.family_id)
            ).all()
        )

    return {
        "id": category.family_id,
        "name": category.family_name,
        "description": category.description,
        "status": category.status,
        "products": int(counts.get(category.family_id, 0)),
    }


def load_categories(db: Session) -> list[dict]:
    counts = dict(
        db.execute(
            select(m.Product.family_id, func.count())
            .group_by(m.Product.family_id)
        ).all()
    )
    rows = db.execute(
        select(m.ProductFamily).order_by(m.ProductFamily.family_id)
    ).scalars()
    return [category_json(db, row, counts) for row in rows]


def location_for(db: Session, location_name: str, region_name: str):
    """Legacy helper: location entities do not exist in ERD v3."""
    return None


# ======================================================================================
# Forecasts
# ======================================================================================

def dataset_file_names(db: Session) -> dict:
    return dict(
        db.execute(
            select(m.Dataset.dataset_id, m.Dataset.file_name)
        ).all()
    )


def _forecast_groups(db: Session, forecast_id: str | None = None):
    query = select(m.Forecast).order_by(
        m.Forecast.generated_at.desc(),
        m.Forecast.forecast_id.desc(),
        m.Forecast.forecast_date,
    )
    if forecast_id:
        query = query.where(m.Forecast.forecast_id == forecast_id)

    grouped = defaultdict(list)
    for row in db.execute(query).scalars():
        grouped[row.forecast_id].append(row)

    return grouped


def forecast_json(
    rows: list[m.Forecast],
    points=None,
    sources=None,
    file_names=None,
) -> dict:
    """Build one API forecast object from all daily rows of a forecast_id."""
    if not rows:
        return {}

    rows = sorted(rows, key=lambda row: row.forecast_date)
    first = rows[0]
    end = first.history_end
    points = [
        {
            "date": day(row.forecast_date),
            "predicted": row.predicted_units,
        }
        for row in rows
    ]

    return {
        "id": first.forecast_id,
        "sku": first.sku,
        "model": first.model,
        "horizon": first.horizon_days,
        "status": "Completed",
        "startDate": day(first.history_start),
        "endDate": day(first.history_end),
        "configuration": {"horizon": first.horizon_days},
        "metrics": {
            "mae": num(first.mae),
            "rmse": num(first.rmse),
            "mape": num(first.mape),
        },
        "evaluation": {"holdoutDays": None},
        "points": points,
        "lineage": {
            "records": 0,
            "sources": [],
            "waiting": [],
        },
        "generatedAt": iso(first.generated_at),
        "generatedBy": {
            "id": first.generated_by,
            "name": _user_name_from_forecast(first),
        },
    }


def _user_name_from_forecast(row):
    # A lookup is done in load_forecasts below.
    return None


def load_forecasts(
    db: Session,
    forecast_id: str | None = None,
) -> list[dict]:
    groups = _forecast_groups(db, forecast_id)
    result = []

    for rows in groups.values():
        item = forecast_json(rows)
        item["generatedBy"]["name"] = _user_name(db, item["generatedBy"]["id"])
        result.append(item)

    return result


def forecast_lineage(
    db: Session,
    sku: str,
    start: str,
    end: str,
) -> dict:
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)

    used = sales_for_sku(db, sku, start, end)
    names = dataset_file_names(db)

    sources = by_source(used, names)

    waiting_rows = db.execute(
        select(
            m.SalesRecord.sale_date,
            m.SalesRecord.dataset_id,
        ).where(
            m.SalesRecord.sku == sku,
            m.SalesRecord.record_status == "Pending",
            m.SalesRecord.sale_date >= start_date,
            m.SalesRecord.sale_date <= end_date,
        )
    ).all()

    waiting = [
        {
            "date": day(row.sale_date),
            "datasetId": row.dataset_id,
        }
        for row in waiting_rows
    ]

    return {
        "records": len(used),
        "sources": sources,
        "waiting": by_source(waiting, names),
    }


# ======================================================================================
# Datasets
# ======================================================================================

def _dataset_usage(db: Session) -> dict[str, dict]:
    usage = {}

    def entry(dataset_id):
        return usage.setdefault(
            dataset_id,
            {
                "recordsInHistory": 0,
                "inHistory": set(),
                "forecasted": set(),
                "forecastIds": [],
                "forecastedAt": None,
            },
        )

    for dataset_id, sku, count in db.execute(
        select(
            m.SalesRecord.dataset_id,
            m.SalesRecord.sku,
            func.count(),
        )
        .where(m.SalesRecord.record_status == "Cleaned")
        .group_by(m.SalesRecord.dataset_id, m.SalesRecord.sku)
    ).all():
        item = entry(dataset_id)
        item["recordsInHistory"] += int(count)
        item["inHistory"].add(sku)

    # The new schema does not record dataset-to-forecast lineage.
    # Forecasts are linked to SKUs, so only the available run information
    # can be returned here.
    forecast_rows = db.execute(
        select(
            m.Forecast.forecast_id,
            m.Forecast.sku,
            m.Forecast.generated_at,
            m.Forecast.history_start,
            m.Forecast.history_end,
        )
        .order_by(m.Forecast.generated_at.desc())
    ).all()

    for forecast_id, sku, generated_at, history_start, history_end in forecast_rows:
        dataset_rows = db.execute(
            select(m.SalesRecord.dataset_id)
            .where(
                m.SalesRecord.sku == sku,
                m.SalesRecord.record_status == "Cleaned",
                m.SalesRecord.sale_date >= history_start,
                m.SalesRecord.sale_date <= history_end,
            )
            .distinct()
        ).scalars().all()

        for dataset_id in dataset_rows:
            item = entry(dataset_id)
            item["forecasted"].add(sku)
            if forecast_id not in item["forecastIds"]:
                item["forecastIds"].append(forecast_id)
            if (
                item["forecastedAt"] is None
                or generated_at > item["forecastedAt"]
            ):
                item["forecastedAt"] = generated_at

    return usage


def dataset_json(
    d: m.Dataset,
    usage: dict | None,
    pending_count: int,
    new_products: list[str],
) -> dict:
    u = usage or {
        "recordsInHistory": 0,
        "inHistory": set(),
        "forecasted": set(),
        "forecastIds": [],
        "forecastedAt": None,
    }

    checks = None

    validation = "Pending" if d.cleaning_status == "Pending" else "Passed"
    skus = sorted(u["inHistory"] | u["forecasted"])
    forecasted = sorted(u["forecasted"])

    summary = None
    if d.cleaning_status == "Completed":
        summary = {
            "inputRecords": u["recordsInHistory"],
            "excludedAtValidation": None,
            "outliersCapped": None,
            "replaced": None,
            "skipped": None,
            "added": u["recordsInHistory"],
            "cleanedBy": _user_name_from_dataset(d),
            "cleanedAt": iso(d.cleaned_at),
        }

    first_date = None
    last_date = None
    product_count = len(skus)

    coverage_rows = db_coverage_placeholder = None
    # Dataset coverage is derived by load_datasets, which has access to db.

    return {
        "id": d.dataset_id,
        "fileName": d.file_name,
        "uploadedAt": iso(d.uploaded_at),
        "uploaderId": d.uploaded_by,
        "uploader": _user_name_from_dataset_uploader(d),
        "recordCount": u["recordsInHistory"] + pending_count,
        "validation": validation,
        "checks": checks,
        "coverage": None,
        "cleaning": d.cleaning_status,
        "cleanedAt": iso(d.cleaned_at),
        "cleaningSummary": summary,
        "pendingCount": pending_count,
        "newProducts": new_products,
        "forecasting": forecasting_status(
            validation, d.cleaning_status, skus, forecasted
        ),
        "forecastedAt": iso(u["forecastedAt"]),
        "lineage": {
            "recordsInHistory": u["recordsInHistory"],
            "skus": skus,
            "forecastedSkus": forecasted,
            "forecastIds": u["forecastIds"],
        },
        "error": None,
    }


def _user_name_from_dataset(d: m.Dataset):
    return None


def _user_name_from_dataset_uploader(d: m.Dataset):
    return None


def load_datasets(
    db: Session,
    dataset_id: str | None = None,
) -> list[dict]:
    query = select(m.Dataset).order_by(
        m.Dataset.uploaded_at.desc(), m.Dataset.dataset_id.desc()
    )
    if dataset_id:
        query = query.where(m.Dataset.dataset_id == dataset_id)

    datasets = db.execute(query).scalars().all()
    usage = _dataset_usage(db)

    pending = dict(
        db.execute(
            select(m.SalesRecord.dataset_id, func.count())
            .where(m.SalesRecord.record_status == "Pending")
            .group_by(m.SalesRecord.dataset_id)
        ).all()
    )

    added = defaultdict(list)
    # The schema has no added_from column; new-product lineage isn't stored.
    for dataset in datasets:
        uploader = db.get(m.User, dataset.uploaded_by)
        cleaner = (
            db.get(m.User, dataset.cleaned_by)
            if dataset.cleaned_by else None
        )
        item_usage = usage.get(dataset.dataset_id)

        # Populate optional names on a temporary attribute-free mapping
        # by constructing the API object, then overriding user-dependent fields.
        item = dataset_json(
            dataset,
            item_usage,
            int(pending.get(dataset.dataset_id, 0)),
            added.get(dataset.dataset_id, []),
        )
        item["uploader"] = uploader.full_name if uploader else None
        if item["cleaningSummary"] is not None:
            item["cleaningSummary"]["cleanedBy"] = (
                cleaner.full_name if cleaner else None
            )

        sales_dates = db.execute(
            select(
                func.min(m.SalesRecord.sale_date),
                func.max(m.SalesRecord.sale_date),
                func.count(func.distinct(m.SalesRecord.sku)),
            ).where(
                m.SalesRecord.dataset_id == dataset.dataset_id,
                m.SalesRecord.record_status == "Cleaned",
            )
        ).one()

        if sales_dates[0] is not None:
            item["coverage"] = {
                "firstDate": day(sales_dates[0]),
                "lastDate": day(sales_dates[1]),
                "products": int(sales_dates[2] or 0),
            }

        result.append(item) if False else None

    # Build the output explicitly to avoid depending on ORM relationships.
    result = []
    for dataset in datasets:
        uploader = db.get(m.User, dataset.uploaded_by)
        cleaner = db.get(m.User, dataset.cleaned_by) if dataset.cleaned_by else None
        item = dataset_json(
            dataset,
            usage.get(dataset.dataset_id),
            int(pending.get(dataset.dataset_id, 0)),
            [],
        )
        item["uploader"] = uploader.full_name if uploader else None

        if item["cleaningSummary"] is not None:
            item["cleaningSummary"]["cleanedBy"] = (
                cleaner.full_name if cleaner else None
            )

        first_date, last_date, products = db.execute(
            select(
                func.min(m.SalesRecord.sale_date),
                func.max(m.SalesRecord.sale_date),
                func.count(func.distinct(m.SalesRecord.sku)),
            ).where(
                m.SalesRecord.dataset_id == dataset.dataset_id,
                m.SalesRecord.record_status == "Cleaned",
            )
        ).one()

        if first_date is not None:
            item["coverage"] = {
                "firstDate": day(first_date),
                "lastDate": day(last_date),
                "products": int(products or 0),
            }

        result.append(item)

    return result


def dataset_api(db: Session, dataset_id: str) -> dict | None:
    results = load_datasets(db, dataset_id)
    return results[0] if results else None


# ======================================================================================
# Reports and sessions
# ======================================================================================


def report_json(db: Session, row: m.Report) -> dict:
    try:
        filters = json.loads(row.filters) if row.filters else None
    except (ValueError, TypeError):
        filters = None

    report_type = db.execute(
        select(m.RoleReportType)
        .where(m.RoleReportType.report_type_id == row.report_type_id)
        .limit(1)
    ).scalar_one_or_none()

    user = db.get(m.User, row.user_id)

    return {
        "id": row.report_id,
        "name": report_type.report_name if report_type else "Unknown Report",
        "reportTypeId": row.report_type_id,
        "format": row.file_format,
        "generatedAt": iso(row.generated_at),
        "userId": row.user_id,
        "userName": user.full_name if user else None,
        "roleId": user.role_id if user else 0,
        "status": row.status,
        "filters": filters,
        "error": None,
    }


def session_json(row: m.SessionRow) -> dict:
    return {
        "id": row.session_id,
        "userId": row.user_id,
        "loginAt": iso(row.login_at),
        "logoutAt": iso(row.logout_at),
        "expiresAt": iso(row.expires_at),
    }


def pending_records(db: Session, dataset_id: str) -> list[m.SalesRecord]:
    """Pending upload rows are stored in sales_records in ERD v3."""
    return db.execute(
        select(m.SalesRecord).where(
            m.SalesRecord.dataset_id == dataset_id,
            m.SalesRecord.record_status == "Pending",
        )
    ).scalars().all()