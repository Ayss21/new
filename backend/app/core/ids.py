
"""ID generation compatible with the current DemandIQ models."""

from __future__ import annotations

import re

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import models
from ..database import is_mssql


# Prefix -> (SQL Server sequence, digits, model column)
SEQUENCES = {
    "SES": ("", 4, models.SessionRow.session_id),
    "EVT": ("seq_event_id", 4, models.ActivityLog.activity_id),
    "ACT": ("", 6, models.ActivityLog.activity_id),
    "ERR": ("seq_error_id", 4, models.ErrorLog.error_id),
    "DS": ("seq_dataset_id", 4, models.Dataset.dataset_id),
    "RO": ("seq_reorder_id", 4, models.Reorder.reorder_id),
    "FC": ("seq_forecast_id", 4, models.Forecast.forecast_id),
    "RPT": ("seq_report_id", 3, models.Report.report_id),
    "UPL": ("seq_upload_record_id", 6, models.SalesRecord.sale_id),
    "MAIL": ("seq_email_id", 4, None),
}

_memory_counters: dict[str, int] = {}


def format_id(prefix: str, number: int, digits: int) -> str:
    return f"{prefix}-{number:0{digits}d}"


def _highest(db: Session, column, prefix: str) -> int:
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    best = 0

    for (value,) in db.execute(
        select(column).where(column.like(f"{prefix}-%"))
    ):
        match = pattern.match(value or "")
        if match:
            best = max(best, int(match.group(1)))

    return best


def next_id(db: Session, prefix: str) -> str:
    if prefix not in SEQUENCES:
        raise ValueError(f"Unknown ID prefix: {prefix}")

    sequence, digits, column = SEQUENCES[prefix]

    # Generate IDs from existing records when no SQL sequence is configured.
    if not sequence:
        start = _highest(db, column, prefix)
        number = max(_memory_counters.get(prefix, 0), start) + 1
        _memory_counters[prefix] = number
        return format_id(prefix, number, digits)

    if is_mssql(db):
        number = db.execute(
            text(f"SELECT NEXT VALUE FOR dbo.{sequence}")
        ).scalar_one()
        return format_id(prefix, int(number), digits)

    start = _highest(db, column, prefix) if column is not None else 0
    number = max(_memory_counters.get(prefix, 0), start) + 1
    _memory_counters[prefix] = number
    return format_id(prefix, number, digits)


def next_ids(db: Session, prefix: str, count: int) -> list[str]:
    """Generate multiple IDs for an upload."""
    if count <= 0:
        return []

    if prefix not in SEQUENCES:
        raise ValueError(f"Unknown ID prefix: {prefix}")

    sequence, digits, _ = SEQUENCES[prefix]

    if is_mssql(db):
        rows = db.execute(
            text(
                f"SELECT NEXT VALUE FOR dbo.{sequence} AS n "
                "FROM (SELECT TOP (:n) 1 AS x "
                "FROM sys.all_objects a "
                "CROSS JOIN sys.all_objects b) AS numbers"
            ),
            {"n": count},
        ).scalars().all()

        return [
            format_id(prefix, int(number), digits)
            for number in sorted(rows)
        ]

    return [next_id(db, prefix) for _ in range(count)]


def reset_memory_counters() -> None:
    _memory_counters.clear()


def next_user_id(db: Session) -> str:
    """Generate the next USR identifier."""
    highest = 1000

    for (value,) in db.execute(select(models.User.user_id)):
        match = re.match(r"^USR-(\d+)$", value or "", re.I)
        if match:
            highest = max(highest, int(match.group(1)))

    return f"USR-{highest + 1}"


def next_category_id(db: Session) -> str:
    """Generate the next category-compatible ID.

    Categories are represented by product families in the current schema.
    """
    highest = 0

    for (value,) in db.execute(select(models.ProductFamily.family_id)):
        match = re.match(r"^(?:CAT-|FAM-)?(\d+)$", value or "", re.I)
        if match:
            highest = max(highest, int(match.group(1)))

    return f"CAT-{highest + 1:03d}"


def count(db: Session, model) -> int:
    return db.execute(
        select(func.count()).select_from(model)
    ).scalar_one()
