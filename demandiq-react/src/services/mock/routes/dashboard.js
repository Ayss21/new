// /dashboard — the KPI cards for the signed-in user's role (demo backend).
import { dashboardKpis } from "../../../lib/dashboard";
import { now, ok } from "../http";
import { apiDatasets, filtersFromQuery } from "../shapes";

/** GET /dashboard/summary?start&end&category&sku&region&model&status (lists repeat: category=A&category=B) */
export function summary(req) {
  const filters = filtersFromQuery(req.query, req.db.sales);
  const kpis = dashboardKpis(req.user.roleId, filters, {
    sales: req.db.sales,
    inventory: req.db.inventory,
    forecasts: req.db.forecasts,
    datasets: apiDatasets(req.db),
    users: req.db.users,
    errors: req.db.errors,
  });
  return ok({ roleId: req.user.roleId, generatedAt: now(), startDate: filters.startDate, endDate: filters.endDate, kpis });
}
