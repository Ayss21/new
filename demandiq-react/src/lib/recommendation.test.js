import { describe, expect, it } from "vitest";
import { COMPARISON_SETTINGS, MIN_TEST_DAYS, classifyProducts, compareModelsForProducts, filterSales, runForecast } from "./domain";
import { initialInventory, sampleSales } from "../data/seed";
import { pieSlices } from "../components/ui/PieChart";

const START = "2025-03-19";
const END = "2025-06-18";
const sales = filterSales(sampleSales, { startDate: START, endDate: END });
const skus = initialInventory.map((item) => item.sku);
const { rows } = classifyProducts(sales, skus, START, END);
const productsOf = (type) => rows.filter((row) => row.type === type).map((row) => row.sku);

describe("model recommendation per demand type", () => {
  it("tests every model on every product and recommends the lowest average error", () => {
    for (const type of ["Smooth", "Erratic", "Intermittent", "Lumpy"]) {
      const list = productsOf(type);
      const result = compareModelsForProducts(sales, list, START, END);
      expect(result.reason).toBeNull();
      expect(result.testDays).toBe(14);
      // Recompute each model's average independently with the same runs
      const averages = result.models.map((m) => {
        const runs = list.map((sku) => runForecast(sales, { ...COMPARISON_SETTINGS, sku, model: m.model, startDate: START, endDate: END }));
        const values = runs.map((run) => run[result.metric]);
        return { model: m.model, value: values.reduce((sum, v) => sum + v, 0) / values.length };
      });
      const best = [...averages].sort((a, b) => a.value - b.value)[0];
      expect(result.recommended).toBe(best.model);
      const winner = result.models.find((m) => m.model === result.recommended);
      expect(winner[result.metric]).toBeCloseTo(best.value, 10);
      // Wins add up to the number of products
      expect(result.models.reduce((sum, m) => sum + m.wins, 0)).toBe(list.length);
    }
  });

  it("uses MAPE when it exists for every product and MAE when days without sales make MAPE impossible", () => {
    expect(compareModelsForProducts(sales, productsOf("Smooth"), START, END).metric).toBe("mape");
    expect(compareModelsForProducts(sales, productsOf("Lumpy"), START, END).metric).toBe("mae");
  });

  it("leaves out a model that cannot run on the range and compares the rest", () => {
    const result = compareModelsForProducts(sales, productsOf("Smooth"), "2025-05-20", END); // 30 days
    const arima = result.models.find((m) => m.model === "ARIMA");
    expect(arima.eligible).toBe(false);
    expect(arima.error).toMatch(/needs at least/);
    expect(result.ranked).toHaveLength(2);
    expect(["Moving Average", "Linear Regression"]).toContain(result.recommended);
  });

  it("does not recommend anything when the results are insufficient", () => {
    const short = compareModelsForProducts(sales, productsOf("Smooth"), "2025-05-25", END); // 25 days → 6 test days
    expect(short.testDays).toBeLessThan(MIN_TEST_DAYS);
    expect(short.recommended).toBeNull();
    expect(short.reason).toMatch(/at least 7/);
    const none = compareModelsForProducts(sales, [], START, END);
    expect(none.recommended).toBeNull();
    expect(none.reason).toMatch(/no products/);
  });
});

describe("pie slices", () => {
  it("splits the circle by value, skips empty items and draws a single item as a full circle", () => {
    const slices = pieSlices([
      { key: "a", value: 5 },
      { key: "b", value: 0 },
      { key: "c", value: 2 },
      { key: "d", value: 4 },
    ]);
    expect(slices.map((s) => s.key)).toEqual(["a", "c", "d"]);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
    expect(slices.at(-1).end).toBeCloseTo(Math.PI * 2, 10);
    expect(slices[0].path).toMatch(/^M 0 0 L/);
    expect(pieSlices([{ key: "only", value: 3 }])[0].path).toBeNull();
  });
});
