// How records leave the demo backend: the JSON shapes in docs/API_CONTRACT.md.
import { LIST_FILTERS, dateBounds, filterList } from "../../lib/domain";
import { datasetLineage, forecastingStatus } from "../../lib/lineage";
import { fail } from "./http";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Global filters from query parameters: start, end, and the lists category, sku, region, model, status —
 * a parameter repeats for several values (?category=Polymers&category=Chemicals). A missing filter means
 * "all"; missing dates mean the whole sales history.
 */
export function filtersFromQuery(query = {}, sales = []) {
  for (const key of ["start", "end"])
    if (query[key] && (!ISO_DATE.test(query[key]) || Number.isNaN(Date.parse(query[key]))))
      fail(422, "validation_error", `${key}: use a date like 2025-06-18.`, { fields: { [key]: "Use a date like 2025-06-18." } });
  const bounds = dateBounds(sales);
  const filters = {
    datePreset: "Custom Range",
    startDate: query.start || bounds.start,
    endDate: query.end || bounds.end,
    ...Object.fromEntries(Object.keys(LIST_FILTERS).map((key) => [key, filterList(query[key])])),
  };
  if (filters.startDate > filters.endDate) fail(422, "validation_error", "start must be on or before end.", { fields: { start: "Must be on or before end." } });
  return filters;
}

/**
 * A dataset as the API returns it: without its pending records (the server keeps those; pendingCount says
 * how many there are), with its lineage and its forecasting status worked out from the saved forecasts.
 * lineage: the entry for this dataset from datasetLineage() — use apiDatasets() for a whole list.
 */
export function toApiDataset(d, lineage) {
  const used = lineage ?? { recordsInHistory: 0, skus: [], forecastedSkus: [], forecastIds: [], forecastedAt: null };
  return {
    id: d.id,
    fileName: d.fileName,
    uploadedAt: d.uploadedAt,
    uploaderId: d.uploaderId,
    uploader: d.uploader,
    recordCount: d.recordCount,
    validation: d.validation,
    checks: d.checks ?? null,
    coverage: d.coverage ?? null,
    cleaning: d.cleaning,
    cleanedAt: d.cleanedAt ?? null,
    cleaningSummary: d.cleaningSummary ?? null,
    pendingCount: (d.pendingRecords ?? []).length,
    newProducts: d.newProducts ?? [],
    forecasting: forecastingStatus(d, used),
    forecastedAt: used.forecastedAt,
    lineage: {
      recordsInHistory: used.recordsInHistory,
      skus: used.skus,
      forecastedSkus: used.forecastedSkus,
      forecastIds: used.forecastIds,
    },
    error: d.error ?? null,
  };
}

/** Every dataset in the API shape (the lineage is worked out once for all of them). */
export function apiDatasets(db) {
  const lineage = datasetLineage(db.datasets, db.sales, db.forecasts);
  return db.datasets.map((d) => toApiDataset(d, lineage.get(d.id)));
}

/** One dataset in the API shape. */
export function apiDataset(db, id) {
  return apiDatasets(db).find((d) => d.id === id);
}

/** A forecast run as the API returns it: metrics grouped, points as { date, predicted }. */
export function toApiForecast(run) {
  return {
    id: run.id,
    sku: run.sku,
    model: run.model,
    horizon: run.horizon,
    status: "Completed",
    startDate: run.startDate ?? null,
    endDate: run.endDate ?? null,
    configuration: run.configuration,
    metrics: { mae: run.mae ?? null, rmse: run.rmse ?? null, mape: run.mape ?? null },
    evaluation: { holdoutDays: run.holdoutDays ?? null },
    points: run.points.map((point) => ({ date: point.date, predicted: point.forecast })),
    lineage: run.lineage ?? null,
    generatedAt: run.generatedAt,
    generatedBy: run.generatedBy ?? null,
  };
}

/** A sign-in session as the API returns it (never with the token). */
export function publicSession(session) {
  return { id: session.id, userId: session.userId, loginAt: session.loginAt, logoutAt: session.logoutAt };
}
