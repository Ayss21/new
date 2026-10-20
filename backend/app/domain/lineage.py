"""Dataset lineage (src/lib/lineage.js): which uploads a forecast used, and each upload's forecasting status."""
from __future__ import annotations


def by_source(rows: list[dict], file_names: dict[str | None, str]) -> list[dict]:
    """Records grouped by the upload they came from, oldest data first."""
    groups: dict = {}
    for row in rows:
        key = row.get("datasetId")
        group = groups.get(key)
        if group is None:
            group = groups[key] = {"datasetId": key, "records": 0, "firstDate": row["date"], "lastDate": row["date"]}
        group["records"] += 1
        group["firstDate"] = min(group["firstDate"], row["date"])
        group["lastDate"] = max(group["lastDate"], row["date"])
    result = [
        {"datasetId": g["datasetId"], "fileName": file_names.get(g["datasetId"]), "records": g["records"], "firstDate": g["firstDate"], "lastDate": g["lastDate"]}
        for g in groups.values()
    ]
    result.sort(key=lambda s: (s["firstDate"], str(s["datasetId"])))
    return result


def forecasting_status(validation: str, cleaning: str, skus: list[str], forecasted: list[str]) -> str:
    if validation == "Failed":
        return "Not started"
    if cleaning != "Completed":
        return "Pending"
    if not skus:
        return "Not needed"
    if not forecasted:
        return "Pending"
    return "Completed" if len(forecasted) >= len(skus) else "Partial"
