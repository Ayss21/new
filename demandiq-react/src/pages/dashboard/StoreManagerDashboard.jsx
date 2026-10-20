import { useState } from "react";
import { aggregateCategories, dailySeries, describeConfiguration, filterForecasts, filterInventory, normalizeFilters } from "../../lib/domain";
import { daysInRange, formatDay, formatRange, plural } from "../../lib/format";
import { useStore } from "../../store/AppStore";
import { Card, CardHeader, ColumnChart, DataLineChart, EmptyState, Select, Status } from "../../components/ui";

const money = (n) => (n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : `$${(n / 1000).toFixed(1)}K`);
const share = (part, total) => (total ? `${((part / total) * 100).toFixed(1)}%` : "0%");
const HORIZONS = [7, 14, 30, 60, 90];
const TOP_PRODUCTS = 6;

/** Bottom strip of label / value cells, shared by both cards so their footers line up. [label, value, width weight] */
function MetricStrip({ items }) {
  return (
    <div
      className="forecast-readonly-metrics metric-strip"
      style={{ gridTemplateColumns: items.map((item) => `minmax(0, ${item[2] ?? 1}fr)`).join(" ") }}
    >
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong title={String(value)}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Tabs at the top of a chart panel. */
function ChartTabs({ tabs, value, onChange }) {
  return (
    <div className="store-chart-switcher" role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? "active" : ""} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Historical Sales vs Forecast: daily units of the forecast's product over the date range, then the forecast. */
function HistoryVsForecast({ filters, filteredSales, forecast }) {
  const { inventory } = useStore();
  const safe = normalizeFilters(filters);
  const chartSales = forecast ? filteredSales.filter((row) => row.sku === forecast.sku) : filteredSales;
  const history = chartSales.length ? dailySeries(chartSales, safe.startDate, safe.endDate) : [];
  // The forecast is drawn only when it continues the range (starts within a week of its end)
  const forecastStart = forecast?.points[0]?.date;
  const continues = Boolean(forecastStart && history.length) && daysInRange(history.at(-1).date, forecastStart) <= 8;
  const forecastPoints = continues ? forecast.points.map((point) => ({ date: point.date, value: point.forecast })) : [];
  const product = forecast ? inventory.find((item) => item.sku === forecast.sku) : null;
  const picked = safe.sku.length === 1 ? inventory.find((item) => item.sku === safe.sku[0]) : null;
  const scopeLabel = forecast
    ? `${forecast.sku}${product ? ` · ${product.name}` : ""}`
    : picked
      ? `${picked.sku} · ${picked.name}`
      : safe.category.length
        ? `${safe.category.join(", ")} products`
        : "All products";

  return (
    <>
      <CardHeader
        title="Historical Sales vs Forecast"
        subtitle={
          <>
            {scopeLabel} · {formatRange(safe.startDate, safe.endDate)}
            <span className="subtitle-extra">{forecast ? " · Published by Data Analyst" : " · No published forecast"}</span>
          </>
        }
        action={
          <div className="card-head-tools">
            <div className="legend chart-legend" aria-hidden="true">
              <span>
                <i className="legend-actual" />
                Actual
              </span>
              {forecast && (
                <span className={continues ? "" : "legend-off"} title={continues ? undefined : `Starts ${formatDay(forecastStart)}, after this range`}>
                  <i className="legend-forecast" />
                  Forecast
                </span>
              )}
            </div>
            <Status value={forecast ? "Completed" : "Pending"} />
          </div>
        }
      />
      {history.length ? (
        <>
          <DataLineChart historical={history} forecast={forecastPoints} />
          {forecast && !continues && <p className="chart-note">The forecast starts {formatDay(forecastStart)}, after this date range.</p>}
        </>
      ) : (
        <EmptyState inline icon="trend" title="No sales in the selected range" detail="Widen the date range or clear filters." />
      )}
      <MetricStrip
        items={[
          ["Horizon", forecast ? `${forecast.horizon} days` : "N/A"],
          ["Model", forecast ? (forecast.model === "ARIMA" ? `ARIMA ${describeConfiguration(forecast).replace("Order ", "")}` : forecast.model) : "N/A", 1.9],
          ["MAE", forecast?.mae == null ? "N/A" : forecast.mae.toFixed(2)],
          ["RMSE", forecast?.rmse == null ? "N/A" : forecast.rmse.toFixed(2)],
          ["MAPE", forecast?.mape == null ? "N/A" : `${forecast.mape.toFixed(2)}%`],
        ]}
      />
    </>
  );
}

/**
 * All Products Forecast: each product's forecast demand over the next N days, from its newest saved run (of
 * the picked models) that reaches that far. Horizons no saved run reaches are switched off.
 */
function AllProductsForecast({ filters }) {
  const { inventory, forecastHistory } = useStore();
  const [horizon, setHorizon] = useState(30);
  const [order, setOrder] = useState("desc");
  const products = filterInventory(inventory, { ...filters, status: [] });
  const runs = filterForecasts(forecastHistory, filters);
  const runFor = (sku, days) => runs.find((run) => run.sku === sku && run.horizon >= days && run.points.length >= days) ?? null;
  const supported = (days) => products.some((product) => runFor(product.sku, days));
  // Keep the picked horizon when a forecast reaches it, otherwise the nearest one that does
  const active = supported(horizon) ? horizon : ([...HORIZONS].sort((a, b) => Math.abs(a - horizon) - Math.abs(b - horizon)).find(supported) ?? null);
  const bars = active
    ? products
        .map((product) => {
          const run = runFor(product.sku, active);
          if (!run) return null;
          const value = run.points.slice(0, active).reduce((sum, point) => sum + point.forecast, 0);
          return { product, run, value };
        })
        .filter(Boolean)
        .sort((a, b) => (order === "desc" ? b.value - a.value : a.value - b.value) || a.product.sku.localeCompare(b.product.sku))
    : [];
  const missing = active ? products.filter((product) => !runFor(product.sku, active)).map((product) => product.sku) : [];
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  // The product with the most forecast demand, whichever way the bars are sorted
  const top = order === "desc" ? bars[0] : bars.at(-1);
  const topIndex = order === "desc" ? 0 : bars.length - 1;

  return (
    <>
      <CardHeader
        title="All Products Forecast"
        subtitle={active ? `Forecast units · next ${active} days` : "No saved forecasts for these filters"}
        action={
          <div className="card-head-tools forecast-tools">
            <div className="segmented horizon-picker" role="radiogroup" aria-label="Horizon">
              {HORIZONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  role="radio"
                  aria-checked={days === active}
                  className={days === active ? "active" : ""}
                  disabled={!supported(days)}
                  title={supported(days) ? `${days}-day forecast` : `No saved forecast covers ${days} days`}
                  onClick={() => setHorizon(days)}
                >
                  {days}d
                </button>
              ))}
            </div>
            <Select value={order} onChange={setOrder} ariaLabel="Sort">
              <option value="desc">Highest to lowest</option>
              <option value="asc">Lowest to highest</option>
            </Select>
          </div>
        }
      />
      {bars.length ? (
        <ColumnChart
          minColumnWidth={64}
          unitLabel="Units"
          ariaLabel={`Forecast units over the next ${active} days by product`}
          highlight={topIndex}
          data={bars.map(({ product, run, value }) => ({
            label: product.sku,
            value,
            tip: `${product.name} · ${run.model} · ${run.id}`,
          }))}
        />
      ) : (
        <EmptyState inline icon="trend" title="No forecasts to show" detail="Clear filters or run forecasts for these products." />
      )}
      {missing.length > 0 && (
        <p className="chart-note">
          No {active}-day forecast: {missing.slice(0, 8).join(", ")}
          {missing.length > 8 ? ` and ${(missing.length - 8).toLocaleString()} more` : ""}
        </p>
      )}
      <MetricStrip
        items={[
          ["Total forecast", `${total.toLocaleString()} units`, 1.3],
          ["Highest", top ? `${top.product.sku} · ${top.value.toLocaleString()}` : "N/A", 1.6],
          ["Products", `${bars.length.toLocaleString()} of ${products.length.toLocaleString()}`],
        ]}
      />
    </>
  );
}

export function StoreManagerDashboard({ filters, filteredSales, forecast }) {
  const { inventory } = useStore();
  const [chart, setChart] = useState("history");
  const [view, setView] = useState("category");

  // Right card: units by category, or products ranked by net revenue.
  const categories = aggregateCategories(filteredSales);
  const totalUnits = categories.reduce((sum, item) => sum + item.value, 0);
  const products = inventory
    .map((item) => ({
      ...item,
      value: filteredSales.filter((row) => row.sku === item.sku).reduce((sum, row) => sum + row.netRevenue, 0),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  const totalRevenue = products.reduce((sum, item) => sum + item.value, 0);
  const topProducts = products.slice(0, TOP_PRODUCTS);
  const maxProduct = Math.max(...topProducts.map((item) => item.value), 1);

  return (
    <div className="dashboard-grid role-grid store-dashboard-grid">
      <Card className="store-forecast-card">
        <ChartTabs
          tabs={[
            ["history", "Historical Sales vs Forecast"],
            ["all", "All Products Forecast"],
          ]}
          value={chart}
          onChange={setChart}
        />
        {chart === "history" ? (
          <HistoryVsForecast filters={filters} filteredSales={filteredSales} forecast={forecast} />
        ) : (
          <AllProductsForecast filters={filters} />
        )}
      </Card>

      <Card className="store-secondary-chart">
        <ChartTabs
          tabs={[
            ["category", "Sales by Category"],
            ["products", "Top Products"],
          ]}
          value={view}
          onChange={setView}
        />
        {view === "category" ? (
          <>
            <CardHeader
              title="Units sold by category"
              subtitle={`${plural(totalUnits, "unit")} · ${plural(categories.length, "category", "categories")}`}
            />
            {categories.length ? (
              <ColumnChart
                unitLabel="Units"
                ariaLabel="Units sold by category"
                data={categories.map((item) => ({ label: item.label, value: item.value, note: share(item.value, totalUnits) }))}
              />
            ) : (
              <EmptyState inline title="No sales in the selected range" detail="Widen the date range or clear filters." />
            )}
            <MetricStrip
              items={[
                ["Total units", totalUnits.toLocaleString()],
                ["Top category", categories[0]?.label ?? "N/A", 1.5],
                ["Top share", categories[0] ? share(categories[0].value, totalUnits) : "N/A"],
              ]}
            />
          </>
        ) : (
          <>
            <CardHeader title={`Top ${TOP_PRODUCTS} products`} subtitle="By net sales revenue" />
            {topProducts.length ? (
              <div className="ranked-products">
                {topProducts.map((item, index) => (
                  <div key={item.sku} className="ranked-row" title={`${item.name}: ${money(item.value)} (${share(item.value, totalRevenue)} of revenue)`}>
                    <em>{index + 1}</em>
                    <div>
                      <div className="ranked-line">
                        <span>
                          {item.name}
                          <small>
                            {item.sku} · {item.category}
                          </small>
                        </span>
                        <strong>
                          {money(item.value)}
                          <small>{share(item.value, totalRevenue)}</small>
                        </strong>
                      </div>
                      <i>
                        <b style={{ width: `${(item.value / maxProduct) * 100}%` }} />
                      </i>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState inline title="No sales in the selected range" detail="Widen the date range or clear filters." />
            )}
            <MetricStrip
              items={[
                ["Total revenue", money(totalRevenue)],
                [`Top ${TOP_PRODUCTS} share`, share(topProducts.reduce((sum, item) => sum + item.value, 0), totalRevenue)],
                ["Products sold", String(products.length)],
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}
