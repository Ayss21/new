// /forecasts — run, list and compare forecasts; their dataset lineage; model recommendation per demand type
// (demo backend).
//
// Forecasts use the shared, cleaned sales history for one product and date range — not one chosen upload.
// Each saved run records its lineage: which uploads its records came from, and which uploads waiting for
// cleaning had sales in its range but weren't used (lib/lineage.js). Uploads' forecasting status is worked
// out from that lineage, so running a forecast never marks an upload it didn't use.
import { validateArimaOrder } from "../../../lib/arima";
import { FORECAST_MODELS, applyForecastToInventory, compareModelsForProducts, filterSales, runForecast } from "../../../lib/domain";
import { forecastLineage } from "../../../lib/lineage";
import { nextId } from "../db";
import { created, fail, invalid, logError, logEvent, ok, requireAction, requireView } from "../http";
import { filtersFromQuery, toApiForecast } from "../shapes";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a forecast request body. Returns { sku, model, horizon, startDate, endDate, windowSize, order }. */
function readRequest(req, { needsModel = true } = {}) {
  const body = req.body ?? {};
  const { sku, model, horizon, startDate, endDate } = body;
  const windowSize = body.windowSize ?? 7;
  const order = body.order ?? [2, 1, 2];
  invalid({
    sku: !req.db.inventory.some((item) => item.sku === sku) && "Choose an existing product SKU.",
    model: needsModel && !FORECAST_MODELS.includes(model) && `Use one of: ${FORECAST_MODELS.join(", ")}.`,
    horizon: !(Number.isInteger(horizon) && horizon >= 1 && horizon <= 365) && "Use a whole number of days from 1 to 365.",
    startDate: !(ISO_DATE.test(startDate ?? "") && !Number.isNaN(Date.parse(startDate))) && "Use a date like 2025-03-19.",
    endDate: !(ISO_DATE.test(endDate ?? "") && !Number.isNaN(Date.parse(endDate))) && "Use a date like 2025-06-18.",
    windowSize: !(Number.isInteger(windowSize) && windowSize >= 2 && windowSize <= 60) && "Use a whole number from 2 to 60.",
  });
  if (startDate > endDate) invalid({ startDate: "The start date must be on or before the end date." });
  const shapeProblem = !Array.isArray(order) || order.length !== 3 || order.some((v) => !Number.isInteger(v)) ? "Send order as [p, d, q]." : null;
  // A compare request still runs the other two models when the ARIMA order is out of range
  invalid({ order: shapeProblem ?? (needsModel && model === "ARIMA" && validateArimaOrder(order)) });
  return { sku, model, horizon, startDate, endDate, windowSize, order };
}

/** GET /forecasts — saved runs, newest first */
export function list(req) {
  return ok(req.db.forecasts.map(toApiForecast));
}

/** GET /forecasts/{id} */
export function get(req) {
  const run = req.db.forecasts.find((r) => r.id === req.params.id);
  if (!run) fail(404, "not_found", "That forecast run no longer exists.");
  return ok(toApiForecast(run));
}

/** Checks the sku, start and end of a lineage request (query parameters). */
function readLineageQuery(req) {
  const { sku, start, end } = req.query;
  invalid({
    sku: !req.db.inventory.some((item) => item.sku === sku) && "Choose an existing product SKU.",
    start: !(ISO_DATE.test(start ?? "") && !Number.isNaN(Date.parse(start))) && "Use a date like 2025-03-19.",
    end: !(ISO_DATE.test(end ?? "") && !Number.isNaN(Date.parse(end))) && "Use a date like 2025-06-18.",
  });
  if (start > end) invalid({ start: "The start date must be on or before the end date." });
  return { sku, startDate: start, endDate: end };
}

/**
 * GET /forecasts/lineage?sku&start&end — which uploads a forecast with these settings would use, before
 * running it (the Forecasting page's "Data used"). Same shape as a saved run's lineage.
 */
export function lineage(req) {
  const options = readLineageQuery(req);
  const days = Math.round((Date.parse(options.endDate) - Date.parse(options.startDate)) / 86400000) + 1;
  return ok({ ...options, days, ...forecastLineage(req.db, options) });
}

/** POST /forecasts { sku, model, horizon, startDate, endDate, windowSize?, order? } — runs and saves */
export function run(req) {
  requireAction(req, "Run forecasts");
  const options = readRequest(req);
  const history = filterSales(req.db.sales, { sku: options.sku, startDate: options.startDate, endDate: options.endDate });
  let result;
  try {
    result = runForecast(history, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forecast execution failed.";
    logError(req, "Forecasting", "Execution failure", "Error", `${options.sku} · ${message}`);
    logEvent(req, `${options.model} forecast failed`, "Forecasting", "Failed", `${options.sku} · ${message}`);
    fail(422, "forecast_failed", message);
  }
  const saved = {
    id: nextId("FC"),
    ...result,
    startDate: options.startDate,
    endDate: options.endDate,
    // The uploads this run's history came from, kept with the run (a later upload may replace records)
    lineage: forecastLineage(req.db, options),
    generatedBy: { id: req.user.id, name: req.user.name },
  };
  req.db.forecasts.unshift(saved);
  // The forecast sets that product's 30-day demand, suggestion and status
  req.db.inventory = applyForecastToInventory(req.db.inventory, saved);
  // No dataset is changed here: an upload's forecasting status comes from the runs' lineage (GET /datasets)
  const uploads = saved.lineage.sources.filter((source) => source.datasetId).map((source) => source.datasetId);
  logEvent(
    req,
    `${saved.model} forecast executed`,
    "Forecasting",
    "Completed",
    `${saved.sku} · ${saved.horizon}-day horizon · data from ${uploads.length ? uploads.join(", ") : "no uploads"}`,
  );
  return created(toApiForecast(saved));
}

/** POST /forecasts/compare { sku, horizon, startDate, endDate, windowSize?, order? } — all three models, nothing saved */
export function compare(req) {
  requireAction(req, "Run forecasts");
  const options = readRequest(req, { needsModel: false });
  const history = filterSales(req.db.sales, { sku: options.sku, startDate: options.startDate, endDate: options.endDate });
  const results = FORECAST_MODELS.map((model) => {
    try {
      const result = runForecast(history, { ...options, model });
      return {
        model,
        status: "Completed",
        metrics: { mae: result.mae, rmse: result.rmse, mape: result.mape },
        totalPredicted: result.points.reduce((sum, point) => sum + point.forecast, 0),
        error: null,
      };
    } catch (error) {
      return { model, status: "Failed", metrics: null, totalPredicted: null, error: error instanceof Error ? error.message : "Failed" };
    }
  });
  return ok({ sku: options.sku, horizon: options.horizon, startDate: options.startDate, endDate: options.endDate, results });
}

/**
 * POST /forecasts/recommendation { skus, filters: { start, end, category: [], sku: [], region: [] } }
 * — best model for a group of products, compared on the sales that match the filters. Nothing is saved.
 */
export function recommendation(req) {
  requireView(req, "Run forecasts");
  const { skus, filters: query = {} } = req.body ?? {};
  invalid({
    skus:
      !(Array.isArray(skus) && skus.length <= 500 && skus.every((sku) => typeof sku === "string")) &&
      "Send skus as a list of up to 500 product SKUs.",
  });
  const filters = filtersFromQuery(query, req.db.sales);
  const known = skus.filter((sku) => req.db.inventory.some((item) => item.sku === sku));
  const sales = filterSales(req.db.sales, filters);
  const result = compareModelsForProducts(sales, known, filters.startDate, filters.endDate);
  return ok({
    skus: known,
    startDate: filters.startDate,
    endDate: filters.endDate,
    days: result.days,
    testDays: result.testDays,
    metric: result.metric,
    recommended: result.recommended,
    reason: result.reason,
    margin: result.margin,
    close: result.close,
    ranked: result.ranked.map((m) => m.model),
    models: result.models,
  });
}
