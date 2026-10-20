// Dataset lineage: which uploads a forecast used, and what each upload's records were used for.
//
// Forecasts run on the shared, cleaned sales history (not on one chosen upload). Every sales record keeps
// the ID of the upload it came from (`datasetId`), so:
//   • a forecast records its lineage when it is saved: the uploads whose records it used, and the uploads
//     still waiting for cleaning that have sales for the same product in its date range (not used — those
//     days counted as no sales);
//   • an upload's forecasting status is worked out from the saved forecasts' lineage, product by product.
//     Running a forecast never changes the status of an upload it didn't use.
// The demo backend calls these functions; FastAPI implements the same rules (docs/API_CONTRACT.md, section 8).
import { filterSales } from "./domain";

/** Records grouped by the upload they came from: [{ datasetId, fileName, records, firstDate, lastDate }], oldest data first. */
function bySource(rows, datasets) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.datasetId ?? null;
    const group = groups.get(key) ?? { datasetId: key, records: 0, firstDate: row.date, lastDate: row.date };
    group.records += 1;
    if (row.date < group.firstDate) group.firstDate = row.date;
    if (row.date > group.lastDate) group.lastDate = row.date;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      datasetId: group.datasetId,
      fileName: datasets.find((d) => d.id === group.datasetId)?.fileName ?? null,
      records: group.records,
      firstDate: group.firstDate,
      lastDate: group.lastDate,
    }))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate) || String(a.datasetId).localeCompare(String(b.datasetId)));
}

/**
 * The lineage of a forecast for one product over startDate..endDate.
 *   records  sales records used (the product's records in the date range)
 *   sources  the uploads those records came from (datasetId null = history loaded without an upload)
 *   waiting  uploads waiting for cleaning that have this product's sales in the range: not used, so the
 *            forecast counted those days as no sales
 * db: { sales, datasets } — datasets waiting for cleaning carry their validated records in pendingRecords.
 */
export function forecastLineage({ sales, datasets }, { sku, startDate, endDate }) {
  const used = filterSales(sales, { sku, startDate, endDate });
  const waiting = datasets
    .filter((d) => d.cleaning === "Pending")
    .flatMap((d) =>
      (d.pendingRecords ?? []).filter((r) => r.sku === sku && r.date >= startDate && r.date <= endDate).map((r) => ({ ...r, datasetId: d.id })),
    );
  return { records: used.length, sources: bySource(used, datasets), waiting: bySource(waiting, datasets) };
}

/** First and last date and number of products of an upload's valid records, or null when it has none. */
export function datasetCoverage(records) {
  if (!records.length) return null;
  let firstDate = records[0].date;
  let lastDate = records[0].date;
  for (const r of records) {
    if (r.date < firstDate) firstDate = r.date;
    if (r.date > lastDate) lastDate = r.date;
  }
  return { firstDate, lastDate, products: new Set(records.map((r) => r.sku)).size };
}

/**
 * For every upload: its records in the sales history now, and the saved forecasts that used them.
 * forecasts: newest first, each with { id, sku, generatedAt, lineage: { sources } }.
 * Returns Map(datasetId → { recordsInHistory, skus, forecastedSkus, forecastIds, forecastedAt }), where
 *   skus            products that count for forecasting: still in the history, or already forecast
 *   forecastedSkus  products forecast with this upload's records
 *   forecastIds     saved runs that used its records, newest first
 *   forecastedAt    when the first of those runs was saved
 */
export function datasetLineage(datasets, sales, forecasts) {
  const usage = new Map(
    datasets.map((d) => [d.id, { recordsInHistory: 0, inHistory: new Set(), forecasted: new Set(), forecastIds: [], forecastedAt: null }]),
  );
  for (const row of sales) {
    const entry = usage.get(row.datasetId);
    if (!entry) continue;
    entry.recordsInHistory += 1;
    entry.inHistory.add(row.sku);
  }
  for (const run of forecasts)
    for (const source of run.lineage?.sources ?? []) {
      const entry = usage.get(source.datasetId);
      if (!entry || !source.records) continue;
      entry.forecasted.add(run.sku);
      entry.forecastIds.push(run.id);
      if (!entry.forecastedAt || run.generatedAt < entry.forecastedAt) entry.forecastedAt = run.generatedAt;
    }
  return new Map(
    [...usage].map(([id, entry]) => [
      id,
      {
        recordsInHistory: entry.recordsInHistory,
        skus: [...new Set([...entry.inHistory, ...entry.forecasted])].sort(),
        forecastedSkus: [...entry.forecasted].sort(),
        forecastIds: entry.forecastIds,
        forecastedAt: entry.forecastedAt,
      },
    ]),
  );
}

/**
 * An upload's forecasting status, from its lineage:
 *   "Not started"  the upload failed validation
 *   "Pending"      not cleaned yet, or no saved forecast has used its records yet
 *   "Partial"      forecasts used its records for some of its products, not all
 *   "Completed"    forecasts used its records for every product it has in the history
 *   "Not needed"   cleaned, but none of its records are in the history (all were duplicates that were
 *                  skipped, or a later upload replaced them before any forecast used them)
 */
export function forecastingStatus(dataset, lineage) {
  if (dataset.validation === "Failed") return "Not started";
  if (dataset.cleaning !== "Completed") return "Pending";
  if (!lineage?.skus.length) return "Not needed";
  if (!lineage.forecastedSkus.length) return "Pending";
  return lineage.forecastedSkus.length >= lineage.skus.length ? "Completed" : "Partial";
}
