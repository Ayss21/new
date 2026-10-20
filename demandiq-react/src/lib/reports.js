// What goes into each report. The backend builds report files (POST /reports); the demo backend
// uses these functions, so the rows match what the app showed before it used the API.
import { filterForecasts, filterInventory, filterSales, normalizeFilters, reportRows } from "./domain";
import { formatDateTime } from "./format";
import { roleName } from "./roles";

/**
 * Rows for a report, using the global filters that were applied when it was requested.
 * data: { sales, inventory, forecasts, activity, errors, reorders, datasets }
 */
export function buildReportRows(data, filters, reportName) {
  const { sales = [], inventory = [], forecasts = [], activity = [], errors = [], reorders = [], datasets = [] } = data;
  const scopedInventory = filterInventory(inventory, filters);
  const filteredSales = filterSales(sales, filters);
  // Forecast reports: the runs of the picked models, for the products in the filters (newest first)
  const runs = filterForecasts(forecasts, filters, inventory);
  if (reportName.includes("Reorder") && reorders.length)
    return reorders.map((r) => ({
      Order: r.id,
      SKU: r.sku,
      Quantity: r.quantity,
      Supplier: r.supplier,
      Ordered: formatDateTime(r.orderedAt),
      "Ordered By": r.userName,
      Delivered: r.deliveredAt ? formatDateTime(r.deliveredAt) : "",
      Status: r.status,
    }));
  if (reportName.includes("Inventory") || reportName.includes("Reorder"))
    return scopedInventory.map((item) => ({
      SKU: item.sku,
      Product: item.name,
      Category: item.category,
      Region: item.region,
      Warehouse: item.location,
      "Current Stock": item.stock,
      "30-day Demand": item.demand,
      "Reorder Level": item.reorder,
      "Safety Stock": item.safety,
      "Suggested Reorder": item.suggested,
      "Days Left": item.days,
      Status: item.status === "Warning" ? "Low" : item.status,
    }));
  if (reportName.includes("Forecast Accuracy"))
    return runs.map((run) => ({
      Model: run.model,
      SKU: run.sku,
      Horizon: run.horizon,
      MAE: run.mae?.toFixed(2) ?? "N/A",
      RMSE: run.rmse?.toFixed(2) ?? "N/A",
      MAPE: run.mape?.toFixed(2) ?? "N/A",
      Executed: formatDateTime(run.generatedAt),
    }));
  if (reportName.includes("Demand Forecast")) {
    const run = runs[0];
    return (run?.points || []).map((point) => ({ Date: point.date, SKU: run.sku, Model: run.model, "Forecast Units": point.forecast }));
  }
  if (reportName.includes("User Activity"))
    return activity.map((row) => ({
      Timestamp: formatDateTime(row.at),
      "User ID": row.userId ?? "—",
      User: row.userName,
      Role: row.roleId ? roleName(row.roleId) : "—",
      Action: row.action,
      Module: row.module,
      Details: row.details,
      Status: row.status,
    }));
  if (reportName.includes("System Error"))
    return errors.map((row) => ({
      "Error ID": row.id,
      Timestamp: formatDateTime(row.at),
      Module: row.module,
      Type: row.type,
      Severity: row.severity,
      Message: row.message,
      Status: row.status,
    }));
  if (reportName.includes("Data Quality"))
    return datasets.map((d) => ({
      Dataset: d.fileName,
      Uploaded: formatDateTime(d.uploadedAt),
      Uploader: d.uploader,
      Records: d.recordCount,
      Validation: d.validation,
      Missing: d.checks?.missing ?? "",
      Duplicates: d.checks?.duplicates ?? "",
      Invalid: d.checks ? d.checks.invalidDates + d.checks.invalidNumeric : "",
      Cleaning: d.cleaning,
      "Outliers Capped": d.cleaningSummary?.outliersCapped ?? "",
      Forecasting: d.forecasting,
      // From the forecasts' lineage: products forecast with this upload's records
      "Products Forecast": d.lineage?.skus.length ? `${d.lineage.forecastedSkus.length} of ${d.lineage.skus.length}` : "",
    }));
  if (reportName.includes("Sales by Region"))
    return Array.from(new Set(filteredSales.map((row) => row.region))).map((region) => {
      const regionRows = filteredSales.filter((row) => row.region === region);
      return {
        Region: region,
        Units: regionRows.reduce((sum, row) => sum + row.units, 0),
        "Net Revenue": Number(regionRows.reduce((sum, row) => sum + row.netRevenue, 0).toFixed(2)),
      };
    });
  if (reportName.includes("Product Performance"))
    return inventory
      .map((product) => {
        const productRows = filteredSales.filter((row) => row.sku === product.sku);
        return {
          SKU: product.sku,
          Product: product.name,
          Category: product.category,
          Units: productRows.reduce((sum, row) => sum + row.units, 0),
          "Net Revenue": Number(productRows.reduce((sum, row) => sum + row.netRevenue, 0).toFixed(2)),
        };
      })
      .filter((row) => row.Units > 0)
      .sort((a, b) => b["Net Revenue"] - a["Net Revenue"]);
  return reportRows(filteredSales, scopedInventory);
}

/** The lines printed under a PDF report's title. */
export function reportMetadata(filters, user) {
  const safe = normalizeFilters(filters);
  const list = (key) => (safe[key].length ? safe[key].join(", ") : "All");
  return [
    `Date range: ${safe.startDate} to ${safe.endDate}`,
    `Category: ${list("category")} · SKU: ${list("sku")} · Region: ${list("region")} · Model: ${list("model")}`,
    `Generated by ${user?.name ?? ""} (${user ? roleName(user.roleId) : ""})`,
  ];
}
