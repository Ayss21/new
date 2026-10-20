"""Times are stored as UTC (DATETIME2 without a zone) and sent as ISO 8601 with Z, like the contract."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    """Now in UTC, without tzinfo (how DATETIME2 columns hold it), to the millisecond."""
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, now.day, now.hour, now.minute, now.second, (now.microsecond // 1000) * 1000)


def iso(value: datetime | None) -> str | None:
    """2025-06-26T05:00:00.000Z"""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    v = value
    return f"{v.year:04d}-{v.month:02d}-{v.day:02d}T{v.hour:02d}:{v.minute:02d}:{v.second:02d}.{v.microsecond // 1000:03d}Z"


def parse_iso(text: str) -> datetime:
    """"2025-06-26T05:00:00.000Z" → naive UTC datetime."""
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def day(value: date | datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value[:10]
    if isinstance(value, datetime):
        value = value.date()
    return value.isoformat()


def to_date(text: str) -> date:
    return date.fromisoformat(text[:10])


def add_days(text: str, days: int) -> str:
    return (date.fromisoformat(text) + timedelta(days=days)).isoformat()


def days_between(start: str, end: str) -> int:
    """Calendar days from start to end, both included."""
    return (date.fromisoformat(end) - date.fromisoformat(start)).days + 1


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def format_day(text: str) -> str:
    """"2025-03-19" → "19 Mar 2025" """
    return f"{int(text[8:10])} {MONTHS[int(text[5:7]) - 1]} {text[:4]}"


def format_range(start: str, end: str) -> str:
    """"19 Mar – 18 Jun 2025" (the year once when both dates share it)."""
    if start[:4] == end[:4]:
        return f"{int(start[8:10])} {MONTHS[int(start[5:7]) - 1]} – {format_day(end)}"
    return f"{format_day(start)} – {format_day(end)}"


def format_datetime(value: datetime | None, zone: str) -> str:
    """"14 Oct 2026, 10:42" in the app's time zone (as the browser shows it)."""
    if value is None:
        return ""
    local = value.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(zone))
    return f"{local.day:02d} {MONTHS[local.month - 1]} {local.year}, {local.hour:02d}:{local.minute:02d}"


def add_months(text: str, months: int) -> str:
    y, m, d = (int(part) for part in text.split("-"))
    total = (y * 12 + m - 1) + months
    ty, tm = divmod(total, 12)
    tm += 1
    import calendar

    last = calendar.monthrange(ty, tm)[1]
    return date(ty, tm, min(d, last)).isoformat()
