// The KPI cards at the top of each role's dashboard.
import { api } from "./api";
import { filterQuery } from "./query";

export const dashboardService = {
  /**
   * GET /dashboard/summary?start&end&category&sku&region&model&status (lists repeat: category=A&category=B)
   * → { roleId, generatedAt, startDate, endDate, kpis: [{ id, label, value, format, detail, icon, tone }] }
   * The KPIs are for the signed-in user's role.
   */
  getSummary: (filters) => api.get("/dashboard/summary", { query: filterQuery(filters) }),
};
