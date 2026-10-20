import { describe, expect, it } from "vitest";
import { arimaForecast } from "./arima";
import {
  applyForecastToInventory,
  authenticateDemoUser,
  calculateMetrics,
  cleanDataset,
  createInitialInventory,
  createPendingUploadRecords,
  createSampleSales,
  defaultFilters,
  demoAccounts,
  filterInventory,
  filterSales,
  parseSalesCsv,
  presetRange,
  reportRows,
  SAMPLE_START,
  NOT_ENOUGH_DATA,
  classifyDemand,
  classifyProducts,
  demandSeries,
  monthlyInventoryTrend,
  monthsInRange,
  updateSnapshot,
  runForecast,
  updateInventoryRecord,
  validationLabel,
} from "./domain";

// Tests from the Figma Make prototype
describe("shared application data", () => {
  const sales = createSampleSales();
  const inventory = createInitialInventory();

  it("combines region and category filters and calculates metrics from exact records", () => {
    const filters = { ...defaultFilters, region: "East", category: "Chemicals" };
    const filteredSales = filterSales(sales, filters);
    expect(filteredSales.length).toBeGreaterThan(0);
    expect(filteredSales.every((row) => row.region === "East" && row.category === "Chemicals")).toBe(true);
    expect(calculateMetrics(filteredSales, filterInventory(inventory, filters)).units).toBe(
      filteredSales.reduce((sum, row) => sum + row.units, 0),
    );
  });

  it("clearing filters restores the default 3-month view, and the full range shows every record", () => {
    const all = { ...defaultFilters, startDate: SAMPLE_START, endDate: "2025-06-18" };
    expect(filterSales(sales, all)).toHaveLength(sales.length);
    const view = filterSales(sales, defaultFilters);
    expect(view.length).toBeGreaterThan(0);
    expect(view.every((row) => row.date >= "2025-03-19" && row.date <= "2025-06-18")).toBe(true);
  });

  it("filters critical inventory and updates stock-derived status", () => {
    const critical = filterInventory(inventory, { ...defaultFilters, status: "Critical" });
    expect(critical.length).toBe(2);
    expect(critical.every((row) => row.status === "Critical")).toBe(true);
    const updated = updateInventoryRecord(inventory, "PE-7820", 900);
    expect(updated.find((row) => row.sku === "PE-7820")?.status).toBe("Safe");
  });

  it("runs distinct supported forecasting algorithms", () => {
    const moving = runForecast(sales, { sku: "PP-4012", model: "Moving Average", horizon: 7, windowSize: 7 });
    const regression = runForecast(sales, { sku: "PP-4012", model: "Linear Regression", horizon: 7 });
    const arima = runForecast(sales, { sku: "PP-4012", model: "ARIMA", horizon: 7, order: [2, 1, 2] });
    expect(moving.points).toHaveLength(7);
    expect(regression.points).toHaveLength(7);
    expect(arima.points).toHaveLength(7);
    expect(moving.points.map((point) => point.forecast)).not.toEqual(regression.points.map((point) => point.forecast));
    expect(arima.points.map((point) => point.forecast)).not.toEqual(moving.points.map((point) => point.forecast));
    expect(moving.mae).not.toBeNull();
    expect(arima.mape).not.toBeNull();
    expect(arima.configuration.order).toEqual([2, 1, 2]);
  });

  it("accepts CSV with its own column names and says which column is missing", () => {
    expect(parseSalesCsv("Date,Product_ID,Units_Sold\n2025-06-18,PP-4012,42").valid).toBe(1);
    expect(parseSalesCsv("Order Date,Product,Units\n2025-06-18,PP-4012,42").valid).toBe(1);
    expect(parseSalesCsv("Date,Customer,Units\n2025-06-18,Acme,42").errors[0]).toBe(
      "Couldn't find a product column (SKU, Product ID, Item or Product Name …). Columns in the file: Date, Customer, Units.",
    );
  });

  it("rejects arbitrary credentials and accepts each configured role account", () => {
    expect(authenticateDemoUser("random@example.com", "anything")).toBeNull();
    expect(authenticateDemoUser("admin@demo.demandiq", "wrong")).toBeNull();
    expect(new Set(demoAccounts.map((account) => authenticateDemoUser(account.email, account.password)?.roleId))).toEqual(
      new Set([1, 2, 3, 4]),
    );
  });

  it("uses units × price × (1 − discount) as the revenue formula", () => {
    const row = sales.find((record) => record.discountRate > 0);
    expect(row.netRevenue).toBe(Number((row.units * row.unitPrice * (1 - row.discountRate)).toFixed(2)));
  });

  it("creates report rows only from the filtered dataset", () => {
    const filters = { ...defaultFilters, region: "West", category: "Specialties" };
    const filteredSales = filterSales(sales, filters);
    const rows = reportRows(filteredSales, filterInventory(inventory, filters));
    expect(rows).toHaveLength(filteredSales.length);
    expect(rows.every((row) => row.Region === "West" && row.Category === "Specialties")).toBe(true);
  });

  it("rejects forecasting when historical data is insufficient", () => {
    expect(() => runForecast(sales.slice(0, 10), { sku: "PP-4012", model: "Moving Average", horizon: 7 })).toThrow(
      "At least 21",
    );
  });

  it("detects duplicate, invalid-date, and invalid-numeric upload rows", () => {
    const result = parseSalesCsv(
      "Date,Product_ID,Units_Sold\n2025-06-18,PP-4012,42\n2025-06-18,PP-4012,42\nbad-date,PP-4012,12\n2025-06-17,PP-4012,nope",
    );
    expect(result.valid).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.invalidDates).toBe(1);
    expect(result.invalidNumeric).toBe(1);
  });

  it("counts fractional units and unusable prices or discounts as invalid numbers", () => {
    const result = parseSalesCsv(
      [
        "Date,Product_ID,Units_Sold,Unit_Price,Discount_Rate",
        "2025-06-18,PP-4012,42,,", // product's price, no discount
        "2025-06-19,PP-4012,40,250,0.05",
        "2025-06-20,PP-4012,12.5,,",
        "2025-06-21,PP-4012,10,abc,",
        "2025-06-22,PP-4012,10,-5,",
        "2025-06-23,PP-4012,10,,-0.1",
      ].join("\n"),
    );
    expect([result.valid, result.invalidNumeric]).toEqual([2, 4]);
    expect(result.records.map((r) => [r.unitPrice, r.discountRate, r.netRevenue])).toEqual([
      [248, 0, 10416],
      [250, 0.05, 9500],
    ]);
    // A discount column with values above 1 holds percentages; more than 100% can't be used
    const percent = parseSalesCsv(["Date,SKU,Qty,Price,Discount", "2025-06-18,PP-4012,10,100,5", "2025-06-19,PP-4012,10,100,12.5%", "2025-06-20,PP-4012,10,100,120"].join("\n"));
    expect([percent.valid, percent.invalidNumeric]).toEqual([2, 1]);
    expect(percent.records.map((r) => r.discountRate)).toEqual([0.05, 0.125]);
  });
});

// Tests for the features added on top of the prototype
describe("ARIMA", () => {
  it("recovers a known AR(1) process", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
    const y = [50];
    for (let i = 1; i < 2000; i++) y.push(50 + 0.7 * (y[i - 1] - 50) + gauss());
    const [next] = arimaForecast(y, 1, 1, 0, 0);
    expect(next).toBeCloseTo(50 + 0.7 * (y[1999] - 50), 0);
  });

  it("continues a linear trend with d = 1", () => {
    const y = Array.from({ length: 60 }, (_, i) => 100 + 3 * i);
    const forecast = arimaForecast(y, 3, 1, 1, 0);
    forecast.forEach((value, i) => expect(value).toBeCloseTo(100 + 3 * (60 + i), 0));
  });

  it("rejects invalid orders and short histories", () => {
    const sales = createSampleSales();
    expect(() => runForecast(sales, { sku: "PP-4012", model: "ARIMA", horizon: 7, order: [6, 1, 0] })).toThrow(
      "p must be between 0 and 5",
    );
    expect(() => arimaForecast([1, 2, 3, 4, 5], 2, 2, 1, 2)).toThrow("needs at least");
  });
});

describe("data cleaning and pipeline", () => {
  const sales = createSampleSales();

  it("labels validation results like the dataset history", () => {
    expect(
      validationLabel({ valid: 10, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, errors: [] }),
    ).toBe("Valid");
    expect(
      validationLabel({ valid: 10, missing: 2, duplicates: 1, invalidDates: 0, invalidNumeric: 0, errors: [] }),
    ).toBe("3 warnings");
    expect(
      validationLabel({ valid: 0, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, errors: ["x"] }),
    ).toBe("Failed");
  });

  it("caps the keying error in the pending upload and adds the new week", () => {
    const pending = createPendingUploadRecords();
    const { merged, summary } = cleanDataset(pending, sales, { capOutliers: true, overlap: "replace" }, 2, "Tester");
    expect(summary.outliersCapped).toBe(1);
    expect(summary.added).toBe(pending.length);
    expect(merged).toHaveLength(sales.length + pending.length);
    const spike = merged.find((row) => row.sku === "CH-2155" && row.date === "2025-06-21");
    expect(spike.units).toBeLessThan(500);
  });

  it("replaces or skips records that already exist", () => {
    const correction = [{ ...sales[0], units: sales[0].units + 5 }];
    const replaced = cleanDataset(correction, sales, { capOutliers: false, overlap: "replace" }, 0, "Tester");
    expect(replaced.summary.replaced).toBe(1);
    expect(replaced.merged.find((r) => r.date === sales[0].date && r.sku === sales[0].sku).units).toBe(
      sales[0].units + 5,
    );
    const skipped = cleanDataset(correction, sales, { capOutliers: false, overlap: "skip" }, 0, "Tester");
    expect(skipped.summary.skipped).toBe(1);
    expect(skipped.merged).toHaveLength(sales.length);
  });

  it("uses a forecast to update the SKU's demand and reorder suggestion", () => {
    const inventory = createInitialInventory();
    const result = runForecast(sales, { sku: "PE-7820", model: "Moving Average", horizon: 30, windowSize: 7 });
    const updated = applyForecastToInventory(inventory, result).find((r) => r.sku === "PE-7820");
    const expected = Math.round((result.points.reduce((s, p) => s + p.forecast, 0) / 30) * 30);
    expect(updated.demand).toBe(expected);
    expect(updated.suggested).toBe(Math.max(0, expected + updated.safety - updated.stock));
  });

  it("builds date presets from the latest sales date", () => {
    expect(presetRange("Last 30 Days", "2025-06-18", "2024-12-19")).toEqual(["2025-05-20", "2025-06-18"]);
    expect(presetRange("Last 3 Months", "2025-06-18", "2024-12-19")).toEqual(["2025-03-19", "2025-06-18"]);
    expect(presetRange("Last 6 Months", "2025-06-18", "2024-12-19")).toEqual(["2024-12-19", "2025-06-18"]);
    // Never starts before the first available date
    expect(presetRange("Last 6 Months", "2025-06-18", "2025-02-01")).toEqual(["2025-02-01", "2025-06-18"]);
    expect(presetRange("Custom Range", "2025-06-18", "2024-12-19")).toBeNull();
  });

  it("covers six months of demo sales ending 18 Jun 2025", () => {
    const dates = sales.map((row) => row.date).sort();
    expect(dates[0]).toBe("2024-12-19");
    expect(dates.at(-1)).toBe("2025-06-18");
  });
});

describe("demand series", () => {
  it("fills days without sales with zero", () => {
    const records = [
      { date: "2025-06-01", sku: "X-1", units: 5 },
      { date: "2025-06-04", sku: "X-1", units: 3 },
      { date: "2025-06-04", sku: "X-1", units: 2 },
      { date: "2025-06-02", sku: "Y-2", units: 9 },
    ];
    expect(demandSeries(records, "X-1", "2025-05-31", "2025-06-05")).toEqual([
      { date: "2025-05-31", units: 0 },
      { date: "2025-06-01", units: 5 },
      { date: "2025-06-02", units: 0 },
      { date: "2025-06-03", units: 0 },
      { date: "2025-06-04", units: 5 },
      { date: "2025-06-05", units: 0 },
    ]);
    // Without a range it spans the first to the last date in the records
    expect(demandSeries(records, "X-1").map((p) => p.units)).toEqual([5, 0, 0, 5]);
  });
});

describe("demand type classification (Syntetos–Boylan)", () => {
  it("uses ADI = days ÷ sale days and CV² of the non-zero sales", () => {
    const result = classifyDemand([10, 0, 10, 0, 20, 0]);
    expect(result.adi).toBeCloseTo(2);
    // mean 13.33, population std 4.714 → CV² = 0.125
    expect(result.cv2).toBeCloseTo(0.125, 3);
    expect(result.type).toBe("Intermittent");
  });

  it("applies the 1.32 and 0.49 cut-offs", () => {
    expect(classifyDemand([10, 11, 9, 10, 12, 10, 9, 11]).type).toBe("Smooth");
    expect(classifyDemand([1, 40, 2, 60, 1, 3, 90, 2]).type).toBe("Erratic");
    expect(classifyDemand([10, 0, 0, 11, 0, 0, 9, 0]).type).toBe("Intermittent");
    expect(classifyDemand([1, 0, 0, 80, 0, 0, 2, 0, 0, 50]).type).toBe("Lumpy");
    // Boundaries: ADI exactly 1.32 or CV² exactly 0.49 count as the "high" side
    const adiAtCutoff = classifyDemand([...Array(25).fill(5), ...Array(8).fill(0)]); // 33 ÷ 25 = 1.32
    expect(adiAtCutoff.adi).toBeCloseTo(1.32);
    expect(adiAtCutoff.type).toBe("Intermittent");
  });

  it("returns Not enough data for fewer than 2 sale days", () => {
    expect(classifyDemand([0, 0, 0]).type).toBe(NOT_ENOUGH_DATA);
    expect(classifyDemand([0, 7, 0]).type).toBe(NOT_ENOUGH_DATA);
    expect(classifyDemand([]).type).toBe(NOT_ENOUGH_DATA);
  });

  it("gives all four types in the demo data and keeps PP-4012 smooth", () => {
    const sales = createSampleSales();
    const skus = createInitialInventory().map((item) => item.sku);
    for (const [start, end] of [
      ["2025-05-20", "2025-06-18"],
      ["2025-03-19", "2025-06-18"],
      ["2024-12-19", "2025-06-18"],
    ]) {
      const { rows, counts } = classifyProducts(sales, skus, start, end);
      expect(counts).toEqual({ Smooth: 5, Erratic: 2, Intermittent: 2, Lumpy: 2, [NOT_ENOUGH_DATA]: 0 });
      expect(rows.find((row) => row.sku === "PP-4012").type).toBe("Smooth");
    }
  });

  it("does not count products without enough sales", () => {
    const sales = [{ date: "2025-06-01", sku: "A-1", units: 3 }];
    const { counts } = classifyProducts(sales, ["A-1", "B-2"], "2025-06-01", "2025-06-10");
    expect(counts[NOT_ENOUGH_DATA]).toBe(2);
    expect(counts.Smooth + counts.Erratic + counts.Intermittent + counts.Lumpy).toBe(0);
  });
});

describe("monthly inventory trends", () => {
  const product = { sku: "A-1", safety: 100, reorder: 300 };
  const snapshots = [
    {
      month: "2025-04",
      asOf: "2025-04-30",
      items: [
        { sku: "A-1", stock: 500, status: "Safe" },
        { sku: "B-2", stock: 200, status: "Warning" },
        { sku: "C-3", stock: 50, status: "Critical" },
        { sku: "D-4", stock: 400, status: "Safe" },
      ],
    },
    { month: "2025-06", asOf: "2025-06-18", items: [{ sku: "A-1", stock: 250, status: "Warning" }] },
  ];

  it("lists the calendar months in a date range", () => {
    expect(monthsInRange("2025-03-19", "2025-06-18")).toEqual(["2025-03", "2025-04", "2025-05", "2025-06"]);
    expect(monthsInRange("2024-12-19", "2025-01-02")).toEqual(["2024-12", "2025-01"]);
  });

  it("sums units and products per status and shows No data for months without a snapshot", () => {
    const trend = monthlyInventoryTrend(snapshots, "2025-04-01", "2025-06-18");
    expect(trend.map((m) => m.month)).toEqual(["2025-04", "2025-05", "2025-06"]);
    expect(trend[0].groups).toEqual({
      Safe: { units: 900, products: 2 },
      Warning: { units: 200, products: 1 },
      Critical: { units: 50, products: 1 },
    });
    expect(trend[1].hasData).toBe(false);
    expect(trend[1].groups.Safe.units).toBe(0);
    expect(trend[2].groups.Warning).toEqual({ units: 250, products: 1 });
  });

  it("counts only the products that match the global filters", () => {
    const [april] = monthlyInventoryTrend(snapshots, "2025-04-01", "2025-04-30", ["A-1", "C-3"]);
    expect(april.groups.Safe).toEqual({ units: 500, products: 1 });
    expect(april.groups.Warning).toEqual({ units: 0, products: 0 });
  });

  it("updates the current month's snapshot when stock changes", () => {
    const updated = updateSnapshot(snapshots, "2025-06", "2025-06-26", { sku: "A-1", stock: 80 }, product);
    expect(updated.find((s) => s.month === "2025-06").items).toEqual([{ sku: "A-1", stock: 80, status: "Critical" }]);
    expect(updated.find((s) => s.month === "2025-04")).toBe(snapshots[0]);
    const created = updateSnapshot(snapshots, "2025-07", "2025-07-01", { sku: "A-1", stock: 600 }, product);
    expect(created.find((s) => s.month === "2025-07").items[0].status).toBe("Safe");
  });
});
