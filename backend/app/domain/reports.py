"""What goes into each report (buildReportRows / reportMetadata in src/lib/reports.js)."""
from __future__ import annotations

from . import constants as c
from .filters import Filters, filter_forecasts, filter_inventory


def _fixed(value, digits=2):
    return "N/A" if value is None else f"{value:.{digits}f}"


def build_report_rows(name: str, f: Filters, data: dict, fmt_time) -> list[dict]:
    """data: {sales (already filtered), inventory, forecasts, activity, errors, reorders, datasets}."""
    inventory = data.get("inventory", [])
    sales = data.get("sales", [])
    scoped = filter_inventory(inventory, f)
    runs = filter_forecasts(data.get("forecasts", []), f, inventory)
    reorders = data.get("reorders", [])

    if "Reorder" in name and reorders:
        return [
            {"Order": r["id"], "SKU": r["sku"], "Quantity": r["quantity"], "Supplier": r["supplier"], "Ordered": fmt_time(r["orderedAt"]), "Ordered By": r["userName"], "Delivered": fmt_time(r["deliveredAt"]) if r["deliveredAt"] else "", "Status": r["status"]}
            for r in reorders
        ]
    if "Inventory" in name or "Reorder" in name:
        return [
            {
                "SKU": i["sku"], "Product": i["name"], "Category": i["category"], "Region": i["region"], "Warehouse": i["location"],
                "Current Stock": i["stock"], "30-day Demand": i["demand"], "Reorder Level": i["reorder"], "Safety Stock": i["safety"],
                "Suggested Reorder": i["suggested"], "Days Left": i["days"], "Status": "Low" if i["status"] == "Warning" else i["status"],
            }
            for i in scoped
        ]
    if "Forecast Accuracy" in name:
        return [
            {"Model": r["model"], "SKU": r["sku"], "Horizon": r["horizon"], "MAE": _fixed(r["metrics"]["mae"]), "RMSE": _fixed(r["metrics"]["rmse"]), "MAPE": _fixed(r["metrics"]["mape"]), "Executed": fmt_time(r["generatedAt"])}
            for r in runs
        ]
    if "Demand Forecast" in name:
        if not runs:
            return []
        run = runs[0]
        return [{"Date": p["date"], "SKU": run["sku"], "Model": run["model"], "Forecast Units": p["predicted"]} for p in run["points"]]
    if "User Activity" in name:
        return [
            {"Timestamp": fmt_time(a["at"]), "User ID": a["userId"] or "—", "User": a["userName"], "Role": c.role_name(a["roleId"]) if a["roleId"] else "—", "Action": a["action"], "Module": a["module"], "Details": a["details"], "Status": a["status"]}
            for a in data.get("activity", [])
        ]
    if "System Error" in name:
        return [
            {"Error ID": e["id"], "Timestamp": fmt_time(e["at"]), "Module": e["module"], "Type": e["type"], "Severity": e["severity"], "Message": e["message"], "Status": e["status"]}
            for e in data.get("errors", [])
        ]
    if "Data Quality" in name:
        rows = []
        for d in data.get("datasets", []):
            checks = d.get("checks")
            summary = d.get("cleaningSummary")
            lineage = d.get("lineage") or {}
            rows.append(
                {
                    "Dataset": d["fileName"], "Uploaded": fmt_time(d["uploadedAt"]), "Uploader": d["uploader"], "Records": d["recordCount"], "Validation": d["validation"],
                    "Missing": checks["missing"] if checks else "", "Duplicates": checks["duplicates"] if checks else "",
                    "Invalid": checks["invalidDates"] + checks["invalidNumeric"] if checks else "", "Cleaning": d["cleaning"],
                    "Outliers Capped": summary["outliersCapped"] if summary else "", "Forecasting": d["forecasting"],
                    "Products Forecast": f"{len(lineage.get('forecastedSkus', []))} of {len(lineage.get('skus', []))}" if lineage.get("skus") else "",
                }
            )
        return rows
    if "Sales by Region" in name:
        order: list[str] = []
        totals: dict[str, list] = {}
        for row in sales:
            if row["region"] not in totals:
                order.append(row["region"])
                totals[row["region"]] = [0, 0.0]
            totals[row["region"]][0] += row["units"]
            totals[row["region"]][1] += row["netRevenue"]
        return [{"Region": r, "Units": totals[r][0], "Net Revenue": round(totals[r][1], 2)} for r in order]
    if "Product Performance" in name:
        by_sku: dict[str, list] = {}
        for row in sales:
            entry = by_sku.setdefault(row["sku"], [0, 0.0])
            entry[0] += row["units"]
            entry[1] += row["netRevenue"]
        rows = [
            {"SKU": i["sku"], "Product": i["name"], "Category": i["category"], "Units": by_sku[i["sku"]][0], "Net Revenue": round(by_sku[i["sku"]][1], 2)}
            for i in inventory
            if by_sku.get(i["sku"], [0])[0] > 0
        ]
        return sorted(rows, key=lambda r: -r["Net Revenue"])
    stock = {i["sku"]: i["stock"] for i in scoped}
    return [
        {"Date": r["date"], "SKU": r["sku"], "Category": r["category"], "Region": r["region"], "Warehouse": r["location"], "Channel": r["channel"], "Units": r["units"], "Net Revenue": r["netRevenue"], "Current Stock": stock.get(r["sku"], "")}
        for r in sales
    ]


def report_metadata(f: Filters, user_name: str, role_id: int) -> list[str]:
    def listed(key):
        values = getattr(f, key)
        return ", ".join(values) if values else "All"

    return [
        f"Date range: {f.start} to {f.end}",
        f"Category: {listed('category')} · SKU: {listed('sku')} · Region: {listed('region')} · Model: {listed('model')}",
        f"Generated by {user_name} ({c.role_name(role_id)})",
    ]
