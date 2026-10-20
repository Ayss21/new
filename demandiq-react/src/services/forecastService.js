// Run, list and compare forecasts; recommend a model for a group of products.
//
// The API sends a run as { id, sku, model, horizon, status, startDate, endDate, configuration,
// metrics: { mae, rmse, mape }, evaluation: { holdoutDays }, points: [{ date, predicted }], lineage,
// generatedAt, generatedBy }. The app's charts and tables use { mae, rmse, mape, points: [{ period, date, forecast }] },
// so fromApiForecast translates; nothing else in the app depends on the API's field names.
import { api } from "./api";
import { filterQuery, segment } from "./query";

export function fromApiForecast(run) {
  return {
    id: run.id,
    sku: run.sku,
    model: run.model,
    horizon: run.horizon,
    status: run.status,
    startDate: run.startDate,
    endDate: run.endDate,
    configuration: run.configuration ?? {},
    mae: run.metrics?.mae ?? null,
    rmse: run.metrics?.rmse ?? null,
    mape: run.metrics?.mape ?? null,
    holdoutDays: run.evaluation?.holdoutDays ?? null,
    points: (run.points ?? []).map((point, index) => ({ period: index + 1, date: point.date, forecast: point.predicted })),
    // { records, sources: [{ datasetId, fileName, records, firstDate, lastDate }], waiting: [...] }
    lineage: run.lineage ?? null,
    generatedAt: run.generatedAt,
    generatedBy: run.generatedBy ?? null,
  };
}

/** The request body: Moving Average sends its window, ARIMA its (p, d, q) order. */
function forecastRequest({ sku, model, horizon, startDate, endDate, windowSize = 7, order = [2, 1, 2] }) {
  return {
    sku,
    model,
    horizon,
    startDate,
    endDate,
    ...(model === "Moving Average" ? { windowSize } : {}),
    ...(model === "ARIMA" ? { order } : {}),
  };
}

export const forecastService = {
  /** POST /forecasts { sku, model, horizon, startDate, endDate, windowSize?, order? } → 201 run (saved) */
  runForecast: async (data) => fromApiForecast(await api.post("/forecasts", forecastRequest(data))),

  /** GET /forecasts → saved runs, newest first */
  getForecasts: async () => (await api.get("/forecasts")).map(fromApiForecast),

  /** GET /forecasts/{id} → one run */
  getForecastById: async (id) => fromApiForecast(await api.get(`/forecasts/${segment(id)}`)),

  /**
   * GET /forecasts/lineage?sku&start&end → { sku, startDate, endDate, days, records, sources, waiting }
   * Which uploads a forecast with these settings would use, before running it: the cleaned uploads its
   * records come from, and uploads still waiting for cleaning that have sales in the range (not used).
   */
  getLineage: ({ sku, startDate, endDate }) => api.get("/forecasts/lineage", { query: { sku, start: startDate, end: endDate } }),

  /**
   * POST /forecasts/compare { sku, horizon, startDate, endDate, windowSize, order } — all three models, nothing saved
   * → { sku, horizon, startDate, endDate, results: [{ model, status, metrics, totalPredicted, error }] }
   */
  compareModels: ({ sku, horizon, startDate, endDate, windowSize = 7, order = [2, 1, 2] }) =>
    api.post("/forecasts/compare", { sku, horizon, startDate, endDate, windowSize, order }),

  /**
   * POST /forecasts/recommendation { skus, filters: { start, end, category: [], sku: [], region: [] } }
   * — which model is most accurate for these products, tested on the sales that match the filters (the same
   * sales the dashboard classified)
   * → { skus, startDate, endDate, metric, recommended, reason, days, testDays, margin, close, ranked: [model names], models: [...] }
   * ranked is turned into the model objects, best first.
   */
  getRecommendation: async ({ skus, filters }) => {
    const result = await api.post("/forecasts/recommendation", { skus, filters: filterQuery(filters) });
    return { ...result, ranked: result.ranked.map((name) => result.models.find((m) => m.model === name)).filter(Boolean) };
  },
};
