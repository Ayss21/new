import { describe, expect, it } from "vitest";
import { datasetCoverage, datasetLineage, forecastLineage, forecastingStatus } from "./lineage";

const sale = (date, sku, datasetId) => ({ id: `${sku}-${date}`, date, sku, units: 10, datasetId });

const datasets = [
  { id: "DS-1", fileName: "p101.csv", cleaning: "Completed", validation: "Valid" },
  { id: "DS-2", fileName: "p102.csv", cleaning: "Completed", validation: "Valid" },
  {
    id: "DS-3",
    fileName: "p101_next.csv",
    cleaning: "Pending",
    validation: "Valid",
    pendingRecords: [sale("2025-06-05", "P101", "DS-3"), sale("2025-06-06", "P102", "DS-3"), sale("2025-07-01", "P101", "DS-3")],
  },
  { id: "DS-4", fileName: "broken.csv", cleaning: "Not started", validation: "Failed" },
];
const sales = [
  sale("2025-05-30", "P101", null), // loaded before uploads existed
  sale("2025-06-01", "P101", "DS-1"),
  sale("2025-06-02", "P101", "DS-1"),
  sale("2025-06-01", "P102", "DS-2"),
];

describe("forecast lineage", () => {
  it("lists the uploads a forecast's records came from, oldest data first", () => {
    const lineage = forecastLineage({ sales, datasets }, { sku: "P101", startDate: "2025-05-01", endDate: "2025-06-30" });
    expect(lineage.records).toBe(3);
    expect(lineage.sources).toEqual([
      { datasetId: null, fileName: null, records: 1, firstDate: "2025-05-30", lastDate: "2025-05-30" },
      { datasetId: "DS-1", fileName: "p101.csv", records: 2, firstDate: "2025-06-01", lastDate: "2025-06-02" },
    ]);
  });

  it("names uploads waiting for cleaning that have the product's sales in the range", () => {
    const lineage = forecastLineage({ sales, datasets }, { sku: "P101", startDate: "2025-05-01", endDate: "2025-06-30" });
    // DS-3's 1 Jul record is outside the range and its P102 record is another product
    expect(lineage.waiting).toEqual([{ datasetId: "DS-3", fileName: "p101_next.csv", records: 1, firstDate: "2025-06-05", lastDate: "2025-06-05" }]);
    expect(forecastLineage({ sales, datasets }, { sku: "P102", startDate: "2025-06-01", endDate: "2025-06-01" }).waiting).toEqual([]);
  });

  it("describes what an upload covers", () => {
    expect(datasetCoverage(datasets[2].pendingRecords)).toEqual({ firstDate: "2025-06-05", lastDate: "2025-07-01", products: 2 });
    expect(datasetCoverage([])).toBeNull();
  });
});

describe("dataset forecasting status", () => {
  const runFor = (id, sku, generatedAt) => ({
    id,
    sku,
    generatedAt,
    lineage: forecastLineage({ sales, datasets }, { sku, startDate: "2025-05-01", endDate: "2025-06-30" }),
  });
  const statusOf = (forecasts, list = datasets, rows = sales) => {
    const lineage = datasetLineage(list, rows, forecasts);
    return Object.fromEntries(list.map((d) => [d.id, forecastingStatus(d, lineage.get(d.id))]));
  };

  it("changes only for the uploads a forecast used", () => {
    expect(statusOf([])).toEqual({ "DS-1": "Pending", "DS-2": "Pending", "DS-3": "Pending", "DS-4": "Not started" });
    expect(statusOf([runFor("FC-1", "P101", "2025-07-02T10:00:00Z")])).toEqual({
      "DS-1": "Completed", // its only product was forecast with its records
      "DS-2": "Pending", // P102 only: not used by a P101 forecast
      "DS-3": "Pending", // not cleaned, so not in the history
      "DS-4": "Not started",
    });
  });

  it("is Partial until every product of an upload has been forecast", () => {
    const mixed = [{ id: "DS-5", fileName: "both.csv", cleaning: "Completed", validation: "Valid" }];
    const rows = [sale("2025-06-01", "P101", "DS-5"), sale("2025-06-01", "P102", "DS-5")];
    const run = (id, sku, at) => ({ id, sku, generatedAt: at, lineage: forecastLineage({ sales: rows, datasets: mixed }, { sku, startDate: "2025-06-01", endDate: "2025-06-01" }) });
    const one = [run("FC-1", "P101", "2025-07-01T09:00:00Z")];
    expect(statusOf(one, mixed, rows)).toEqual({ "DS-5": "Partial" });
    const both = [run("FC-2", "P102", "2025-07-02T09:00:00Z"), ...one];
    expect(statusOf(both, mixed, rows)).toEqual({ "DS-5": "Completed" });
    expect(datasetLineage(mixed, rows, both).get("DS-5")).toEqual({
      recordsInHistory: 2,
      skus: ["P101", "P102"],
      forecastedSkus: ["P101", "P102"],
      forecastIds: ["FC-2", "FC-1"],
      forecastedAt: "2025-07-01T09:00:00Z",
    });
  });

  it("is Not needed when none of a cleaned upload's records are in the history", () => {
    const skipped = [{ id: "DS-6", fileName: "dupes.csv", cleaning: "Completed", validation: "Valid" }];
    expect(statusOf([], skipped, sales)).toEqual({ "DS-6": "Not needed" });
  });

  it("stays Completed when a later upload replaces records a forecast already used", () => {
    const run = runFor("FC-1", "P101", "2025-07-02T10:00:00Z");
    const replaced = sales.map((row) => (row.datasetId === "DS-1" ? { ...row, datasetId: "DS-9" } : row));
    expect(statusOf([run], datasets, replaced)["DS-1"]).toBe("Completed");
  });
});
