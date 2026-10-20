import { describe, expect, it } from "vitest";
import { aggregateDaily, dailySeries, forecastInView, stockByCategory } from "./domain";
import { daysInRange, formatDay, formatRange } from "./format";
import { fittedAxis } from "../components/ui/DataLineChart";
import { columnAxis } from "../components/ui/ColumnChart";
import { pageWindow } from "../components/ui/TableFooter";

const rows = [
  { date: "2025-01-02", sku: "A", units: 5 },
  { date: "2024-12-31", sku: "A", units: 3 },
  { date: "2024-12-31", sku: "B", units: 2 },
];

describe("chart data", () => {
  it("keeps days in date order across a year end", () => {
    expect(aggregateDaily(rows).map((p) => p.date)).toEqual(["2024-12-31", "2025-01-02"]);
  });

  it("fills every day of the range, with 0 on days without sales", () => {
    expect(dailySeries(rows, "2024-12-30", "2025-01-02")).toEqual([
      { date: "2024-12-30", value: 0 },
      { date: "2024-12-31", value: 5 },
      { date: "2025-01-01", value: 0 },
      { date: "2025-01-02", value: 5 },
    ]);
    expect(dailySeries([], "2025-01-02", "2025-01-01")).toEqual([]);
  });

  it("sums stock per category, largest first", () => {
    const stock = stockByCategory([
      { sku: "P1", category: "Polymers", stock: 100 },
      { sku: "C1", category: "Chemicals", stock: 300 },
      { sku: "P2", category: "Polymers", stock: 250 },
    ]);
    expect(stock).toEqual([
      { label: "Polymers", value: 350, products: ["P1", "P2"] },
      { label: "Chemicals", value: 300, products: ["C1"] },
    ]);
  });

  it("uses the newest forecast whose product is in the filtered sales", () => {
    const history = [{ sku: "C" }, { sku: "A" }, { sku: "B" }];
    expect(forecastInView(history, rows)?.sku).toBe("A");
    expect(forecastInView(history, [{ sku: "Z" }])).toBeNull();
  });

  it("puts unit ticks on round numbers around the data", () => {
    const axis = fittedAxis([61, 86], 6);
    expect(axis.ticks).toEqual([90, 85, 80, 75, 70, 65, 60]);
    expect(columnAxis([28012, 19100]).ticks).toEqual([30000, 20000, 10000, 0]);
  });
});

describe("date labels", () => {
  it("formats ranges readably and counts days inclusively", () => {
    expect(formatDay("2025-03-19")).toBe("19 Mar 2025");
    expect(formatRange("2025-03-19", "2025-06-18")).toBe("19 Mar – 18 Jun 2025");
    expect(formatRange("2024-12-19", "2025-06-18")).toBe("19 Dec 2024 – 18 Jun 2025");
    expect(daysInRange("2025-03-19", "2025-06-18")).toBe(92);
  });
});

describe("pagination", () => {
  it("shows every page when there are few, otherwise first, last and the pages around the current one", () => {
    expect(pageWindow(1, 2)).toEqual([1, 2]);
    expect(pageWindow(1, 8)).toEqual([1, 2, 3, 4, 5, "…", 8]);
    expect(pageWindow(5, 8)).toEqual([1, "…", 4, 5, 6, "…", 8]);
    expect(pageWindow(8, 8)).toEqual([1, "…", 4, 5, 6, 7, 8]);
  });
});
