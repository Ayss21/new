// Contract tests: the demo backend answers like docs/API_CONTRACT.md says — paths, status codes, error
// codes, permission checks, side effects and the JSON fields of every resource. FastAPI should pass the
// same checks.
import { beforeEach, describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { compareModelsForProducts, filterSales, inventoryStatus } from "../../lib/domain";
import { salesGrowth } from "../../lib/dashboard";
import { ROUTE_LIST, handleDemoRequest } from "./server";
import { db, resetForTests } from "./db";
import { setReportDelay } from "./routes/reports";

async function call(method, path, { token, body, query, form, raw } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await handleDemoRequest({ method, path, query: query ?? {}, headers, body: payload });
  const type = res.headers.get("Content-Type") ?? "";
  const data = res.status === 204 ? null : type.includes("application/json") ? await res.json() : await res.blob();
  return { status: res.status, data, headers: res.headers };
}

const ACCOUNTS = {
  manager: ["store.manager@demo.demandiq", "Store123!", 1],
  analyst: ["analyst@demo.demandiq", "Analyze123!", 2],
  supervisor: ["inventory@demo.demandiq", "Stock123!", 3],
  admin: ["admin@demo.demandiq", "Admin123!", 4],
};

async function signIn(who, remember = false) {
  const [login, password, roleId] = ACCOUNTS[who];
  const res = await call("POST", "/auth/login", { body: { login, password, roleId, remember } });
  expect(res.status).toBe(200);
  return res.data.accessToken;
}

const detail = (res) => res.data.detail;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keys = (value) => Object.keys(value).sort();
const csvFile = (text, name = "sales.csv") => {
  const form = new FormData();
  form.append("file", new File([text], name, { type: "text/csv" }));
  return form;
};
const xlsxFile = async (rows, name = "sales.xlsx") => {
  const form = new FormData();
  const bytes = await writeXlsxFile(rows.map((row) => row.map((value) => (value instanceof Date ? { value, type: Date, format: "yyyy-mm-dd" } : { value })))).toBuffer();
  form.append("file", new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return form;
};
const RANGE = { start: "2025-03-19", end: "2025-06-18" };

// The fields of each resource, as documented
const FIELDS = {
  user: ["department", "email", "id", "initials", "name", "roleId", "status"],
  dataset: [
    "checks", "cleanedAt", "cleaning", "cleaningSummary", "coverage", "error", "fileName", "forecastedAt", "forecasting", "id",
    "lineage", "newProducts", "pendingCount", "recordCount", "uploadedAt", "uploader", "uploaderId", "validation",
  ],
  forecast: [
    "configuration", "endDate", "evaluation", "generatedAt", "generatedBy", "horizon", "id", "lineage", "metrics", "model", "points", "sku",
    "startDate", "status",
  ],
  inventory: ["category", "channel", "days", "demand", "location", "name", "region", "reorder", "safety", "sku", "status", "stock", "suggested", "unitCost", "unitPrice"],
  reorder: ["deliveredAt", "id", "orderedAt", "quantity", "sku", "status", "supplier", "userId", "userName"],
  report: ["error", "filters", "format", "generatedAt", "id", "name", "roleId", "status", "userId", "userName"],
  activity: ["action", "at", "details", "id", "module", "roleId", "sessionId", "status", "userId", "userName"],
  error: ["at", "id", "message", "module", "notes", "severity", "status", "type"],
  session: ["id", "loginAt", "logoutAt", "userId"],
  sale: ["category", "channel", "datasetId", "date", "discountRate", "id", "location", "netRevenue", "region", "sku", "unitPrice", "units"],
  category: ["description", "id", "name", "products", "status"],
  kpi: ["detail", "format", "icon", "id", "label", "tone", "value"],
};

beforeEach(() => {
  resetForTests();
  setReportDelay(0);
});

describe("routing", () => {
  it("refuses every non-public route without a token", async () => {
    const fill = (pattern) => pattern.replace(":sku", "PP-4012").replace(":roleId", "1").replace(":id", "X-1");
    const closed = ROUTE_LIST.filter((route) => !route.public);
    expect(closed.length).toBeGreaterThan(40);
    for (const route of closed) {
      const res = await call(route.method, fill(route.pattern), { body: route.method === "GET" ? undefined : {} });
      expect([route.method, route.pattern, res.status, detail(res).code]).toEqual([route.method, route.pattern, 401, "not_authenticated"]);
    }
  });

  it("lists only the public routes the contract names", () => {
    expect(ROUTE_LIST.filter((route) => route.public).map((route) => `${route.method} ${route.pattern}`)).toEqual([
      "POST /auth/login",
      "GET /auth/roles",
      "POST /auth/password-reset",
      "GET /demo/accounts",
      "POST /demo/reset",
    ]);
  });

  it("answers unknown paths, wrong methods and broken JSON in the error shape", async () => {
    const token = await signIn("admin");
    const missing = await call("GET", "/nothing-here", { token });
    expect([missing.status, detail(missing).code]).toEqual([404, "not_found"]);
    const method = await call("DELETE", "/sales", { token });
    expect([method.status, detail(method).code]).toEqual([405, "method_not_allowed"]);
    const broken = await call("POST", "/reorders", { token, raw: "{not json" });
    expect([broken.status, detail(broken).code]).toEqual([400, "invalid_json"]);
    expect(typeof detail(broken).message).toBe("string");
  });
});

describe("authentication", () => {
  it("signs in with the role and returns the token, session, user, permissions and screens", async () => {
    const res = await call("POST", "/auth/login", { body: { login: "USR-1042", password: "Analyze123!", roleId: 2 } });
    expect(res.status).toBe(200);
    expect(keys(res.data)).toEqual(["accessToken", "expiresAt", "permissions", "screens", "session", "tokenType", "user"]);
    expect(res.data.tokenType).toBe("bearer");
    expect(keys(res.data.user)).toEqual(FIELDS.user);
    expect(res.data.screens).toEqual(["SCR-01", "SCR-02", "SCR-04", "SCR-05"]);
    expect(res.data.permissions).toMatchObject({ "Upload sales": "Review", "Clean data": "Yes", "Run forecasts": "Yes", "Manage users": "No" });
    const hours = (Date.parse(res.data.expiresAt) - Date.parse(res.data.session.startedAt)) / 3600000;
    expect(hours).toBe(8);
  });

  it("keeps a remembered session for 7 days", async () => {
    const res = await call("POST", "/auth/login", { body: { login: "analyst@demo.demandiq", password: "Analyze123!", roleId: 2, remember: true } });
    expect((Date.parse(res.data.expiresAt) - Date.parse(res.data.session.startedAt)) / 86400000).toBe(7);
    expect(res.data.session.remember).toBe(true);
  });

  it("refuses sign-ins with the documented codes and logs them", async () => {
    const failedBefore = db().activity.filter((row) => row.action === "Sign-in failed").length;
    const attempt = (login, password, roleId) => call("POST", "/auth/login", { body: { login, password, roleId } });
    const wrong = await attempt("analyst@demo.demandiq", "nope", 2);
    const unknown = await attempt("nobody@demo.demandiq", "Analyze123!", 2);
    expect([wrong.status, detail(wrong).code]).toEqual([401, "invalid_credentials"]);
    expect(detail(unknown).message).toBe(detail(wrong).message); // never says which was wrong
    expect(detail(await attempt("former.manager@demo.demandiq", "Former123!", 1)).code).toBe("account_inactive");
    expect(detail(await attempt("new.analyst@demo.demandiq", "Welcome123!", 2)).code).toBe("account_pending");
    const role = await attempt("analyst@demo.demandiq", "Analyze123!", 4);
    expect([role.status, detail(role).code]).toEqual([403, "role_mismatch"]);
    const empty = await attempt("", "", 9);
    expect([empty.status, detail(empty).code]).toEqual([422, "validation_error"]);
    expect(keys(detail(empty).fields)).toEqual(["login", "password", "roleId"]);
    // every refused attempt except the empty form (422) is in the activity log
    expect(db().activity.filter((row) => row.action === "Sign-in failed").length - failedBefore).toBe(5);
  });

  it("restores the session with GET /auth/me and ends it at logout", async () => {
    const token = await signIn("analyst");
    const me = await call("GET", "/auth/me", { token });
    expect(me.status).toBe(200);
    expect(keys(me.data)).toEqual(["expiresAt", "permissions", "screens", "session", "user"]);
    expect((await call("POST", "/auth/logout", { token })).status).toBe(204);
    const after = await call("GET", "/auth/me", { token });
    expect([after.status, detail(after).code]).toEqual([401, "session_ended"]);
  });

  it("ends sessions that expired, or whose account was deactivated or changed role", async () => {
    const expired = await signIn("analyst");
    db().sessions.find((s) => s.token === expired).expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(detail(await call("GET", "/auth/me", { token: expired })).code).toBe("session_expired");

    const inactive = await signIn("manager");
    db().users.find((u) => u.id === "USR-2091").status = "Inactive";
    expect(detail(await call("GET", "/sales", { token: inactive })).code).toBe("account_inactive");

    const moved = await signIn("supervisor");
    db().users.find((u) => u.id === "USR-3381").roleId = 2;
    const res = await call("GET", "/inventory", { token: moved });
    expect([res.status, detail(res).code]).toEqual([401, "role_changed"]);
    expect(detail(await call("GET", "/auth/me", { token: "made-up" })).code).toBe("session_ended");
  });

  it("answers password resets with 202 whether or not the email exists", async () => {
    const known = await call("POST", "/auth/password-reset", { body: { email: "analyst@demo.demandiq" } });
    const unknown = await call("POST", "/auth/password-reset", { body: { email: "someone@else.test" } });
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(known.data).toEqual(unknown.data);
    expect((await call("POST", "/auth/password-reset", { body: { email: "not-an-email" } })).status).toBe(422);
  });

  it("lists the roles with their screens without signing in", async () => {
    const res = await call("GET", "/auth/roles");
    expect(res.data.map((role) => [role.roleId, role.name])).toEqual([
      [1, "Store Manager"],
      [2, "Data Analyst"],
      [3, "Inventory Supervisor"],
      [4, "Admin"],
    ]);
  });
});

describe("permissions", () => {
  it("checks each action on the server", async () => {
    const analyst = await signIn("analyst");
    const manager = await signIn("manager");
    const forbidden = async (res) => expect([res.status, detail(res).code]).toEqual([403, "forbidden"]);
    await forbidden(await call("POST", "/datasets", { token: analyst, form: csvFile("Date,Product_ID,Units_Sold\n2025-06-26,PP-4012,4\n") }));
    await forbidden(await call("POST", "/forecasts", { token: manager, body: { sku: "PP-4012", model: "ARIMA", horizon: 7, startDate: "2025-03-19", endDate: "2025-06-18" } }));
    await forbidden(await call("PATCH", "/inventory/PP-4012", { token: analyst, body: { stock: 5, reason: "Count" } }));
    await forbidden(await call("GET", "/users", { token: analyst }));
    await forbidden(await call("GET", "/activity", { token: manager }));
    await forbidden(await call("PUT", "/roles/1/screens", { token: manager, body: { screens: ["SCR-01"] } }));
  });

  it("counts an action only on a screen the role can open", async () => {
    const admin = await signIn("admin");
    const set = await call("PATCH", "/roles/permissions", { token: admin, body: { action: "Run forecasts", roleId: 1, value: "Yes" } });
    expect(set.data["Run forecasts"]["1"]).toBe("Yes"); // the matrix keeps what the Admin set

    const manager = await signIn("manager");
    const request = { sku: "PP-4012", model: "Linear Regression", horizon: 7, startDate: "2025-03-19", endDate: "2025-06-18" };
    expect((await call("GET", "/auth/me", { token: manager })).data.permissions["Run forecasts"]).toBe("No"); // no SCR-05 yet
    expect((await call("POST", "/forecasts", { token: manager, body: request })).status).toBe(403);

    await call("PUT", "/roles/1/screens", { token: admin, body: { screens: ["SCR-01", "SCR-02", "SCR-04", "SCR-05"] } });
    expect((await call("GET", "/auth/me", { token: manager })).data.permissions["Run forecasts"]).toBe("Yes");
    expect((await call("POST", "/forecasts", { token: manager, body: request })).status).toBe(201);
  });

  it("keeps the locked permissions and screens", async () => {
    const admin = await signIn("admin");
    const locked = async (res) => expect([res.status, detail(res).code]).toEqual([409, "locked"]);
    await locked(await call("PATCH", "/roles/permissions", { token: admin, body: { action: "Manage users", roleId: 4, value: "No" } }));
    await locked(await call("PATCH", "/roles/permissions", { token: admin, body: { action: "View system logs", roleId: 2, value: "Yes" } }));
    await locked(await call("PUT", "/roles/2/screens", { token: admin, body: { screens: ["SCR-02", "SCR-04", "SCR-05"] } })); // SCR-01
    await locked(await call("PUT", "/roles/1/screens", { token: admin, body: { screens: ["SCR-01", "SCR-02", "SCR-04", "SCR-06"] } }));
    await locked(await call("PUT", "/roles/4/screens", { token: admin, body: { screens: ["SCR-01", "SCR-02"] } }));
    const bad = await call("PATCH", "/roles/permissions", { token: admin, body: { action: "Clean data", roleId: 1, value: "Review" } });
    expect([bad.status, detail(bad).code]).toEqual([422, "validation_error"]);
  });

  it("keeps the Admin view-only on Sales Data, Inventory and Forecasting", async () => {
    const admin = await signIn("admin");
    expect((await call("GET", "/auth/me", { token: admin })).data.permissions).toMatchObject({
      "Upload sales": "Review",
      "Clean data": "View",
      "Run forecasts": "View",
      "Update inventory": "View",
      "Generate reports": "Yes",
      "Manage users": "Yes",
    });
    const forbidden = async (res) => expect([res.status, detail(res).code]).toEqual([403, "forbidden"]);
    const forecast = { sku: "PP-4012", model: "ARIMA", horizon: 7, startDate: "2025-03-19", endDate: "2025-06-18" };
    await forbidden(await call("POST", "/datasets", { token: admin, form: csvFile("Date,Product_ID,Units_Sold\n2025-06-26,PP-4012,4\n") }));
    await forbidden(await call("POST", "/datasets/DS-0007/clean", { token: admin, body: {} }));
    await forbidden(await call("POST", "/forecasts", { token: admin, body: forecast }));
    await forbidden(await call("POST", "/forecasts/compare", { token: admin, body: forecast }));
    await forbidden(await call("PATCH", "/inventory/PP-4012", { token: admin, body: { stock: 5, reason: "Count" } }));
    await forbidden(await call("POST", "/reorders", { token: admin, body: { sku: "PP-4012", quantity: 5, supplier: "X" } }));
    await forbidden(await call("PATCH", "/reorders/RO-0002", { token: admin, body: { status: "Delivered" } }));
    // It still sees everything
    for (const path of ["/sales", "/datasets", "/forecasts", "/inventory", "/reorders"]) expect([path, (await call("GET", path, { token: admin })).status]).toEqual([path, 200]);
    // …and the matrix can't give these actions back
    for (const action of ["Upload sales", "Clean data", "Run forecasts", "Update inventory"]) {
      const res = await call("PATCH", "/roles/permissions", { token: admin, body: { action, roleId: 4, value: "Yes" } });
      expect([action, res.status, detail(res).code]).toEqual([action, 409, "locked"]);
    }
  });

  it("restores the default permissions and screens", async () => {
    const admin = await signIn("admin");
    await call("PATCH", "/roles/permissions", { token: admin, body: { action: "Clean data", roleId: 1, value: "Yes" } });
    await call("PUT", "/roles/3/screens", { token: admin, body: { screens: ["SCR-01", "SCR-03"] } });
    const res = await call("POST", "/roles/restore-defaults", { token: admin });
    expect(res.data.permissions["Clean data"]["1"]).toBe("No");
    expect(res.data.screens["3"]).toEqual(["SCR-01", "SCR-03", "SCR-04"]);
  });
});

describe("dashboard summary", () => {
  it("returns the KPI cards of the caller's role", async () => {
    const expected = {
      manager: ["total_revenue", "units_sold", "active_skus", "sales_growth"],
      analyst: ["uploaded_datasets", "valid_records", "forecast_runs", "forecast_accuracy"],
      supervisor: ["active_skus", "safe_items", "low_items", "critical_items", "suggested_reorder"],
      admin: ["active_users", "dataset_uploads", "forecast_runs", "unresolved_errors"],
    };
    for (const [who, ids] of Object.entries(expected)) {
      const res = await call("GET", "/dashboard/summary", { token: await signIn(who), query: RANGE });
      expect(res.status).toBe(200);
      expect(res.data.kpis.map((kpi) => kpi.id)).toEqual(ids);
      for (const kpi of res.data.kpis) expect(keys(kpi)).toEqual(FIELDS.kpi);
    }
  });

  it("compares sales with the previous period of the same length", async () => {
    const token = await signIn("manager");
    const res = await call("GET", "/dashboard/summary", { token, query: { ...RANGE, category: ["Polymers", "Chemicals"] } });
    const growth = res.data.kpis.find((kpi) => kpi.id === "sales_growth");
    const expected = salesGrowth(db().sales, { startDate: RANGE.start, endDate: RANGE.end, category: ["Polymers", "Chemicals"] });
    expect(growth).toMatchObject({ format: "growth", value: expected.value });
    expect(typeof growth.value).toBe("number");
    // The history starts on 19 Dec 2024, two days into the earlier period, so daily averages are compared
    expect(expected).toMatchObject({ previousStart: "2024-12-19", previousEnd: "2025-03-18", partial: true });
    expect(growth.detail).toBe("vs 19 Dec 2024 – 18 Mar 2025 · daily average");
  });

  it("calculates with the filters", async () => {
    const token = await signIn("manager");
    const all = await call("GET", "/dashboard/summary", { token, query: RANGE });
    const central = await call("GET", "/dashboard/summary", { token, query: { ...RANGE, region: "Central" } });
    const units = (res) => res.data.kpis.find((kpi) => kpi.id === "units_sold").value;
    const expectedCentral = filterSales(db().sales, { startDate: RANGE.start, endDate: RANGE.end, region: "Central" }).reduce((sum, row) => sum + row.units, 0);
    expect(units(central)).toBe(expectedCentral);
    expect(units(central)).toBeLessThan(units(all));
    const bad = await call("GET", "/dashboard/summary", { token, query: { start: "18/06/2025" } });
    expect([bad.status, detail(bad).code, Object.keys(detail(bad).fields)]).toEqual([422, "validation_error", ["start"]]);
  });
});

describe("sales data", () => {
  const upload = "Date,Product_ID,Units_Sold,Unit_Price,Discount_Rate\n2025-06-26,PP-4012,40,248,0\n2025-06-26,PE-7820,38,224,0.02\n2025-06-27,PP-4012,44,248,0\n";

  it("filters sales with the query parameters", async () => {
    const token = await signIn("analyst");
    const all = await call("GET", "/sales", { token });
    expect(all.data.length).toBe(db().sales.length);
    expect(keys(all.data[0])).toEqual(FIELDS.sale);
    const some = await call("GET", "/sales", { token, query: { ...RANGE, sku: "PP-4012", region: "Central" } });
    expect(some.data.length).toBeGreaterThan(0);
    expect(some.data.every((row) => row.sku === "PP-4012" && row.region === "Central" && row.date >= RANGE.start && row.date <= RANGE.end)).toBe(true);
  });

  it("uploads, records and cleans a dataset", async () => {
    const manager = await signIn("manager");
    const res = await call("POST", "/datasets", { token: manager, form: csvFile(upload, "sales_jun_26_27_2025.csv") });
    expect(res.status).toBe(201);
    expect(keys(res.data)).toEqual(["dataset", "validation"]);
    expect(keys(res.data.dataset)).toEqual(FIELDS.dataset);
    expect(res.data.dataset).toMatchObject({ cleaning: "Pending", forecasting: "Pending", pendingCount: 3, validation: "Valid", uploaderId: "USR-2091" });
    // GET /datasets is the dataset history: the new upload first, not forecast yet
    const history = await call("GET", "/datasets", { token: manager });
    expect(history.data[0]).toMatchObject({ id: res.data.dataset.id, uploader: "Omar Hassan", validation: "Valid", forecasting: "Pending" });

    const analyst = await signIn("analyst");
    const before = db().sales.length;
    const cleaned = await call("POST", `/datasets/${res.data.dataset.id}/clean`, { token: analyst, body: { capOutliers: true, overlap: "replace" } });
    expect(cleaned.status).toBe(200);
    expect(keys(cleaned.data)).toEqual(["dataset", "salesRange", "summary"]);
    expect(cleaned.data.dataset).toMatchObject({ cleaning: "Completed", pendingCount: 0 });
    expect(cleaned.data.summary.added + cleaned.data.summary.replaced).toBe(3);
    expect(db().sales.length).toBe(before + cleaned.data.summary.added);
    expect(cleaned.data.salesRange.end).toBe("2025-06-27");
    const again = await call("POST", `/datasets/${res.data.dataset.id}/clean`, { token: analyst, body: {} });
    expect([again.status, detail(again).code]).toEqual([409, "not_pending"]);
    expect((await call("POST", "/datasets/DS-9999/clean", { token: analyst, body: {} })).status).toBe(404);
  });

  it("rejects a file it can't use but still records the attempt", async () => {
    const token = await signIn("manager");
    const errorsBefore = db().errors.length;
    const res = await call("POST", "/datasets", { token, form: csvFile("Date,Units\nnot a date,abc\n", "broken.csv") });
    expect([res.status, detail(res).code]).toEqual([422, "invalid_file"]);
    expect(detail(res).validation.errors).toEqual([
      "Couldn't find a product column (SKU, Product ID, Item or Product Name …). Columns in the file: Date, Units.",
    ]);
    expect(detail(res).dataset).toMatchObject({ validation: "Failed", cleaning: "Not started", fileName: "broken.csv", newProducts: [] });
    expect((await call("GET", "/datasets", { token })).data[0]).toMatchObject({ fileName: "broken.csv", validation: "Failed", recordCount: 0 });
    expect(db().errors.length).toBe(errorsBefore + 1);
    expect(db().activity[0]).toMatchObject({ action: "Dataset upload failed", module: "Sales Upload", status: "Failed" });
    // What a file is comes from its contents, not its name
    const pdf = await call("POST", "/datasets", { token, form: csvFile("%PDF-1.7", "sales.csv") });
    expect([pdf.status, detail(pdf).code, detail(pdf).message]).toEqual([415, "unsupported_file", "A PDF can't be read as sales data. Upload a CSV, text or Excel (.xlsx) file."]);
    const xls = await call("POST", "/datasets", { token, form: csvFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), "sales.xls") });
    expect([xls.status, detail(xls).message]).toEqual([415, "Excel 97–2003 (.xls) files can't be read. Save it as .xlsx or CSV and upload it again."]);
    const binary = await call("POST", "/datasets", { token, form: csvFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), "photo.png") });
    expect([binary.status, detail(binary).message]).toEqual([415, "Unsupported file type. Upload a CSV, text or Excel (.xlsx) file."]);
    const renamed = await call("POST", "/datasets", { token, form: csvFile("Date,Product_ID,Units_Sold\n2025-06-26,PP-4012,4\n", "renamed.xlsx") });
    expect([renamed.status, renamed.data.validation.valid]).toEqual([201, 1]);
    const damaged = await call("POST", "/datasets", { token, form: csvFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "damaged.xlsx") });
    expect([damaged.status, detail(damaged).validation.errors]).toEqual([422, ["This isn't a valid .xlsx file."]]);
    const header = await call("POST", "/datasets", { token, form: csvFile("Date,SKU,Qty\n", "header.csv") });
    expect([header.status, detail(header).validation.errors]).toEqual([422, ["The file has a header but no rows."]]);
    const none = await call("POST", "/datasets", { token, form: new FormData() });
    expect([none.status, Object.keys(detail(none).fields)]).toEqual([422, ["file"]]);
  });

  it("adds up rows for the same product and day, and counts left-out rows as warnings", async () => {
    const token = await signIn("manager");
    const text = [
      "Date,Product_ID,Units_Sold",
      "2025-06-26,PP-4012,40",
      "2025-06-26,PP-4012,41", // the same product and day: added up
      "2025-06-26,PP-4012,40", // an exact repeat: a duplicate
      "2025-13-40,PP-4012,3",
      "2025-06-27,PP-4012,-2",
      "2025-06-27,XX-0000,5", // not in the catalog: a new product
      ",PP-4012,1",
    ].join("\n");
    const res = await call("POST", "/datasets", { token, form: csvFile(text) });
    expect(res.status).toBe(201);
    expect(res.data.validation).toEqual({
      total: 7,
      valid: 2,
      combined: 1,
      missing: 1,
      duplicates: 1,
      invalidDates: 1,
      invalidNumeric: 1,
      errors: [],
      columns: { date: "Date", units: "Units_Sold", product: "Product_ID" },
    });
    expect(res.data.dataset).toMatchObject({ validation: "4 warnings", recordCount: 2, pendingCount: 2, newProducts: ["XX-0000"] });
    expect(res.data.dataset.checks).toEqual({ total: 7, valid: 2, combined: 1, missing: 1, duplicates: 1, invalidDates: 1, invalidNumeric: 1 });
    expect(db().datasets[0].pendingRecords.find((r) => r.sku === "PP-4012")).toMatchObject({ date: "2025-06-26", units: 81 });
  });

  it("reads files of any layout: many columns, new products and categories, then cleans and forecasts them", async () => {
    const manager = await signIn("manager");
    // Two stores a day for two products the catalog doesn't have, among columns the app doesn't use
    const lines = ["Date,Store ID,Product ID,Category,Region,Inventory Level,Units Sold,Units Ordered,Demand Forecast,Price,Discount,Weather Condition"];
    for (let day = 1; day <= 28; day += 1) {
      const date = `2025-05-${String(day).padStart(2, "0")}`;
      lines.push(`${date},S001,P0001,Snacks,North,${300 - day},${10 + (day % 5)},20,12.5,4.00,10,Sunny`);
      lines.push(`${date},S002,P0001,Snacks,North,${200 - day},${5 + (day % 3)},20,7.5,4.00,0,Rainy`);
      lines.push(`${date},S001,P0002,Beverages,South,${120 + day},${day % 4},10,2.1,2.50,0,Sunny`);
    }
    const res = await call("POST", "/datasets", { token: manager, form: csvFile(lines.join("\n"), "retail_store_inventory.csv") });
    expect(res.status).toBe(201);
    expect(res.data.validation).toMatchObject({ total: 84, valid: 56, combined: 28, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0 });
    expect(res.data.validation.columns).toMatchObject({ date: "Date", product: "Product ID", units: "Units Sold", price: "Price", discount: "Discount", stock: "Inventory Level", category: "Category" });
    expect(res.data.dataset).toMatchObject({ validation: "Valid", newProducts: ["P0001", "P0002"], coverage: { firstDate: "2025-05-01", lastDate: "2025-05-28", products: 2 } });
    expect(db().activity[0]).toMatchObject({ action: "Products added", module: "Sales Upload", status: "Completed", details: "retail_store_inventory.csv · P0001, P0002" });

    // The new products and their categories are in the catalog, with the stock the file gave on its last day
    const inventory = (await call("GET", "/inventory", { token: manager })).data;
    const p1 = inventory.find((row) => row.sku === "P0001");
    expect(keys(p1)).toEqual(FIELDS.inventory);
    expect(p1).toMatchObject({ name: "P0001", category: "Snacks", region: "North", location: "S001", channel: "Unassigned", unitPrice: 4, unitCost: null, stock: 300 - 28 + 200 - 28 });
    expect(p1.status).toBe(inventoryStatus(p1.stock, p1));
    const categories = (await call("GET", "/categories", { token: manager })).data;
    expect(categories.find((c) => c.name === "Snacks")).toMatchObject({ description: "Added from retail_store_inventory.csv", status: "Active", products: 1 });
    expect(categories.find((c) => c.name === "Beverages")).toMatchObject({ products: 1 });
    expect(db().snapshots.find((s) => s.month === "2025-06").items.find((i) => i.sku === "P0002")).toMatchObject({ stock: 148 });

    // Cleaned and forecast like any other product
    const analyst = await signIn("analyst");
    const cleaned = await call("POST", `/datasets/${res.data.dataset.id}/clean`, { token: analyst, body: {} });
    expect([cleaned.status, cleaned.data.summary.added]).toEqual([200, 56]);
    const sale = db().sales.find((row) => row.sku === "P0001" && row.date === "2025-05-01");
    expect(sale).toMatchObject({ units: 11 + 6, category: "Snacks", datasetId: res.data.dataset.id });
    expect(sale.netRevenue).toBeCloseTo(11 * 4 * 0.9 + 6 * 4, 2);
    const run = await call("POST", "/forecasts", { token: analyst, body: { sku: "P0001", model: "Moving Average", horizon: 7, windowSize: 7, startDate: "2025-05-01", endDate: "2025-05-28" } });
    expect(run.status).toBe(201);
    expect(run.data.lineage.sources.map((source) => source.datasetId)).toEqual([res.data.dataset.id]);
  });

  it("accepts tab- and semicolon-separated text and Excel workbooks", async () => {
    const token = await signIn("manager");
    const tsv = await call("POST", "/datasets", { token, form: csvFile("Date\tProduct_ID\tUnits_Sold\n2025-06-26\tPP-4012\t40\n", "sales.tsv") });
    expect([tsv.status, tsv.data.validation.valid]).toEqual([201, 1]);
    const semicolons = await call("POST", "/datasets", { token, form: csvFile("date;product id;units sold\n2025-06-26;PE-7820;12\n", "sales.txt") });
    expect([semicolons.status, semicolons.data.validation.valid]).toEqual([201, 1]);
    const workbook = await xlsxFile([
      ["Date", "Product_ID", "Units_Sold", "Unit_Price"],
      [new Date(Date.UTC(2025, 5, 26)), "PP-4012", 40, 248],
      ["2025-06-27", "PP-4012", 44, 248],
    ]);
    const xlsx = await call("POST", "/datasets", { token, form: workbook });
    expect(xlsx.status).toBe(201);
    expect(xlsx.data.validation).toMatchObject({ total: 2, valid: 2 });
    expect(xlsx.data.dataset).toMatchObject({ fileName: "sales.xlsx", coverage: { firstDate: "2025-06-26", lastDate: "2025-06-27" } });
    // A workbook that starts with a notes sheet: the first sheet with sales is read
    const form = new FormData();
    const bytes = await writeXlsxFile([
      { sheet: "Notes", data: [[{ value: "Sales are on the next sheet" }]] },
      { sheet: "Sales", data: [[{ value: "Item" }, { value: "Qty" }, { value: "Date" }], [{ value: "PE-7820" }, { value: 3 }, { value: "26/06/2025" }]] },
    ]).toBuffer();
    form.append("file", new File([bytes], "two_sheets.xlsx"));
    const sheets = await call("POST", "/datasets", { token, form });
    expect([sheets.status, sheets.data.validation.valid, sheets.data.dataset.coverage.firstDate]).toEqual([201, 1, "2025-06-26"]);
  });
});

describe("forecasts", () => {
  const request = { sku: "PP-4012", model: "ARIMA", horizon: 30, startDate: "2025-03-19", endDate: "2025-06-18", order: [2, 1, 2] };

  it("runs and saves a forecast in the documented shape", async () => {
    const token = await signIn("analyst");
    const res = await call("POST", "/forecasts", { token, body: request });
    expect(res.status).toBe(201);
    const run = res.data;
    expect(keys(run)).toEqual(FIELDS.forecast);
    expect(run.configuration).toEqual({ horizon: 30, order: [2, 1, 2] });
    expect(keys(run.metrics)).toEqual(["mae", "mape", "rmse"]);
    expect(run.evaluation).toEqual({ holdoutDays: 14 });
    expect(run.points).toHaveLength(30);
    expect(run.points[0]).toEqual({ date: "2025-06-19", predicted: expect.any(Number) });
    expect(run.points.every((p) => Number.isInteger(p.predicted) && p.predicted >= 0)).toBe(true);
    expect(run.generatedBy).toEqual({ id: "USR-1042", name: "Noura Alharbi" });

    expect((await call("GET", `/forecasts/${run.id}`, { token })).data).toEqual(run);
    expect((await call("GET", "/forecasts", { token })).data[0]).toEqual(run);
    expect((await call("GET", "/forecasts/FC-9999", { token })).status).toBe(404);
  });

  it("updates the product's 30-day demand", async () => {
    const token = await signIn("analyst");
    const run = (await call("POST", "/forecasts", { token, body: request })).data;
    const perDay = run.points.reduce((sum, p) => sum + p.predicted, 0) / run.points.length;
    const item = db().inventory.find((row) => row.sku === "PP-4012");
    expect(item.demand).toBe(Math.max(1, Math.round(perDay * 30)));
  });

  it("sends the Moving Average window and refuses bad requests", async () => {
    const token = await signIn("analyst");
    const ma = await call("POST", "/forecasts", { token, body: { ...request, model: "Moving Average", order: undefined, windowSize: 5 } });
    expect(ma.data.configuration).toEqual({ horizon: 30, windowSize: 5 });
    const invalid = await call("POST", "/forecasts", { token, body: { sku: "XX-0000", model: "Prophet", horizon: 0, startDate: "2025-03-19", endDate: "2025-06-18" } });
    expect([invalid.status, detail(invalid).code, keys(detail(invalid).fields)]).toEqual([422, "validation_error", ["horizon", "model", "sku"]]);
    const order = await call("POST", "/forecasts", { token, body: { ...request, order: [6, 1, 2] } });
    expect(Object.keys(detail(order).fields)).toEqual(["order"]);
    const errorsBefore = db().errors.length;
    const short = await call("POST", "/forecasts", { token, body: { ...request, startDate: "2025-06-10" } });
    expect([short.status, detail(short).code]).toEqual([422, "forecast_failed"]);
    expect(db().errors.length).toBe(errorsBefore + 1);
    expect(db().errors[0]).toMatchObject({ module: "Forecasting", type: "Execution failure", status: "Open" });
  });

  it("compares the three models without saving", async () => {
    const token = await signIn("analyst");
    const runs = db().forecasts.length;
    const res = await call("POST", "/forecasts/compare", { token, body: { ...request, model: undefined, windowSize: 7 } });
    expect(res.status).toBe(200);
    expect(res.data.results.map((r) => [r.model, r.status])).toEqual([
      ["Moving Average", "Completed"],
      ["Linear Regression", "Completed"],
      ["ARIMA", "Completed"],
    ]);
    expect(db().forecasts.length).toBe(runs);
  });

  it("recommends a model using the sales that match the filters", async () => {
    const token = await signIn("analyst");
    const filters = { ...RANGE, region: "Central" };
    const res = await call("POST", "/forecasts/recommendation", { token, body: { skus: ["PP-4012", "PE-7820", "XX-0000"], filters } });
    expect(res.status).toBe(200);
    expect(res.data.skus).toEqual(["PP-4012", "PE-7820"]); // unknown SKUs are left out
    const sales = filterSales(db().sales, { startDate: RANGE.start, endDate: RANGE.end, region: "Central" });
    const expected = compareModelsForProducts(sales, ["PP-4012", "PE-7820"], RANGE.start, RANGE.end);
    expect(res.data.recommended).toBe(expected.recommended);
    expect(res.data.ranked).toEqual(expected.ranked.map((m) => m.model));
    expect([res.data.startDate, res.data.endDate, res.data.testDays]).toEqual([RANGE.start, RANGE.end, 14]);

    const short = await call("POST", "/forecasts/recommendation", { token, body: { skus: ["PP-4012"], filters: { start: "2025-06-01", end: "2025-06-18" } } });
    expect(short.data.recommended).toBeNull();
    expect(short.data.reason).toMatch(/at least 7 are needed/);
    const manager = await signIn("manager"); // Run forecasts "View", but no SCR-05
    expect((await call("POST", "/forecasts/recommendation", { token: manager, body: { skus: ["PP-4012"], filters } })).status).toBe(403);
  });
});

describe("dataset lineage", () => {
  const request = { sku: "PP-4012", model: "ARIMA", horizon: 30, startDate: "2025-03-19", endDate: "2025-06-18", order: [2, 1, 2] };
  const datasetsNow = async (token) => Object.fromEntries((await call("GET", "/datasets", { token })).data.map((d) => [d.id, d]));
  const upload = async (token, name, rows) => {
    const text = `Date,Product_ID,Units_Sold\n${rows.map((r) => r.join(",")).join("\n")}\n`;
    const res = await call("POST", "/datasets", { token, form: csvFile(text, name) });
    expect(res.status).toBe(201);
    return res.data.dataset.id;
  };
  const clean = (token, id, overlap = "replace") => call("POST", `/datasets/${id}/clean`, { token, body: { capOutliers: false, overlap } });

  it("starts from seed data whose numbers match its records", async () => {
    const token = await signIn("analyst");
    const all = await datasetsNow(token);
    expect(Object.fromEntries(Object.values(all).map((d) => [d.id, d.forecasting]))).toEqual({
      "DS-0007": "Pending", // waiting for cleaning
      "DS-0006": "Not started", // rejected
      "DS-0005": "Completed",
      "DS-0004": "Completed",
      "DS-0003": "Completed",
      "DS-0002": "Completed",
      "DS-0001": "Not started", // rejected
    });
    for (const id of ["DS-0002", "DS-0003", "DS-0004", "DS-0005"]) {
      expect(all[id].lineage.recordsInHistory).toBe(all[id].recordCount);
      expect(all[id].lineage.forecastedSkus).toEqual(all[id].lineage.skus); // all 11 products forecast
      expect(all[id].lineage.forecastIds).toHaveLength(11);
    }
    expect(db().sales.every((row) => row.datasetId)).toBe(true);
    // Every seeded run was saved after the last upload it used was cleaned
    const cleanedAt = all["DS-0005"].cleanedAt;
    const runs = (await call("GET", "/forecasts", { token })).data;
    for (const run of runs) {
      expect(run.generatedAt > cleanedAt).toBe(true);
      expect(run.lineage.sources.map((s) => s.datasetId)).toEqual(["DS-0002", "DS-0003", "DS-0004", "DS-0005"]);
      expect(run.lineage.sources.reduce((sum, s) => sum + s.records, 0)).toBe(run.lineage.records);
      expect(run.lineage.waiting).toEqual([]);
    }
  });

  it("marks only the uploads a forecast used (the reviewer's DS-101 / DS-102 / DS-103 case)", async () => {
    const manager = await signIn("manager");
    const analyst = await signIn("analyst");
    const ds101 = await upload(manager, "p101.csv", [["2025-06-26", "CH-2155", 40], ["2025-06-27", "CH-2155", 42]]);
    const ds102 = await upload(manager, "p102.csv", [["2025-06-26", "PE-7820", 30], ["2025-06-27", "PE-7820", 31]]);
    const ds103 = await upload(manager, "p103.csv", [["2025-06-28", "CH-2155", 44]]); // stays waiting for cleaning
    await clean(analyst, ds101);
    await clean(analyst, ds102);

    const before = await datasetsNow(analyst);
    const res = await call("POST", "/forecasts", {
      token: analyst,
      body: { sku: "CH-2155", model: "Moving Average", horizon: 7, startDate: "2025-03-28", endDate: "2025-06-28", windowSize: 7 },
    });
    expect(res.status).toBe(201);
    const run = res.data;
    expect(run.lineage.sources.map((s) => s.datasetId)).toEqual(["DS-0002", "DS-0003", "DS-0004", "DS-0005", ds101]);
    expect(run.lineage.sources.at(-1)).toMatchObject({ fileName: "p101.csv", records: 2, firstDate: "2025-06-26", lastDate: "2025-06-27" });
    // Waiting for cleaning, so not used: those days counted as no sales
    expect(run.lineage.waiting.map((s) => [s.datasetId, s.records])).toEqual([
      ["DS-0007", 7],
      [ds103, 1],
    ]);

    const after = await datasetsNow(analyst);
    expect(after[ds101]).toMatchObject({ forecasting: "Completed", forecastedAt: run.generatedAt });
    expect(after[ds101].lineage).toEqual({ recordsInHistory: 2, skus: ["CH-2155"], forecastedSkus: ["CH-2155"], forecastIds: [run.id] });
    expect(after[ds102]).toMatchObject({ forecasting: "Pending", forecastedAt: null }); // only PE-7820: not used
    expect(after[ds103]).toMatchObject({ forecasting: "Pending", cleaning: "Pending" });
    expect(after["DS-0007"].forecasting).toBe("Pending");
    for (const id of [ds102, ds103, "DS-0007", "DS-0006", "DS-0001"]) expect(after[id]).toEqual(before[id]);
  });

  it("doesn't mark an upload whose dates are outside the forecast's range", async () => {
    const analyst = await signIn("analyst");
    await clean(analyst, "DS-0007"); // 19–25 Jun, all 11 products
    await call("POST", "/forecasts", { token: analyst, body: { ...request, endDate: "2025-06-18" } });
    expect((await datasetsNow(analyst))["DS-0007"]).toMatchObject({ forecasting: "Pending", forecastedAt: null });
  });

  it("counts a multi-product upload product by product: Partial, then Completed", async () => {
    const analyst = await signIn("analyst");
    await clean(analyst, "DS-0007");
    const range = { startDate: "2025-03-26", endDate: "2025-06-25" };
    const first = (await call("POST", "/forecasts", { token: analyst, body: { ...request, ...range } })).data;
    let upload7 = (await datasetsNow(analyst))["DS-0007"];
    expect(upload7).toMatchObject({ forecasting: "Partial", forecastedAt: first.generatedAt });
    expect([upload7.lineage.forecastedSkus, upload7.lineage.skus.length]).toEqual([["PP-4012"], 11]);
    for (const sku of upload7.lineage.skus.filter((s) => s !== "PP-4012"))
      await call("POST", "/forecasts", { token: analyst, body: { sku, model: "Linear Regression", horizon: 7, ...range } });
    upload7 = (await datasetsNow(analyst))["DS-0007"];
    expect(upload7.forecasting).toBe("Completed");
    expect(upload7.forecastedAt).toBe(first.generatedAt); // the first run that used it
    expect(upload7.lineage.forecastIds).toHaveLength(11);
  });

  it("says when an upload added nothing to forecast, and keeps each run's lineage when records are replaced", async () => {
    const manager = await signIn("manager");
    const analyst = await signIn("analyst");
    const run = (await call("POST", "/forecasts", { token: analyst, body: request })).data; // uses DS-0005 for June
    const june = db().sales.filter((r) => r.sku === "PP-4012" && r.date >= "2025-06-10" && r.date <= "2025-06-11");

    const skipped = await upload(manager, "repeat.csv", june.map((r) => [r.date, r.sku, r.units]));
    await clean(analyst, skipped, "skip"); // both records already exist
    expect((await datasetsNow(analyst))[skipped]).toMatchObject({ forecasting: "Not needed", lineage: { recordsInHistory: 0, skus: [] } });

    const replaced = await upload(manager, "corrected.csv", june.map((r) => [r.date, r.sku, r.units + 1]));
    await clean(analyst, replaced, "replace");
    const now = await datasetsNow(analyst);
    expect(now[replaced]).toMatchObject({ forecasting: "Pending", lineage: { recordsInHistory: 2, skus: ["PP-4012"] } });
    expect(now["DS-0005"].lineage.recordsInHistory).toBe(now["DS-0005"].recordCount - 2); // its two records were replaced
    expect(now["DS-0005"].forecasting).toBe("Completed");
    // The earlier run still shows what it used at the time
    const saved = (await call("GET", `/forecasts/${run.id}`, { token: analyst })).data;
    expect(saved.lineage).toEqual(run.lineage);
    expect(saved.lineage.sources.map((s) => s.datasetId)).not.toContain(replaced);
  });

  it("previews a forecast's lineage before it runs", async () => {
    const analyst = await signIn("analyst");
    const res = await call("GET", "/forecasts/lineage", { token: analyst, query: { sku: "PP-4012", start: "2025-06-01", end: "2025-06-25" } });
    expect(res.status).toBe(200);
    expect(keys(res.data)).toEqual(["days", "endDate", "records", "sku", "sources", "startDate", "waiting"]);
    expect(res.data).toMatchObject({ sku: "PP-4012", days: 25, records: 18 });
    expect(res.data.sources).toEqual([{ datasetId: "DS-0005", fileName: "sales_jun_1_18_2025.csv", records: 18, firstDate: "2025-06-01", lastDate: "2025-06-18" }]);
    expect(res.data.waiting).toEqual([{ datasetId: "DS-0007", fileName: "sales_jun_19_25_2025.csv", records: 7, firstDate: "2025-06-19", lastDate: "2025-06-25" }]);
    const bad = await call("GET", "/forecasts/lineage", { token: analyst, query: { sku: "XX-0000", start: "2025-06-25", end: "2025-06-01" } });
    expect([bad.status, keys(detail(bad).fields)]).toEqual([422, ["sku"]]);
    expect((await call("GET", "/forecasts/lineage", { token: analyst, query: { sku: "PP-4012", start: "2025-06-25", end: "2025-06-01" } })).status).toBe(422);
  });
});

describe("inventory and reorders", () => {
  it("updates stock, recalculates the status and the current month's snapshot", async () => {
    const token = await signIn("supervisor");
    const res = await call("PATCH", "/inventory/PE-7820", { token, body: { stock: 1000, reason: "Cycle count" } });
    expect(res.status).toBe(200);
    expect(keys(res.data)).toEqual(FIELDS.inventory);
    expect(res.data).toMatchObject({ stock: 1000, status: "Safe", suggested: 0 });
    const june = db().snapshots.find((s) => s.month === "2025-06");
    expect(june.items.find((i) => i.sku === "PE-7820")).toMatchObject({ stock: 1000, status: "Safe" });
    expect(db().activity[0]).toMatchObject({ action: "Stock quantity updated", module: "Inventory", status: "Completed" });

    const invalid = await call("PATCH", "/inventory/PE-7820", { token, body: { stock: -1, reason: "" } });
    expect([invalid.status, keys(detail(invalid).fields)]).toEqual([422, ["reason", "stock"]]);
    expect((await call("PATCH", "/inventory/NOPE-1", { token, body: { stock: 1, reason: "Count" } })).status).toBe(404);
  });

  it("lists alerts most urgent first, and snapshots by month", async () => {
    const token = await signIn("supervisor");
    const alerts = (await call("GET", "/inventory/alerts", { token })).data;
    expect(alerts.length).toBeGreaterThan(0);
    const rank = alerts.map((a) => (a.status === "Critical" ? 0 : 1));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(alerts.every((a) => a.status !== "Safe" && typeof a.message === "string")).toBe(true);
    const months = (await call("GET", "/inventory/snapshots", { token, query: { start: "2025-05", end: "2025-06" } })).data.map((s) => s.month);
    expect(months).toEqual(["2025-05", "2025-06"]);
    expect((await call("GET", "/inventory/snapshots", { token, query: { start: "May" } })).status).toBe(422);
  });

  it("places reorders as Ordered, and Mark delivered adds the quantity to stock", async () => {
    const token = await signIn("supervisor");
    const stock = db().inventory.find((row) => row.sku === "PP-4012").stock;
    const created = await call("POST", "/reorders", { token, body: { sku: "PP-4012", quantity: 600, supplier: "Gulf Polymers Supply" } });
    expect(created.status).toBe(201);
    expect(keys(created.data)).toEqual(FIELDS.reorder);
    expect(created.data).toMatchObject({ id: "RO-0004", status: "Ordered", deliveredAt: null, userId: "USR-3381", userName: "Layla Noor" }); // after the three seeded orders
    expect(Number.isNaN(Date.parse(created.data.orderedAt))).toBe(false);
    const id = created.data.id;
    expect(db().activity[0]).toMatchObject({ action: "Reorder placed", module: "Inventory", status: "Completed", details: `${id} · PP-4012, 600 units` });

    // Delivered is the only status a reorder moves to
    for (const status of ["Ordered", "Requested", "Approved", undefined]) {
      const wrong = await call("PATCH", `/reorders/${id}`, { token, body: { status } });
      expect([status, wrong.status, keys(detail(wrong).fields)]).toEqual([status, 422, ["status"]]);
    }
    const delivered = await call("PATCH", `/reorders/${id}`, { token, body: { status: "Delivered" } });
    expect(delivered.status).toBe(200);
    expect(keys(delivered.data)).toEqual(FIELDS.reorder);
    expect(delivered.data).toMatchObject({ id, status: "Delivered" });
    expect(Date.parse(delivered.data.deliveredAt)).toBeGreaterThanOrEqual(Date.parse(delivered.data.orderedAt));
    // The stock goes up, the status is worked out again and the current month's snapshot follows
    const item = db().inventory.find((row) => row.sku === "PP-4012");
    expect(item.stock).toBe(stock + 600);
    expect(item.status).toBe(inventoryStatus(item.stock, item));
    expect(db().snapshots.find((s) => s.month === "2025-06").items.find((i) => i.sku === "PP-4012").stock).toBe(stock + 600);
    expect(db().activity[0]).toMatchObject({ action: "Reorder delivered", module: "Inventory", status: "Completed", details: `${id} · PP-4012, 600 units · stock now ${(stock + 600).toLocaleString()}` });
    const again = await call("PATCH", `/reorders/${id}`, { token, body: { status: "Delivered" } });
    expect([again.status, detail(again).code, detail(again).message]).toEqual([409, "invalid_transition", `${id} has already been delivered.`]);
    expect((await call("PATCH", "/reorders/RO-9999", { token, body: { status: "Delivered" } })).status).toBe(404);

    expect((await call("GET", "/reorders", { token })).data.map((r) => [r.id, r.status])).toEqual([
      [id, "Delivered"],
      ["RO-0003", "Ordered"],
      ["RO-0002", "Ordered"],
      ["RO-0001", "Delivered"],
    ]);
    const bad = await call("POST", "/reorders", { token, body: { sku: "PP-4012", quantity: 0, supplier: "" } });
    expect(keys(detail(bad).fields)).toEqual(["quantity", "supplier"]);
  });
});

describe("administration", () => {
  // What Add user sends: the server gives the account its employee ID and work email
  const newUser = { name: "Sara Khalid", department: "Commercial", roleId: 1, status: "Active", password: "Welcome123!" };

  it("creates users with a generated employee ID and work email, who can then sign in", async () => {
    const admin = await signIn("admin");
    const list = await call("GET", "/users", { token: admin });
    expect(list.data.every((user) => keys(user).join() === FIELDS.user.join())).toBe(true);
    const created = await call("POST", "/users", { token: admin, body: newUser });
    expect(created.status).toBe(201);
    expect(keys(created.data)).toEqual(FIELDS.user); // never a password
    expect(created.data).toMatchObject({ id: "USR-3382", email: "sara.khalid@demo.demandiq", initials: "SK", status: "Active" }); // after USR-3381
    expect(db().activity[0]).toMatchObject({ action: "User created", details: "USR-3382 · Sara Khalid (Store Manager)" });
    for (const login of ["sara.khalid@demo.demandiq", "USR-3382"])
      expect((await call("POST", "/auth/login", { body: { login, password: "Welcome123!", roleId: 1 } })).status).toBe(200);
    // The same name gets a numbered email; accents and extra names are dropped
    const twin = await call("POST", "/users", { token: admin, body: newUser });
    expect(twin.data).toMatchObject({ id: "USR-3383", email: "sara.khalid2@demo.demandiq" });
    const accented = await call("POST", "/users", { token: admin, body: { ...newUser, name: "José María Núñez" } });
    expect(accented.data.email).toBe("jose.nunez@demo.demandiq");

    const invalid = await call("POST", "/users", { token: admin, body: { ...newUser, name: " ", password: "short" } });
    expect(keys(detail(invalid).fields)).toEqual(["name", "password"]);
    // An ID or email may still be sent (an import); they must be valid and free
    const imported = await call("POST", "/users", { token: admin, body: { ...newUser, id: "usr-5001", email: "s.khalid@demandiq.test" } });
    expect(imported.data).toMatchObject({ id: "USR-5001", email: "s.khalid@demandiq.test" });
    const taken = await call("POST", "/users", { token: admin, body: { ...newUser, email: "S.Khalid@demandiq.test" } });
    expect([taken.status, detail(taken).code, detail(taken).fields.email]).toEqual([409, "email_taken", "A user with this email already exists."]);
    expect(detail(await call("POST", "/users", { token: admin, body: { ...newUser, id: "USR-5001" } })).code).toBe("id_taken");
    const bad = await call("POST", "/users", { token: admin, body: { ...newUser, id: "2044", email: "x" } });
    expect(keys(detail(bad).fields)).toEqual(["email", "id"]);
  });

  it("protects the last Admin and the signed-in user's own account", async () => {
    const admin = await signIn("admin");
    const last = await call("PATCH", "/users/USR-1001", { token: admin, body: { roleId: 1 } });
    expect(detail(last).code).toBe("last_admin");
    const second = (await call("POST", "/users", { token: admin, body: { ...newUser, roleId: 4 } })).data;
    expect(detail(await call("PATCH", "/users/USR-1001", { token: admin, body: { status: "Inactive" } })).code).toBe("own_account");
    expect(detail(await call("PATCH", "/users/USR-1001", { token: admin, body: { roleId: 2 } })).code).toBe("own_role");
    const updated = await call("PATCH", `/users/${second.id}`, { token: admin, body: { department: "Supply Chain" } });
    expect(updated.data.department).toBe("Supply Chain");
    expect((await call("PATCH", "/users/USR-0000", { token: admin, body: { name: "X" } })).status).toBe(404);
  });

  it("manages categories", async () => {
    const admin = await signIn("admin");
    const counts = (await call("GET", "/categories", { token: admin })).data.map((c) => [c.name, c.products]);
    expect(counts).toEqual([["Polymers", 2], ["Polyethylene", 2], ["Chemicals", 3], ["Agri-Nutrients", 2], ["Specialties", 2]]); // counted from the products
    const created = await call("POST", "/categories", { token: admin, body: { name: "Specialty Resins", description: "High-performance grades" } });
    expect([created.status, created.data.id, created.data.products]).toEqual([201, "CAT-006", 0]);
    expect(keys(created.data)).toEqual(FIELDS.category);
    expect(detail(await call("POST", "/categories", { token: admin, body: { name: "polymers" } })).code).toBe("name_taken");
    expect((await call("PATCH", "/categories/CAT-006", { token: admin, body: { status: "Inactive" } })).data.status).toBe("Inactive");
    const analyst = await signIn("analyst");
    expect((await call("GET", "/categories", { token: analyst })).status).toBe(200); // every role: the filters list them
    expect((await call("POST", "/categories", { token: analyst, body: { name: "X" } })).status).toBe(403);
  });

  it("renames a category on its products, their sales and new uploads", async () => {
    const admin = await signIn("admin");
    const renamed = await call("PATCH", "/categories/CAT-003", { token: admin, body: { name: "Industrial Chemicals" } });
    expect([renamed.data.name, renamed.data.products]).toEqual(["Industrial Chemicals", 3]);
    expect(db().inventory.filter((row) => row.category === "Chemicals")).toEqual([]);
    expect(db().sales.filter((row) => row.category === "Chemicals")).toEqual([]);
    const sales = await call("GET", "/sales", { token: admin, query: { category: "Industrial Chemicals" } });
    expect(new Set(sales.data.map((row) => row.sku))).toEqual(new Set(["CH-2155", "PS-5510", "ME-7732"]));
    const manager = await signIn("manager");
    const upload = await call("POST", "/datasets", { token: manager, form: csvFile("Date,Product_ID,Units_Sold\n2025-06-27,CH-2155,40\n", "chemicals.csv") });
    expect(db().datasets.find((d) => d.id === upload.data.dataset.id).pendingRecords[0].category).toBe("Industrial Chemicals");
  });
});

describe("reports", () => {
  it("generates in the background, then downloads the file", async () => {
    setReportDelay(30);
    const token = await signIn("manager");
    const started = await call("POST", "/reports", { token, body: { name: "Sales by Region", format: "CSV", filters: RANGE } });
    expect(started.status).toBe(202);
    expect(keys(started.data)).toEqual(FIELDS.report);
    expect(started.data).toMatchObject({ status: "Processing", filters: RANGE, error: null });
    const early = await call("GET", `/reports/${started.data.id}/file`, { token });
    expect([early.status, detail(early).code]).toEqual([409, "report_processing"]);
    await wait(60);
    expect((await call("GET", `/reports/${started.data.id}`, { token })).data.status).toBe("Completed");
    const file = await call("GET", `/reports/${started.data.id}/file`, { token });
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("text/csv;charset=utf-8");
    expect(file.headers.get("Content-Disposition")).toBe('attachment; filename="sales-by-region.csv"');
    expect((await file.data.text()).replace(/^\uFEFF/, "").split("\n")[0]).toBe('"Region","Units","Net Revenue"');
    expect(db().activity[0]).toMatchObject({ action: "Sales by Region exported", module: "Reports & Exports", status: "Completed" });
  });

  it("fails a report with no matching data", async () => {
    const token = await signIn("manager");
    const started = await call("POST", "/reports", { token, body: { name: "Sales Summary", format: "XLSX", filters: { start: "2020-01-01", end: "2020-01-31" } } });
    await wait(10);
    const report = (await call("GET", `/reports/${started.data.id}`, { token })).data;
    expect(report).toMatchObject({ status: "Failed", error: "There is no matching data to export." });
    expect(detail(await call("GET", `/reports/${started.data.id}/file`, { token })).code).toBe("report_failed");
    expect(db().errors[0]).toMatchObject({ module: "Reports & Exports", type: "Export failure", severity: "Warning" });
  });

  it("builds PDF and XLSX files", async () => {
    const token = await signIn("supervisor");
    for (const [format, type] of [
      ["PDF", "application/pdf"],
      ["XLSX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ]) {
      const started = await call("POST", "/reports", { token, body: { name: "Inventory Status Report", format, filters: {} } });
      await wait(10);
      const file = await call("GET", `/reports/${started.data.id}/file`, { token });
      expect([file.status, file.headers.get("Content-Type")]).toEqual([200, type]);
      expect(file.data.size).toBeGreaterThan(1000);
    }
  });

  it("only lets a role generate its report types and see its own reports", async () => {
    const supervisor = await signIn("supervisor");
    const refused = await call("POST", "/reports", { token: supervisor, body: { name: "Sales Summary", format: "PDF", filters: RANGE } });
    expect([refused.status, detail(refused).code]).toEqual([403, "report_not_allowed"]);
    const invalid = await call("POST", "/reports", { token: supervisor, body: { name: "Nope", format: "DOCX" } });
    expect(keys(detail(invalid).fields)).toEqual(["format", "name"]);

    const manager = await signIn("manager");
    const mine = await call("POST", "/reports", { token: manager, body: { name: "Sales Summary", format: "CSV", filters: RANGE } });
    expect((await call("GET", `/reports/${mine.data.id}`, { token: supervisor })).status).toBe(404);
    expect((await call("GET", "/reports", { token: supervisor })).data.every((r) => r.userId === "USR-3381")).toBe(true);
    const admin = await signIn("admin");
    expect((await call("GET", `/reports/${mine.data.id}`, { token: admin })).status).toBe(200);
  });

  it("queues report emails", async () => {
    const token = await signIn("manager");
    const body = { name: "Sales Summary", format: "PDF", filters: RANGE, recipients: ["lead@demandiq.test"], subject: "Q2", message: "" };
    const res = await call("POST", "/reports/email", { token, body });
    expect([res.status, res.data.status, res.data.recipients]).toEqual([202, "Queued", ["lead@demandiq.test"]]);
    expect((await call("POST", "/reports/email", { token, body: { ...body, recipients: ["not-an-email"] } })).status).toBe(422);
  });
});

describe("logs", () => {
  it("returns the activity log, sessions and error log in the documented shapes", async () => {
    const admin = await signIn("admin");
    const activity = (await call("GET", "/activity", { token: admin })).data;
    expect(activity.every((row) => keys(row).join() === FIELDS.activity.join())).toBe(true);
    expect(activity[0]).toMatchObject({ action: "User login", userId: "USR-1001", roleId: 4 });
    const sessions = (await call("GET", "/sessions", { token: admin })).data;
    expect(sessions.every((row) => keys(row).join() === FIELDS.session.join())).toBe(true);
    expect(sessions[0]).toMatchObject({ userId: "USR-1001", logoutAt: null });
    const errors = (await call("GET", "/errors", { token: admin })).data;
    expect(errors.every((row) => keys(row).join() === FIELDS.error.join())).toBe(true);
  });

  it("records the one browser-only event", async () => {
    const token = await signIn("manager");
    const res = await call("POST", "/activity", { token, body: { action: "Screen access denied", details: "#/administration" } });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ action: "Screen access denied", module: "Authentication", status: "Failed", userId: "USR-2091" });
    expect((await call("POST", "/activity", { token, body: { action: "User login" } })).status).toBe(422);
  });

  it("updates an error's status and notes", async () => {
    const admin = await signIn("admin");
    const [first] = (await call("GET", "/errors", { token: admin })).data;
    const res = await call("PATCH", `/errors/${first.id}`, { token: admin, body: { status: "Resolved", notes: "Fixed the mapping" } });
    expect(res.data).toMatchObject({ id: first.id, status: "Resolved", notes: "Fixed the mapping" });
    expect((await call("PATCH", `/errors/${first.id}`, { token: admin, body: { status: "Closed" } })).status).toBe(422);
    expect((await call("PATCH", "/errors/ERR-9999", { token: admin, body: { status: "Open" } })).status).toBe(404);
  });
});

describe("demo-only endpoints", () => {
  it("lists the demonstration accounts and resets the data", async () => {
    const accounts = (await call("GET", "/demo/accounts")).data;
    expect(accounts.map((a) => a.status)).toEqual(["Active", "Active", "Active", "Active", "Inactive", "Pending activation"]);
    const admin = await signIn("admin");
    await call("POST", "/categories", { token: admin, body: { name: "Temporary" } });
    expect((await call("POST", "/demo/reset")).status).toBe(204);
    expect(db().categories.some((c) => c.name === "Temporary")).toBe(false);
  });
});
