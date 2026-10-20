// Role-based dashboard: the same page shows different KPI cards and panels per role.
// The KPI cards come from GET /dashboard/summary (dashboardService); the charts and tables below use the
// sales, inventory and forecast data the store loaded. The Inventory Supervisor also filters by stock status.
import { useState } from "react";
import { filterForecasts, filterInventory, filterSales, forecastInView } from "../../lib/domain";
import { dashboardKpis, formatKpi } from "../../lib/dashboard";
import { formatDateTime, plural } from "../../lib/format";
import { ROLE, roleName } from "../../lib/roles";
import { dashboardService } from "../../services/dashboardService";
import { useStore } from "../../store/AppStore";
import { useRequest } from "../../store/useRequest";
import { Button, EmptyState, Icon, Kpi, MultiSelect } from "../../components/ui";
import { StoreManagerDashboard } from "./StoreManagerDashboard";
import { AnalystDashboard } from "./AnalystDashboard";
import { InventoryDashboard } from "./InventoryDashboard";
import { AdminDashboard } from "./AdminDashboard";

const STOCK_STATUSES = ["Safe", "Warning", "Critical"];
const TONE_CLASS = { critical: "critical-kpi", warning: "warning-kpi" };

export default function DashboardPage() {
  const { currentUser: user, appliedFilters, baseFilters, sales, inventory, forecastHistory, datasets, errors, users } = useStore();
  const supervisor = user?.roleId === ROLE.INVENTORY_SUPERVISOR;
  // Inventory Supervisor: stock statuses picked in the dashboard's own filter ([] = all)
  const [statuses, setStatuses] = useState([]);
  const filters = supervisor ? { ...appliedFilters, status: statuses } : appliedFilters;
  // KPI cards from the server; asked again when the filters or the loaded data change
  const summary = useRequest(() => dashboardService.getSummary(filters), [JSON.stringify(filters), sales, inventory, forecastHistory, datasets, errors, users]);
  if (!user) return null;

  const filteredSales = filterSales(sales, filters);
  const records = filterInventory(inventory, filters);
  const filtered = JSON.stringify(appliedFilters) !== JSON.stringify(baseFilters) || statuses.length > 0;
  // The newest saved forecast (of the picked models) for a product in the filtered sales (used by the chart)
  const viewForecast = forecastInView(filterForecasts(forecastHistory, filters), filteredSales);
  // Until the first answer arrives, the cards show their names with "…"
  const kpis = summary.data?.kpis ?? dashboardKpis(user.roleId, filters, {});

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          {user.roleId !== ROLE.STORE_MANAGER && <span className="eyebrow">{roleName(user.roleId).toUpperCase()}</span>}
          <h1>{roleName(user.roleId)} Dashboard</h1>
        </div>
        <div className="heading-actions">
          <span className="last-refresh">{summary.data ? `Updated ${formatDateTime(summary.data.generatedAt)}` : "Loading…"}</span>
          {supervisor && (
            <MultiSelect
              className="status-filter"
              ariaLabel="Inventory status"
              allLabel="All statuses"
              options={STOCK_STATUSES}
              value={statuses}
              summary={(n) => `${n} statuses`}
              onChange={setStatuses}
            />
          )}
        </div>
      </div>
      {filtered && (
        <div className="filter-banner">
          <Icon name="check" />
          <span>
            Filtered: {plural(filteredSales.length, "sales record")} · {plural(records.length, "product")}
          </span>
        </div>
      )}
      {!filteredSales.length && [ROLE.STORE_MANAGER, ROLE.DATA_ANALYST].includes(user.roleId) && (
        <EmptyState
          title="No matching dashboard data"
          detail="Clear or adjust the active filters to restore results."
        />
      )}
      {summary.error && (
        <div className="filter-banner load-banner" role="alert">
          <Icon name="warning" />
          <span>The summary couldn't be loaded: {summary.error.message}</span>
          <Button variant="ghost" icon="refresh" onClick={summary.reload}>
            Try again
          </Button>
        </div>
      )}
      <div className={`kpi-grid kpi-count-${kpis.length} ${summary.loading && !summary.data ? "is-loading" : ""}`} aria-busy={summary.loading}>
        {kpis.map((k) => (
          <Kpi
            key={k.id}
            label={k.label}
            value={summary.data ? formatKpi(k) : "…"}
            change={summary.data ? k.detail : "Loading…"}
            icon={k.icon}
            tone={TONE_CLASS[k.tone] ?? ""}
          />
        ))}
      </div>
      {user.roleId === ROLE.STORE_MANAGER && (
        <StoreManagerDashboard filters={filters} filteredSales={filteredSales} forecast={viewForecast} />
      )}
      {user.roleId === ROLE.DATA_ANALYST && <AnalystDashboard filters={filters} filteredSales={filteredSales} />}
      {user.roleId === ROLE.INVENTORY_SUPERVISOR && <InventoryDashboard filters={filters} records={records} />}
      {user.roleId === ROLE.ADMIN && <AdminDashboard />}
    </div>
  );
}
