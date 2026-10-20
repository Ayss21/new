// The KPI cards at the top of each role's dashboard.
// The backend calculates them for GET /dashboard/summary (the demo backend calls dashboardKpis below);
// the dashboard only formats them with formatKpi. Each KPI:
//   { id, label, value, format, detail, icon, tone }
//   format: "currency_millions" | "number" | "units" | "percent" | "growth"   (value is a raw number, or null)
//   tone:   "" | "warning" | "critical"
import { addDays, calculateMetrics, dateBounds, filterForecasts, filterInventory, filterSales, normalizeFilters } from "./domain";
import { daysInRange, formatRange } from "./format";
import { ROLE } from "./roles";

const kpi = (id, label, value, format, detail, icon, tone = "") => ({ id, label, value, format, detail, icon, tone });

/**
 * Sales growth (%): net revenue in the filtered date range compared with the period of the same length just
 * before it, for the same categories, products and regions. When the sales history starts (or ends) inside
 * one of the two periods, the days it covers are compared by average daily revenue, so missing days don't
 * count as zero sales. value is null when the earlier period has no sales.
 * → { value, previousStart, previousEnd, partial } (previousStart is where the compared days begin)
 */
export function salesGrowth(sales, filters) {
  const safe = normalizeFilters(filters);
  const days = daysInRange(safe.startDate, safe.endDate);
  const previousEnd = addDays(safe.startDate, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  const { start: first, end: last } = dateBounds(sales);
  /** [from, to, days] of a period that the sales history covers. */
  const covered = (start, end) => {
    const from = start > first ? start : first;
    const to = end < last ? end : last;
    return [from, to, from > to ? 0 : daysInRange(from, to)];
  };
  const [, , currentDays] = covered(safe.startDate, safe.endDate);
  const [comparedStart, , previousDays] = covered(previousStart, previousEnd);
  const revenue = (rows) => rows.reduce((sum, row) => sum + row.netRevenue, 0);
  const current = revenue(filterSales(sales, safe));
  const previous = revenue(filterSales(sales, { ...safe, startDate: previousStart, endDate: previousEnd }));
  const value = currentDays && previousDays && previous > 0 ? ((current / currentDays / (previous / previousDays)) - 1) * 100 : null;
  return { value, previousStart: previousDays ? comparedStart : previousStart, previousEnd, partial: currentDays < days || previousDays < days };
}

/**
 * data: { sales, inventory, forecasts, datasets, users, errors }
 *   forecasts newest first ({ sku, model, horizon, points: [{ date, forecast }], mape … });
 *   datasets with pendingCount (validated records waiting to be cleaned).
 */
export function dashboardKpis(roleId, filters, data) {
  const { sales = [], inventory = [], forecasts = [], datasets = [], users = [], errors = [] } = data;
  const filteredSales = filterSales(sales, filters);
  const records = filterInventory(inventory, filters);
  // Saved runs of the picked models for the products in the filters, newest first
  const runs = filterForecasts(forecasts, filters, inventory);
  const metrics = calculateMetrics(filteredSales, records, runs[0] ?? null);

  if (roleId === ROLE.STORE_MANAGER) {
    const growth = salesGrowth(sales, filters);
    return [
      kpi("total_revenue", "Total sales revenue", metrics.revenue, "currency_millions", "Net of recorded discounts", "trend"),
      kpi("units_sold", "Total units sold", metrics.units, "number", `${filteredSales.length.toLocaleString()} sales records`, "box"),
      kpi("active_skus", "Active products / SKUs", metrics.activeSkus, "number", `${records.length.toLocaleString()} inventory records`, "grid"),
      kpi(
        "sales_growth",
        "Sales growth",
        growth.value,
        "growth",
        growth.value === null
          ? "No sales in the previous period"
          : `vs ${formatRange(growth.previousStart, growth.previousEnd)}${growth.partial ? " · daily average" : ""}`,
        "trend",
      ),
    ];
  }

  if (roleId === ROLE.DATA_ANALYST) {
    const waiting = datasets.filter((d) => d.cleaning === "Pending" && d.pendingCount > 0).length;
    const latest = runs[0] ?? null;
    const accuracy = latest?.mape == null ? null : Math.max(0, 100 - latest.mape);
    return [
      kpi(
        "uploaded_datasets",
        "Uploaded datasets",
        datasets.length,
        "number",
        waiting ? `${waiting} waiting for cleaning` : `${sales.length.toLocaleString()} total records`,
        "upload",
      ),
      kpi("valid_records", "Valid records", filteredSales.length, "number", "After active filters", "check"),
      kpi("forecast_runs", "Forecast runs", runs.length, "number", "Saved executions", "trend"),
      kpi(
        "forecast_accuracy",
        "Forecast accuracy",
        accuracy,
        "percent",
        accuracy === null ? "Run a model to evaluate" : "100 − evaluation MAPE",
        "check",
      ),
    ];
  }

  if (roleId === ROLE.INVENTORY_SUPERVISOR) {
    const count = (status) => records.filter((row) => row.status === status).length;
    return [
      kpi("active_skus", "Active SKUs", records.length, "number", "Matching products", "box"),
      kpi("safe_items", "Safe stock items", count("Safe"), "number", "Above reorder level", "check"),
      kpi("low_items", "Low stock items", count("Warning"), "number", "Below reorder level", "warning", "warning"),
      kpi("critical_items", "Critical stock alerts", count("Critical"), "number", "Immediate review", "warning", "critical"),
      kpi(
        "suggested_reorder",
        "Suggested reorder",
        records.reduce((sum, row) => sum + row.suggested, 0),
        "units",
        `Across ${records.filter((row) => row.suggested > 0).length.toLocaleString()} products`,
        "trend",
      ),
    ];
  }

  return [
    kpi("active_users", "Active users", users.filter((u) => u.status === "Active").length, "number", "Across four roles", "shield"),
    kpi("dataset_uploads", "Dataset uploads", datasets.length, "number", "Recorded uploads", "upload"),
    kpi("forecast_runs", "Forecast runs", forecasts.length, "number", "Saved executions", "trend"),
    kpi("unresolved_errors", "Unresolved errors", errors.filter((e) => e.status !== "Resolved").length, "number", "Requires attention", "warning", "critical"),
  ];
}

/** The text shown on a KPI card. */
export function formatKpi({ value, format }) {
  if (value === null || value === undefined) return "N/A";
  if (format === "currency_millions") return `$${(value / 1000000).toFixed(2)}M`;
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "growth") {
    const rounded = Math.round(value * 10) / 10;
    return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}%`;
  }
  if (format === "units") return `${value.toLocaleString()} units`;
  return value.toLocaleString();
}
