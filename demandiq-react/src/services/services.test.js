// The service files against the demo backend (demo mode, no delay): what pages and the store receive.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, configureApi, settle } from "./api";
import { tokenStore } from "./tokenStore";
import { authService } from "./authService";
import { dashboardService } from "./dashboardService";
import { salesService } from "./salesService";
import { forecastService, fromApiForecast } from "./forecastService";
import { inventoryService } from "./inventoryService";
import { reorderService } from "./reorderService";
import { adminService } from "./adminService";
import { reportService } from "./reportService";
import { activityService } from "./activityService";
import { db, resetForTests } from "./mock/db";
import { setReportDelay } from "./mock/routes/reports";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

async function signIn(login, password, roleId) {
  const result = await authService.login({ login, password, roleId });
  tokenStore.save(result.accessToken);
  return result;
}

// The global filters as the store keeps them: lists, empty = all
const FILTERS = {
  datePreset: "Last 3 Months",
  startDate: "2025-03-19",
  endDate: "2025-06-18",
  category: [],
  sku: [],
  region: [],
  model: [],
  status: [],
};

beforeEach(() => {
  configureApi({ mode: "demo", latency: 0 });
  tokenStore.useStorages({ local: memoryStorage(), session: memoryStorage() });
  resetForTests();
  setReportDelay(0);
});

afterEach(() => tokenStore.useStorages(null));

describe("authService", () => {
  it("signs in, restores the user from the token and signs out", async () => {
    const result = await signIn("analyst@demo.demandiq", "Analyze123!", 2);
    expect(result.user.name).toBe("Noura Alharbi");
    expect((await authService.getCurrentUser()).user.id).toBe("USR-1042");
    await authService.logout();
    const after = await settle(authService.getCurrentUser());
    expect(after.error).toMatchObject({ status: 401, code: "session_ended" });
  });

  it("rejects with an ApiError the sign-in page can show", async () => {
    const { error } = await settle(authService.login({ login: "analyst@demo.demandiq", password: "Analyze123!", roleId: 3 }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "role_mismatch", message: "This account isn't registered as an Inventory Supervisor." });
  });
});

describe("dashboardService", () => {
  it("sends the app's filters as query parameters", async () => {
    await signIn("store.manager@demo.demandiq", "Store123!", 1);
    const all = await dashboardService.getSummary(FILTERS);
    const central = await dashboardService.getSummary({ ...FILTERS, region: "Central" });
    const units = (summary) => summary.kpis.find((kpi) => kpi.id === "units_sold").value;
    expect([all.startDate, all.endDate]).toEqual(["2025-03-19", "2025-06-18"]);
    expect(units(central)).toBeLessThan(units(all));
  });
});

describe("forecastService", () => {
  it("turns the API's forecast into the shape the charts use", () => {
    const run = fromApiForecast({
      id: "FC-0001",
      sku: "PP-4012",
      model: "ARIMA",
      horizon: 2,
      status: "Completed",
      startDate: "2025-03-19",
      endDate: "2025-06-18",
      configuration: { horizon: 2, order: [2, 1, 2] },
      metrics: { mae: 12.5, rmse: 16.2, mape: null },
      evaluation: { holdoutDays: 14 },
      points: [
        { date: "2025-06-19", predicted: 125 },
        { date: "2025-06-20", predicted: 132 },
      ],
      generatedAt: "2025-06-26T08:00:00.000Z",
      generatedBy: null,
    });
    expect(run).toMatchObject({ id: "FC-0001", mae: 12.5, rmse: 16.2, mape: null, holdoutDays: 14 });
    expect(run.points).toEqual([
      { period: 1, date: "2025-06-19", forecast: 125 },
      { period: 2, date: "2025-06-20", forecast: 132 },
    ]);
    // Fields FastAPI may leave out get safe defaults
    expect(fromApiForecast({ id: "FC-2", sku: "X", model: "ARIMA", horizon: 1, generatedAt: "t" })).toMatchObject({
      configuration: {},
      mae: null,
      mape: null,
      holdoutDays: null,
      points: [],
      generatedBy: null,
    });
  });

  it("runs, lists and fetches forecasts in the app's shape", async () => {
    await signIn("analyst@demo.demandiq", "Analyze123!", 2);
    const run = await forecastService.runForecast({ sku: "PP-4012", model: "Moving Average", horizon: 14, startDate: "2025-03-19", endDate: "2025-06-18", windowSize: 7 });
    expect(run.points).toHaveLength(14);
    expect(run.points[0]).toEqual({ period: 1, date: "2025-06-19", forecast: expect.any(Number) });
    expect(run.configuration).toEqual({ horizon: 14, windowSize: 7 });
    expect((await forecastService.getForecasts())[0].id).toBe(run.id);
    expect(await forecastService.getForecastById(run.id)).toEqual(run);
  });

  it("returns the recommendation with the ranked models as objects", async () => {
    await signIn("analyst@demo.demandiq", "Analyze123!", 2);
    const result = await forecastService.getRecommendation({ skus: ["PP-4012", "CH-2155"], filters: FILTERS });
    expect(result.ranked.length).toBeGreaterThanOrEqual(2);
    expect(result.ranked[0].model).toBe(result.recommended);
    expect(result.ranked[0]).toHaveProperty("wins");
  });
});

describe("salesService", () => {
  it("uploads a File and reports a rejected one with its validation counts", async () => {
    await signIn("store.manager@demo.demandiq", "Store123!", 1);
    const good = new File(["Date,Product_ID,Units_Sold\n2025-06-26,PP-4012,40\n"], "june.csv", { type: "text/csv" });
    const created = await salesService.uploadDataset(good);
    expect(created.dataset).toMatchObject({ fileName: "june.csv", pendingCount: 1 });
    const bad = new File(["Date\n2025-06-26\n"], "bad.csv", { type: "text/csv" });
    const { error } = await settle(salesService.uploadDataset(bad));
    expect(error).toMatchObject({ status: 422, code: "invalid_file" });
    expect(error.details.validation.errors[0]).toBe(
      "Couldn't find a product column (SKU, Product ID, Item or Product Name …) and a quantity column (Units Sold, Quantity, Qty …). Columns in the file: Date.",
    );
    // Both attempts are in the dataset history, newest first
    const [last, previous] = await salesService.getDatasets();
    expect([last.fileName, last.validation, previous.fileName, previous.validation]).toEqual(["bad.csv", "Failed", "june.csv", "Valid"]);
  });
});

describe("inventory, reorders and admin services", () => {
  it("updates stock and reorders", async () => {
    await signIn("inventory@demo.demandiq", "Stock123!", 3);
    expect((await inventoryService.updateStock("PP-4012", { stock: 900, reason: "Cycle count" })).stock).toBe(900);
    expect((await inventoryService.getSnapshots({ start: "2025-06" })).map((s) => s.month)).toEqual(["2025-06"]);
    const order = await reorderService.createReorder({ sku: "PP-4012", quantity: 50, supplier: "Gulf Polymers Supply" });
    expect(order).toMatchObject({ status: "Ordered", deliveredAt: null });
    expect((await reorderService.updateReorderStatus(order.id, "Delivered")).status).toBe("Delivered");
    expect((await reorderService.getReorders())[0]).toMatchObject({ id: order.id, status: "Delivered" });
    expect(db().inventory.find((row) => row.sku === "PP-4012").stock).toBe(950);
  });

  it("changes screen access and permissions", async () => {
    await signIn("admin@demo.demandiq", "Admin123!", 4);
    const screens = await adminService.updateScreenAccess(3, ["SCR-01", "SCR-03"]);
    expect(screens["3"]).toEqual(["SCR-01", "SCR-03"]);
    const matrix = await adminService.updatePermission({ action: "Clean data", roleId: 1, value: "Yes" });
    expect(matrix["Clean data"]["1"]).toBe("Yes");
    expect((await adminService.restoreDefaults()).screens["3"]).toEqual(["SCR-01", "SCR-03", "SCR-04"]);
  });
});

describe("reportService", () => {
  it("generates a report, waits for it and downloads it", async () => {
    await signIn("store.manager@demo.demandiq", "Store123!", 1);
    const started = await reportService.generateReport({ name: "Product Performance Report", format: "CSV", filters: { ...FILTERS, region: "Central" } });
    expect(started).toMatchObject({ status: "Processing", filters: { start: "2025-03-19", end: "2025-06-18", region: ["Central"] } });
    const done = await reportService.waitForReport(started.id, { interval: 5 });
    expect(done.status).toBe("Completed");
    const file = await reportService.downloadReport(started.id);
    expect(file.fileName).toBe("product-performance-report.csv");
    expect((await reportService.getReports())[0].id).toBe(started.id);
  });

  it("stops waiting after the timeout", async () => {
    setReportDelay(200);
    await signIn("store.manager@demo.demandiq", "Store123!", 1);
    const started = await reportService.generateReport({ name: "Sales Summary", format: "PDF", filters: FILTERS });
    await expect(reportService.waitForReport(started.id, { interval: 5, timeout: 20 })).rejects.toThrow(/taking longer than expected/);
  });
});

describe("activityService", () => {
  it("reads the logs and updates an error", async () => {
    await signIn("admin@demo.demandiq", "Admin123!", 4);
    expect((await activityService.getActivity())[0].action).toBe("User login");
    expect((await activityService.getSessions())[0].logoutAt).toBeNull();
    const [first] = await activityService.getErrors();
    expect((await activityService.updateErrorStatus(first.id, "Investigating", "Looking into it")).notes).toBe("Looking into it");
    expect((await activityService.logEvent({ action: "Screen access denied", details: "#/x" })).status).toBe("Failed");
  });
});
