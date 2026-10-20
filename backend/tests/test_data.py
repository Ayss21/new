"""Sales, filters, dashboard KPIs, inventory, snapshots and categories read from the database."""
from collections import Counter

from .conftest import seed_rows

RANGE = {"start": "2025-03-19", "end": "2025-06-18"}


def test_health_reports_database_connectivity(client):
    assert client.get("/api/health").json() == {"status": "ok", "database": "ok", "version": "1.3.0"}


def test_sales_history_covers_every_date_filter(client, as_user):
    sales = client.get("/api/sales", headers=as_user("manager")).json()
    assert len(sales) == len(seed_rows()["sales_records"])
    dates = sorted(s["date"] for s in sales)
    assert dates[0] == "2023-01-01" and dates[-1] == "2025-06-18"
    assert len({d[:7] for d in dates}) == 30  # every month from Jan 2023 to Jun 2025
    first = sales[0]
    assert set(first) == {"id", "date", "sku", "category", "location", "region", "channel", "units", "unitPrice", "discountRate", "netRevenue", "datasetId"}
    assert abs(first["netRevenue"] - round(first["units"] * first["unitPrice"] * (1 - first["discountRate"]), 2)) < 0.011


def test_multi_value_filters(client, as_user):
    h = as_user("manager")
    both = client.get("/api/sales", headers=h, params={**RANGE, "region": ["Central", "East"]}).json()
    central = client.get("/api/sales", headers=h, params={**RANGE, "region": "Central"}).json()
    east = client.get("/api/sales", headers=h, params={**RANGE, "region": "East"}).json()
    assert len(both) == len(central) + len(east) > 0
    assert {s["region"] for s in both} == {"Central", "East"}
    skus = client.get("/api/sales", headers=h, params={**RANGE, "sku": ["PP-4012", "PE-7820"], "category": ["Polymers", "Polyethylene"]}).json()
    assert {s["sku"] for s in skus} == {"PP-4012", "PE-7820"}
    # "All …" labels and empty lists mean everything
    everything = client.get("/api/sales", headers=h, params={**RANGE, "region": "All regions"}).json()
    assert len(everything) == len(client.get("/api/sales", headers=h, params=RANGE).json())
    bad = client.get("/api/sales", headers=h, params={"start": "18/06/2025"})
    assert bad.status_code == 422 and list(bad.json()["detail"]["fields"]) == ["start"]


def test_every_preset_range_has_data(client, as_user):
    h = as_user("manager")
    for start in ("2025-05-20", "2025-03-19", "2024-12-19", "2024-06-19", "2023-01-01"):
        summary = client.get("/api/dashboard/summary", headers=h, params={"start": start, "end": "2025-06-18"}).json()
        units = next(k for k in summary["kpis"] if k["id"] == "units_sold")
        assert units["value"] > 0, start


def test_store_manager_kpis(client, as_user):
    h = as_user("manager")
    res = client.get("/api/dashboard/summary", headers=h, params=RANGE).json()
    kpis = {k["id"]: k for k in res["kpis"]}
    sales = client.get("/api/sales", headers=h, params=RANGE).json()
    assert kpis["units_sold"]["value"] == sum(s["units"] for s in sales)
    assert abs(kpis["total_revenue"]["value"] - sum(s["netRevenue"] for s in sales)) < 1
    assert kpis["active_skus"]["value"] == len({s["sku"] for s in sales})
    assert kpis["sales_growth"]["format"] == "growth" and kpis["sales_growth"]["detail"] == "vs 17 Dec 2024 – 18 Mar 2025"
    central = client.get("/api/dashboard/summary", headers=h, params={**RANGE, "region": "Central"}).json()
    assert next(k for k in central["kpis"] if k["id"] == "units_sold")["value"] < kpis["units_sold"]["value"]


def test_role_kpis(client, as_user):
    analyst = {k["id"]: k for k in client.get("/api/dashboard/summary", headers=as_user("analyst"), params=RANGE).json()["kpis"]}
    assert analyst["uploaded_datasets"]["value"] == 7 and analyst["uploaded_datasets"]["detail"] == "1 waiting for cleaning"
    assert analyst["forecast_runs"]["value"] == 11
    inventory = {k["id"]: k for k in client.get("/api/dashboard/summary", headers=as_user("inventory"), params={**RANGE, "status": ["Critical", "Warning"]}).json()["kpis"]}
    assert inventory["safe_items"]["value"] == 0 and inventory["critical_items"]["value"] + inventory["low_items"]["value"] == inventory["active_skus"]["value"]
    admin = {k["id"]: k for k in client.get("/api/dashboard/summary", headers=as_user("admin")).json()["kpis"]}
    assert admin["active_users"]["value"] == 4 and admin["unresolved_errors"]["value"] == 2


def test_inventory_rules(client, as_user):
    items = client.get("/api/inventory", headers=as_user("inventory")).json()
    assert len(items) == 11
    for i in items:
        expected = "Critical" if i["stock"] <= i["safety"] * 1.15 else "Warning" if i["stock"] < i["reorder"] else "Safe"
        assert i["status"] == expected
        assert i["suggested"] == (0 if expected == "Safe" else max(0, i["demand"] + i["safety"] - i["stock"]))
    pe = next(i for i in items if i["sku"] == "PE-7820")
    assert pe["status"] == "Critical" and pe["region"] == "East" and pe["location"] == "East Hub"
    alerts = client.get("/api/inventory/alerts", headers=as_user("inventory")).json()
    assert [a["status"] for a in alerts] == sorted([a["status"] for a in alerts], key=lambda s: s != "Critical")


def test_snapshots_cover_every_month(client, as_user):
    h = as_user("inventory")
    all_months = client.get("/api/inventory/snapshots", headers=h).json()
    assert all_months[0]["month"] == "2023-01" and all_months[-1]["month"] == "2025-06" and len(all_months) == 30
    window = client.get("/api/inventory/snapshots", headers=h, params={"start": "2025-01", "end": "2025-03"}).json()
    assert [s["month"] for s in window] == ["2025-01", "2025-02", "2025-03"]
    assert Counter(i["status"] for s in all_months for i in s["items"]).keys() == {"Safe", "Warning", "Critical"}


def test_categories_count_their_products(client, as_user):
    categories = client.get("/api/categories", headers=as_user("manager")).json()
    assert {c["name"]: c["products"] for c in categories} == {"Polymers": 2, "Polyethylene": 2, "Chemicals": 3, "Agri-Nutrients": 2, "Specialties": 2}


def test_report_types_come_from_the_database(client, as_user):
    assert [t["name"] for t in client.get("/api/reports/types", headers=as_user("inventory")).json()] == ["Inventory Status Report", "Reorder Recommendation Report"]
    assert len(client.get("/api/reports/types", headers=as_user("admin")).json()) == 10
