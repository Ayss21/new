"""The global filters: start, end and the lists category, sku, region, model, status (docs/API_CONTRACT.md,
section 1). An empty or missing list means all; missing dates mean the whole sales history."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from ..core.errors import fail

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def filter_list(value) -> list[str]:
    """Picked values: [] for nothing or an "All …" label; a single string is a list of one."""
    if value is None or value == "":
        return []
    values = value if isinstance(value, (list, tuple)) else [value]
    return [str(v) for v in values if v not in (None, "") and not str(v).startswith("All ")]


def valid_date(text) -> bool:
    if not isinstance(text, str) or not ISO_DATE.match(text):
        return False
    try:
        date.fromisoformat(text)
        return True
    except ValueError:
        return False


@dataclass
class Filters:
    start: str
    end: str
    category: list[str] = field(default_factory=list)
    sku: list[str] = field(default_factory=list)
    region: list[str] = field(default_factory=list)
    model: list[str] = field(default_factory=list)
    status: list[str] = field(default_factory=list)

    def as_json(self) -> dict:
        out: dict = {"start": self.start, "end": self.end}
        for key in ("category", "sku", "region", "model", "status"):
            if getattr(self, key):
                out[key] = getattr(self, key)
        return out


def parse_filters(query: dict, bounds: tuple[str, str]) -> Filters:
    """From query parameters or a POST body's `filters` object. Bad dates → 422 validation_error."""
    query = query or {}
    for key in ("start", "end"):
        if query.get(key) and not valid_date(query[key]):
            fail(422, "validation_error", f"{key}: use a date like 2025-06-18.", fields={key: "Use a date like 2025-06-18."})
    start = query.get("start") or bounds[0]
    end = query.get("end") or bounds[1]
    if start > end:
        fail(422, "validation_error", "start must be on or before end.", fields={"start": "Must be on or before end."})
    return Filters(start=start, end=end, **{key: filter_list(query.get(key)) for key in ("category", "sku", "region", "model", "status")})


def in_list(values: list[str], value) -> bool:
    return not values or value in values


def filter_inventory(items: list[dict], f: Filters, use_status: bool = True) -> list[dict]:
    return [
        row
        for row in items
        if in_list(f.category, row["category"]) and in_list(f.sku, row["sku"]) and in_list(f.region, row["region"]) and (not use_status or in_list(f.status, row["status"]))
    ]


def filter_forecasts(runs: list[dict], f: Filters, inventory: list[dict] | None) -> list[dict]:
    skus = {row["sku"] for row in filter_inventory(inventory, f, use_status=False)} if inventory is not None else None
    return [run for run in runs if in_list(f.model, run["model"]) and (skus is None or run["sku"] in skus)]


def describe(f: Filters) -> str:
    return " · ".join(", ".join(getattr(f, key)) for key in ("category", "sku", "region", "model") if getattr(f, key))
