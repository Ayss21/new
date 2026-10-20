"""Cleaning an upload (cleanDataset in src/lib/domain.js): cap extreme values per product, then merge into
the shared sales history, replacing or skipping records for a date and product that already exist."""
from __future__ import annotations

from .inventory import js_round


def quantile(ordered: list[float], q: float) -> float:
    if not ordered:
        return 0.0
    pos = (len(ordered) - 1) * q
    lo, hi = int(pos // 1), -int(-pos // 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def cap_outliers(pending: list[dict], history_units: dict[str, list[int]]) -> int:
    """Caps, in place, each pending record above Q3 + 3 × max(IQR, 1) of its product's units (history plus the
    upload, only with at least 8 values). Returns how many were capped."""
    capped = 0
    for sku in {row["sku"] for row in pending}:
        values = sorted(history_units.get(sku, []) + [row["units"] for row in pending if row["sku"] == sku])
        if len(values) < 8:
            continue
        q1, q3 = quantile(values, 0.25), quantile(values, 0.75)
        upper = q3 + 3 * max(q3 - q1, 1)
        for row in pending:
            if row["sku"] == sku and row["units"] > upper:
                row["units"] = js_round(upper)
                capped += 1
    return capped
