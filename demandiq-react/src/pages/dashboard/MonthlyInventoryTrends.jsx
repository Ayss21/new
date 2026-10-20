// "Monthly inventory trends": grouped bars of units in stock at month end, by status.
// Data comes only from month-end snapshots; months without a snapshot show "No data".
// Pick any months (none picked = every month in the date range); four fit, more scroll sideways.
import { useMemo, useState } from "react";
import { TREND_STATUSES, filterInventory, monthlyInventoryTrend } from "../../lib/domain";
import { formatRange } from "../../lib/format";
import { useStore } from "../../store/AppStore";
import { Card, CardHeader, EmptyState, MultiSelect } from "../../components/ui";

const STATUS_CLASS = { Safe: "trend-safe", Warning: "trend-low", Critical: "trend-critical" };
const VISIBLE_MONTHS = 4;

function niceMax(value) {
  if (value <= 0) return 1;
  const raw = value / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw);
  return Math.ceil(value / step) * step;
}

const compact = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export function MonthlyInventoryTrends({ filters }) {
  const { snapshots, inventory } = useStore();
  const [months, setMonths] = useState([]); // [] = every month in the date range
  // Products that match the global filters; the stock statuses picked on the dashboard choose the bars
  const skus = useMemo(() => filterInventory(inventory, { ...filters, status: [] }).map((i) => i.sku), [inventory, filters]);
  const statuses = filters.status?.length ? TREND_STATUSES.filter(({ key }) => filters.status.includes(key)) : TREND_STATUSES;
  const trend = useMemo(
    () => monthlyInventoryTrend(snapshots, filters.startDate, filters.endDate, skus),
    [snapshots, filters.startDate, filters.endDate, skus],
  );
  const picked = months.filter((month) => trend.some((m) => m.month === month));
  const shown = picked.length ? trend.filter((m) => picked.includes(m.month)) : trend;
  const top = niceMax(Math.max(0, ...shown.flatMap((m) => (m.hasData ? statuses.map(({ key }) => m.groups[key].units) : []))));
  const ticks = [top, top * 0.75, top * 0.5, top * 0.25, 0];
  const anyData = shown.some((m) => m.hasData);
  const single = shown.length === 1;
  const scroll = shown.length > VISIBLE_MONTHS;

  return (
    <Card className="monthly-trends-card">
      <CardHeader
        title="Monthly inventory trends"
        subtitle={`Units at month end · ${formatRange(filters.startDate, filters.endDate)}`}
        action={
          <div className="trend-header-tools">
            <div className="trend-legend" aria-hidden="true">
              {statuses.map(({ key, label }) => (
                <span key={key}>
                  <i className={STATUS_CLASS[key]} />
                  {label}
                </span>
              ))}
            </div>
            <MultiSelect
              className="month-filter"
              ariaLabel="Months"
              allLabel="All months"
              options={trend.map((m) => ({ value: m.month, label: m.label }))}
              value={picked}
              summary={(n) => `${n} months`}
              onChange={setMonths}
            />
          </div>
        }
      />
      {!trend.length ? (
        <EmptyState inline title="No months in range" detail="Choose a wider date range." />
      ) : (
        <div className={`trend-chart ${scroll ? "is-scrollable" : ""}`} role="group" aria-label="Units in stock at month end by status">
          <div className="trend-y">
            <span className="trend-axis-title">Units</span>
            {ticks.map((t) => (
              <span key={t}>{compact(Math.round(t))}</span>
            ))}
          </div>
          <div className="trend-scroll" tabIndex={scroll ? 0 : undefined} aria-label={scroll ? `${shown.length} months, scrolls sideways` : undefined}>
            <div className="trend-plot" style={scroll ? { width: `${(shown.length / VISIBLE_MONTHS) * 100}%` } : undefined}>
              <div className="trend-grid">
                {ticks.map((t) => (
                  <i key={t} />
                ))}
              </div>
              <div className="trend-groups">
                {shown.map((m) => (
                  <div className={`trend-group ${single ? "single" : ""}`} key={m.month}>
                    <div className="trend-bars">
                      {m.hasData ? (
                        statuses.map(({ key, label }) => {
                          const { units, products } = m.groups[key];
                          return (
                            <div
                              key={key}
                              className={`trend-bar ${STATUS_CLASS[key]}`}
                              style={{ height: `${(units / top) * 100}%` }}
                              tabIndex={0}
                              aria-label={`${m.label}, ${label}: ${units.toLocaleString()} units, ${products} product${products === 1 ? "" : "s"}`}
                            >
                              <b>{single ? units.toLocaleString() : compact(units)}</b>
                              <span className="trend-tip" role="tooltip">
                                <strong>{m.label}</strong>
                                {label} · {units.toLocaleString()} units
                                <br />
                                {products} product{products === 1 ? "" : "s"} · as of {m.asOf}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <span className="trend-nodata">No data</span>
                      )}
                    </div>
                    <span className="trend-x">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {trend.length > 0 && !anyData && <p className="trend-footnote">No month-end snapshots in this range.</p>}
    </Card>
  );
}
