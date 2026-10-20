"""End-to-end workflows: upload → clean → forecast (lineage), stock and reorders, administration, reports."""
import io

from openpyxl import Workbook


def csv_upload(client, headers, text, name="upload.csv"):
    return client.post("/api/datasets", headers=headers, files={"file": (name, text.encode("utf-8"), "text/csv")})


def test_upload_clean_forecast_pipeline(client, as_user):
    manager, analyst = as_user("manager"), as_user("analyst")
    res = csv_upload(client, manager, "Date,Product_ID,Units_Sold,Unit_Price,Discount_Rate\n2025-06-26,PP-4012,80,248,0\n2025-06-27,pp 4012,75,248,0.05\n2025-06-26,PE-7820,90,224,0\n", "sales_jun_26_27.csv")
    assert res.status_code == 201, res.text
    dataset = res.json()["dataset"]
    assert dataset["id"] == "DS-0008" and dataset["cleaning"] == "Pending" and dataset["pendingCount"] == 3 and dataset["forecasting"] == "Pending"
    assert res.json()["validation"]["columns"]["product"] == "Product_ID"
    # Waiting uploads aren't in the sales history yet
    assert not client.get("/api/sales", headers=manager, params={"start": "2025-06-26", "end": "2025-06-27"}).json()

    cleaned = client.post(f"/api/datasets/{dataset['id']}/clean", headers=analyst, json={"capOutliers": True, "overlap": "replace"})
    assert cleaned.status_code == 200, cleaned.text
    body = cleaned.json()
    assert body["summary"]["added"] == 3 and body["salesRange"] == {"start": "2023-01-01", "end": "2025-06-27"}
    assert body["dataset"]["lineage"]["skus"] == ["PE-7820", "PP-4012"]
    again = client.post(f"/api/datasets/{dataset['id']}/clean", headers=analyst, json={})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "not_pending"

    run = client.post("/api/forecasts", headers=analyst, json={"sku": "PP-4012", "model": "ARIMA", "horizon": 30, "startDate": "2025-03-19", "endDate": "2025-06-27", "order": [2, 1, 2]})
    assert run.status_code == 201, run.text
    run = run.json()
    assert run["id"] == "FC-0012" and len(run["points"]) == 30 and run["points"][0]["date"] == "2025-06-28"
    assert all(p["predicted"] >= 0 for p in run["points"]) and run["configuration"] == {"horizon": 30, "order": [2, 1, 2]}
    assert [s["datasetId"] for s in run["lineage"]["sources"]][-1] == "DS-0008"
    datasets = {d["id"]: d for d in client.get("/api/datasets", headers=analyst).json()}
    assert datasets["DS-0008"]["forecasting"] == "Partial" and datasets["DS-0008"]["lineage"]["forecastedSkus"] == ["PP-4012"]
    assert datasets["DS-0005"]["forecasting"] == "Completed"
    # The run set the product's 30-day demand
    item = next(i for i in client.get("/api/inventory", headers=analyst).json() if i["sku"] == "PP-4012")
    assert item["demand"] == max(1, round(sum(p["predicted"] for p in run["points"]) / 30 * 30))


def test_cleaning_the_seeded_upload_caps_the_keying_error(client, as_user):
    analyst = as_user("analyst")
    body = client.post("/api/datasets/DS-0007/clean", headers=analyst, json={"capOutliers": True, "overlap": "replace"}).json()
    assert body["summary"]["outliersCapped"] == 1 and body["summary"]["added"] == 63 and body["summary"]["excludedAtValidation"] == 2
    lineage = client.get("/api/forecasts/lineage", headers=analyst, params={"sku": "PP-4012", "start": "2025-06-01", "end": "2025-06-25"}).json()
    assert lineage["waiting"] == [] and [s["datasetId"] for s in lineage["sources"]] == ["DS-0005", "DS-0007"]


def test_uploads_of_any_layout_and_new_products(client, as_user):
    manager = as_user("manager")
    text = (
        "Date,Store ID,Product ID,Category,Region,Inventory Level,Units Sold,Units Ordered,Price,Discount,Weather Condition\n"
        "2025-06-26,S001,P0001,Snacks,North,231,12,20,4.00,10,Sunny\n"
        "2025-06-26,S002,P0001,Snacks,North,150,7,20,4.00,0,Rainy\n"
        "2025-06-26,S001,P0002,Beverages,South,204,5,10,2.50,0,Sunny\n"
        "2025-06-27,S001,P0001,Snacks,North,219,9,0,4.00,0,Sunny\n"
        "2025-06-27,S002,P0001,Snacks,North,143,6,0,4.00,0,Cloudy\n"
        "2025-06-27,S001,P0002,Beverages,South,199,4,10,2.50,5,Sunny\n"
        "2025-06-27,S001,pp4012,Polymers,Central,1450,40,0,248,0,Sunny\n"
    )
    res = csv_upload(client, manager, text, "retail_store_inventory.csv").json()
    assert res["dataset"]["newProducts"] == ["P0001", "P0002"]
    assert res["validation"]["combined"] == 2 and res["dataset"]["recordCount"] == 5
    inventory = {i["sku"]: i for i in client.get("/api/inventory", headers=manager).json()}
    p1 = inventory["P0001"]
    assert (p1["category"], p1["location"], p1["region"], p1["unitCost"], p1["stock"], p1["unitPrice"]) == ("Snacks", "S001", "North", None, 362, 4)
    assert (p1["reorder"], p1["safety"], p1["demand"], p1["status"]) == (238, 119, 510, "Safe")
    categories = {c["name"] for c in client.get("/api/categories", headers=manager).json()}
    assert {"Snacks", "Beverages"} <= categories

    # An Excel workbook with a title row above the header, day-first dates and a total row
    workbook = Workbook()
    sheet = workbook.active
    for row in [["June sales"], ["Order Date", "SKU", "Qty", "Unit Price"], ["28/06/2025", "PE-7820", 15, 224], ["29/06/2025", "PE-7820", 18, 224], ["Total", "", 33, ""]]:
        sheet.append(row)
    data = io.BytesIO()
    workbook.save(data)
    xlsx = client.post("/api/datasets", headers=manager, files={"file": ("june.xlsx", data.getvalue())}).json()
    assert xlsx["dataset"]["coverage"] == {"firstDate": "2025-06-28", "lastDate": "2025-06-29", "products": 1}


def test_rejected_uploads_are_recorded(client, as_user):
    manager = as_user("manager")
    res = csv_upload(client, manager, "Date,Units\n2025-06-26,4\n", "broken.csv")
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "invalid_file" and detail["message"].startswith("Couldn't find a product column")
    assert detail["dataset"]["validation"] == "Failed" and detail["dataset"]["forecasting"] == "Not started"
    rows = csv_upload(client, manager, "Date,SKU,Qty\n2025-06-26,PP-4012,lots\n31/31/2025,PP-4012,3\n2025-06-27,PP-4012,many\n", "bad_rows.csv").json()["detail"]
    assert rows["message"] == 'None of the 3 rows could be used: 2 have a number that can\'t be used (such as "lots"); 1 has a date that can\'t be read (such as "31/31/2025").'
    assert client.post("/api/datasets", headers=manager, files={"file": ("x.pdf", b"%PDF-1.7 ...")}).json()["detail"]["code"] == "unsupported_file"
    errors = client.get("/api/errors", headers=as_user("admin")).json()
    assert errors[0]["module"] == "Sales Upload" and errors[0]["type"] == "Invalid file"


def test_forecast_validation_compare_and_recommendation(client, as_user):
    analyst = as_user("analyst")
    bad = client.post("/api/forecasts", headers=analyst, json={"sku": "NOPE", "model": "Magic", "horizon": 900, "startDate": "2025-03-19", "endDate": "2025-06-18"})
    assert bad.status_code == 422 and set(bad.json()["detail"]["fields"]) == {"sku", "model", "horizon"}
    short = client.post("/api/forecasts", headers=analyst, json={"sku": "PP-4012", "model": "Moving Average", "horizon": 7, "startDate": "2025-06-10", "endDate": "2025-06-18"})
    assert short.status_code == 422 and short.json()["detail"]["code"] == "forecast_failed"
    compare = client.post("/api/forecasts/compare", headers=analyst, json={"sku": "PP-4012", "horizon": 30, "startDate": "2025-03-19", "endDate": "2025-06-18", "windowSize": 7, "order": [2, 1, 2]}).json()
    assert [r["model"] for r in compare["results"]] == ["Moving Average", "Linear Regression", "ARIMA"] and all(r["status"] == "Completed" for r in compare["results"])
    rec = client.post("/api/forecasts/recommendation", headers=analyst, json={"skus": ["PP-4012", "PE-7820", "UNKNOWN"], "filters": {"start": "2025-03-19", "end": "2025-06-18"}}).json()
    assert rec["skus"] == ["PP-4012", "PE-7820"] and rec["recommended"] in rec["ranked"] and rec["testDays"] == 14
    one_week = client.post("/api/forecasts/recommendation", headers=analyst, json={"skus": ["PP-4012"], "filters": {"start": "2025-06-12", "end": "2025-06-18"}}).json()
    assert one_week["recommended"] is None and "at least 7" in one_week["reason"]


def test_stock_update_and_reorder_delivery(client, as_user):
    inventory = as_user("inventory")
    updated = client.patch("/api/inventory/PP-4012", headers=inventory, json={"stock": 1450, "reason": "Cycle count", "notes": "Aisle 4"}).json()
    assert updated["stock"] == 1450 and updated["status"] == "Safe"
    bad = client.patch("/api/inventory/PP-4012", headers=inventory, json={"stock": -1, "reason": ""})
    assert set(bad.json()["detail"]["fields"]) == {"stock", "reason"}
    order = client.post("/api/reorders", headers=inventory, json={"sku": "PE-7820", "quantity": 600, "supplier": "Gulf Polymers Supply"})
    assert order.status_code == 201 and order.json()["id"] == "RO-0004" and order.json()["status"] == "Ordered"
    delivered = client.patch("/api/reorders/RO-0004", headers=inventory, json={"status": "Delivered"}).json()
    assert delivered["status"] == "Delivered" and delivered["deliveredAt"]
    item = next(i for i in client.get("/api/inventory", headers=inventory).json() if i["sku"] == "PE-7820")
    assert item["stock"] == 184 + 600
    june = client.get("/api/inventory/snapshots", headers=inventory, params={"start": "2025-06"}).json()[0]
    assert next(i for i in june["items"] if i["sku"] == "PE-7820")["stock"] == 784
    assert client.patch("/api/reorders/RO-0004", headers=inventory, json={"status": "Delivered"}).json()["detail"]["code"] == "invalid_transition"


def test_administration(client, as_user):
    admin = as_user("admin")
    created = client.post("/api/users", headers=admin, json={"name": "José María Núñez", "department": "Commercial", "roleId": 1, "status": "Active", "password": "Welcome123!"})
    assert created.status_code == 201 and created.json()["id"] == "USR-3382" and created.json()["email"] == "jose.nunez@demo.demandiq"
    assert client.post("/api/auth/login", json={"login": "USR-3382", "password": "Welcome123!", "roleId": 1}).status_code == 200
    assert client.patch("/api/users/USR-1001", headers=admin, json={"status": "Inactive"}).json()["detail"]["code"] in ("last_admin", "own_account")
    assert client.patch("/api/users/USR-1001", headers=admin, json={"roleId": 2}).json()["detail"]["code"] in ("last_admin", "own_role")
    cat = client.post("/api/categories", headers=admin, json={"name": "Specialty Resins", "description": "High-performance grades"}).json()
    assert cat == {"id": "CAT-006", "name": "Specialty Resins", "description": "High-performance grades", "status": "Active", "products": 0}
    renamed = client.patch("/api/categories/CAT-001", headers=admin, json={"name": "Thermoplastics"}).json()
    assert renamed["products"] == 2
    sales = client.get("/api/sales", headers=admin, params={"start": "2025-06-01", "end": "2025-06-18", "category": "Thermoplastics"}).json()
    assert {s["sku"] for s in sales} == {"PP-4012", "EV-8843"}
    matrix = client.patch("/api/roles/permissions", headers=admin, json={"action": "Run forecasts", "roleId": 1, "value": "No"}).json()
    assert matrix["Run forecasts"]["1"] == "No"
    assert client.patch("/api/roles/permissions", headers=admin, json={"action": "Run forecasts", "roleId": 4, "value": "Yes"}).json()["detail"]["code"] == "locked"
    screens = client.put("/api/roles/1/screens", headers=admin, json={"screens": ["SCR-01", "SCR-02", "SCR-04", "SCR-05"]}).json()
    assert screens["1"] == ["SCR-01", "SCR-02", "SCR-04", "SCR-05"]
    assert client.put("/api/roles/1/screens", headers=admin, json={"screens": ["SCR-02"]}).json()["detail"]["code"] == "locked"
    restored = client.post("/api/roles/restore-defaults", headers=admin).json()
    assert restored["screens"]["1"] == ["SCR-01", "SCR-02", "SCR-04"] and restored["permissions"]["Run forecasts"]["1"] == "View"


def test_reports_in_every_format(client, as_user):
    manager = as_user("manager")
    for fmt, content_type, magic in (("CSV", "text/csv", b"\xef\xbb\xbf\"Region\""), ("XLSX", "spreadsheetml", b"PK"), ("PDF", "application/pdf", b"%PDF")):
        res = client.post("/api/reports", headers=manager, json={"name": "Sales by Region", "format": fmt, "filters": {"start": "2025-03-19", "end": "2025-06-18", "region": ["Central", "East"]}})
        assert res.status_code == 202 and res.json()["status"] == "Processing"
        report = client.get(f"/api/reports/{res.json()['id']}", headers=manager).json()
        assert report["status"] == "Completed"
        file = client.get(f"/api/reports/{report['id']}/file", headers=manager)
        assert file.status_code == 200 and content_type in file.headers["content-type"] and file.content.startswith(magic)
        assert file.headers["content-disposition"] == f'attachment; filename="sales-by-region.{fmt.lower()}"'
    csv = client.get("/api/reports/RPT-022/file", headers=manager).content.decode("utf-8-sig").splitlines()
    assert csv[0] == '"Region","Units","Net Revenue"' and len(csv) == 3
    empty = client.post("/api/reports", headers=manager, json={"name": "Sales Summary", "format": "XLSX", "filters": {"start": "2020-01-01", "end": "2020-01-31"}}).json()
    failed = client.get(f"/api/reports/{empty['id']}", headers=manager).json()
    assert failed["status"] == "Failed" and failed["error"] == "There is no matching data to export."
    assert client.get(f"/api/reports/{empty['id']}/file", headers=manager).json()["detail"]["code"] == "report_failed"
    # Seeded reports are built again from their filters when downloaded
    assert client.get("/api/reports/RPT-014/file", headers=manager).status_code == 200
    assert client.get("/api/reports/RPT-019/file", headers=manager).json()["detail"]["code"] == "report_processing"
    # Other users' reports are hidden; the Admin sees everyone's
    assert client.get("/api/reports/RPT-022", headers=as_user("analyst")).status_code == 404
    assert len(client.get("/api/reports", headers=as_user("admin")).json()) == 25
    mail = client.post("/api/reports/email", headers=manager, json={"name": "Sales Summary", "format": "PDF", "filters": {"start": "2025-06-01", "end": "2025-06-18"}, "recipients": ["lead@demandiq.test"], "subject": "June"})
    assert mail.status_code == 202 and mail.json()["status"] == "Queued"
    assert client.post("/api/reports/email", headers=manager, json={"name": "Sales Summary", "format": "PDF", "recipients": ["not-an-email"]}).status_code == 422


def test_every_report_type_builds(client, as_user):
    admin = as_user("admin")
    for report_type in client.get("/api/reports/types", headers=admin).json():
        res = client.post("/api/reports", headers=admin, json={"name": report_type["name"], "format": "CSV", "filters": {"start": "2025-03-19", "end": "2025-06-18"}}).json()
        assert client.get(f"/api/reports/{res['id']}", headers=admin).json()["status"] == "Completed", report_type["name"]


def test_logs(client, as_user):
    manager = as_user("manager")
    event = client.post("/api/activity", headers=manager, json={"action": "Screen access denied", "details": "#/administration · Store Manager"})
    assert event.status_code == 201 and event.json()["module"] == "Authentication" and event.json()["status"] == "Failed"
    assert client.post("/api/activity", headers=manager, json={"action": "Anything"}).status_code == 422
    admin = as_user("admin")
    sessions = client.get("/api/sessions", headers=admin).json()
    assert sessions[0]["logoutAt"] is None and len(sessions) == 14
    updated = client.patch("/api/errors/ERR-0010", headers=admin, json={"status": "Resolved", "notes": "Order reduced"}).json()
    assert updated["status"] == "Resolved" and updated["notes"] == "Order reduced"
    actions = [e["action"] for e in client.get("/api/activity", headers=admin).json()[:3]]
    assert "Error status updated" in actions
