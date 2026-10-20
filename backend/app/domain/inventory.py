"""Inventory rules (deriveInventory, applyForecastToInventory, inventoryForNewProduct in src/lib/domain.js)."""
from __future__ import annotations

from datetime import date


def js_round(value: float) -> int:
    """Math.round: halves go up (Python's round() goes to even)."""
    import math

    return int(math.floor(value + 0.5))


def inventory_status(stock: int, reorder: int, safety: int) -> str:
    """Critical if stock ≤ 1.15 × safety; Warning (shown as Low) if stock < reorder; otherwise Safe."""
    if stock <= safety * 1.15:
        return "Critical"
    if stock < reorder:
        return "Warning"
    return "Safe"


def derive(stock: int, reorder: int, safety: int, demand: int) -> dict:
    status = inventory_status(stock, reorder, safety)
    suggested = 0 if status == "Safe" else max(0, js_round(demand + safety - stock))
    days = max(1, js_round(stock / (demand / 30))) if demand else 1
    return {"status": status, "suggested": suggested, "days": days}


def demand_from_forecast(points: list[int]) -> int | None:
    """30-day demand after a forecast: max(1, round(average predicted per day × 30))."""
    if not points:
        return None
    per_day = sum(points) / len(points)
    return max(1, js_round(per_day * 30))


def new_product_levels(records: list[dict]) -> dict:
    """Safety stock, reorder level and 30-day demand of a product added from an upload (its sales in the file)."""
    dates = sorted(record["date"] for record in records)
    days = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days + 1 if dates else 1
    per_day = sum(record["units"] for record in records) / days
    safety = max(1, js_round(per_day * 7))
    return {"safety": safety, "reorder": max(safety + 1, js_round(per_day * 14)), "demand": max(1, js_round(per_day * 30))}
