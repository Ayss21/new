import { describe, expect, it } from "vitest";
import { formatKpi, salesGrowth } from "./dashboard";

const sale = (date, netRevenue, extra = {}) => ({ date, netRevenue, category: "Polymers", sku: "PP-4012", region: "Central", ...extra });

describe("sales growth", () => {
  it("compares revenue with the period of the same length just before", () => {
    const sales = [sale("2025-01-01", 100), sale("2025-01-02", 100), sale("2025-01-03", 150), sale("2025-01-04", 150)];
    expect(salesGrowth(sales, { startDate: "2025-01-03", endDate: "2025-01-04" })).toEqual({
      value: 50,
      previousStart: "2025-01-01",
      previousEnd: "2025-01-02",
      partial: false,
    });
  });

  it("compares average daily revenue when the history starts inside the earlier period", () => {
    // The history starts on 2 Jan, so the earlier period (1–2 Jan) has one day of data: 100 a day vs 150 a day
    const sales = [sale("2025-01-02", 100), sale("2025-01-03", 150), sale("2025-01-04", 150)];
    expect(salesGrowth(sales, { startDate: "2025-01-03", endDate: "2025-01-04" })).toMatchObject({ value: 50, previousStart: "2025-01-02", partial: true });
  });

  it("is empty without earlier sales, and uses only the filtered sales", () => {
    expect(salesGrowth([sale("2025-01-03", 150)], { startDate: "2025-01-03", endDate: "2025-01-03" }).value).toBeNull();
    const sales = [sale("2025-01-01", 100), sale("2025-01-01", 900, { region: "West" }), sale("2025-01-02", 200)];
    expect(salesGrowth(sales, { startDate: "2025-01-02", endDate: "2025-01-02", region: ["Central"] }).value).toBe(100);
  });

  it("is shown with its sign", () => {
    expect(formatKpi({ format: "growth", value: 12.345 })).toBe("+12.3%");
    expect(formatKpi({ format: "growth", value: -4 })).toBe("−4.0%");
    expect(formatKpi({ format: "growth", value: 0.04 })).toBe("0.0%");
    expect(formatKpi({ format: "growth", value: null })).toBe("N/A");
  });
});
