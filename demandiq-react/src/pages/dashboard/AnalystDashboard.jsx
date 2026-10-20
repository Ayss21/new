import { useMemo, useState } from "react";
import { DEMAND_TYPES, NOT_ENOUGH_DATA, classifyProducts, filterForecasts, filterInventory } from "../../lib/domain";
import { PAGE } from "../../navigation";
import { formatRange, plural } from "../../lib/format";
import { forecastService } from "../../services/forecastService";
import { useStore } from "../../store/AppStore";
import { useRequest } from "../../store/useRequest";
import { useWorkspace } from "../../store/WorkspaceContext";
import { Button, Card, CardHeader, EmptyState, PieChart, PipelineTracker, TableFooter, paginate, useFitRows } from "../../components/ui";

/** The most products a demand type's model recommendation is worked out on (its best sellers). */
const RECOMMENDATION_PRODUCTS = 30;

const DEMAND_TYPE_STYLE = {
  Smooth: { color: "var(--demand-smooth)", labelColor: "var(--jet-black)" },
  Erratic: { color: "var(--demand-erratic)", labelColor: "var(--jet-black)" },
  Intermittent: { color: "var(--demand-intermittent)", labelColor: "var(--white)" },
  Lumpy: { color: "var(--demand-lumpy)", labelColor: "var(--white)" },
};

/** The small hover text: only the recommended model for a demand type. */
function RecommendedModel({ request, type }) {
  const model = request.data?.[type];
  return (
    <>
      <small>Recommended model</small>
      <strong>{request.loading && !request.data ? "Checking…" : request.error && !request.data ? "Unavailable" : model ?? "None (not enough data)"}</strong>
    </>
  );
}

/**
 * Pie of products per demand type (Syntetos–Boylan). Hovering a slice or a row shows the forecasting model
 * recommended for that demand type (POST /forecasts/recommendation, one request per demand type).
 */
function DemandTypeCard({ filters, filteredSales }) {
  const { inventory } = useStore();
  const [hovered, setHovered] = useState(null);
  const skus = useMemo(() => filterInventory(inventory, { ...filters, status: [] }).map((item) => item.sku), [inventory, filters]);
  const { rows, counts } = useMemo(
    () => classifyProducts(filteredSales, skus, filters.startDate, filters.endDate),
    [filteredSales, skus, filters.startDate, filters.endDate],
  );
  // A demand type's recommendation is worked out on its best sellers in the date range (at most 30 products)
  const unitsBySku = useMemo(() => {
    const units = new Map();
    for (const row of filteredSales) units.set(row.sku, (units.get(row.sku) ?? 0) + row.units);
    return units;
  }, [filteredSales]);
  const groups = DEMAND_TYPES.map((type) => {
    const group = rows.filter((row) => row.type === type).map((row) => row.sku);
    const best = (a, b) => (unitsBySku.get(b) ?? 0) - (unitsBySku.get(a) ?? 0) || a.localeCompare(b);
    return [type, group.length > RECOMMENDATION_PRODUCTS ? [...group].sort(best).slice(0, RECOMMENDATION_PRODUCTS) : group];
  });
  const recommendation = useRequest(
    async () =>
      Object.fromEntries(
        await Promise.all(
          groups.map(async ([type, group]) => [type, group.length ? ((await forecastService.getRecommendation({ skus: group, filters })).recommended ?? null) : null]),
        ),
      ),
    [JSON.stringify(groups), JSON.stringify(filters)],
  );
  const classified = rows.length - counts[NOT_ENOUGH_DATA];
  const share = (type) => (classified ? `${((counts[type] / classified) * 100).toFixed(1)}%` : "0%");
  const items = DEMAND_TYPES.map((type) => ({
    key: type,
    label: type,
    value: counts[type],
    color: DEMAND_TYPE_STYLE[type].color,
    labelColor: DEMAND_TYPE_STYLE[type].labelColor,
  }));

  return (
    <Card className="analyst-demand-card">
      <CardHeader
        title="Demand type distribution"
        subtitle={`${classified.toLocaleString()} of ${rows.length.toLocaleString()} products classified · ${formatRange(filters.startDate, filters.endDate)}`}
      />
      {classified ? (
        <div className="demand-pie-wrap">
          <PieChart
            items={items}
            unit="products"
            active={hovered}
            size={140}
            tip={(slice) => <RecommendedModel request={recommendation} type={slice.key} />}
            ariaLabel={`Products by demand type: ${DEMAND_TYPES.map((type) => `${type} ${counts[type]}`).join(", ")}`}
          />
          <div className="demand-legend">
            {DEMAND_TYPES.map((type) => (
              <div
                key={type}
                className={`demand-legend-row ${hovered === type ? "is-active" : ""} ${counts[type] ? "" : "is-empty"}`}
                tabIndex={counts[type] ? 0 : -1}
                onMouseEnter={() => counts[type] && setHovered(type)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(type)}
                onBlur={() => setHovered(null)}
              >
                <i style={{ background: DEMAND_TYPE_STYLE[type].color }} aria-hidden="true" />
                <span>{type}</span>
                <strong>{counts[type].toLocaleString()}</strong>
                <em>{share(type)}</em>
                {hovered === type && counts[type] > 0 && (
                  <div className="legend-tip" role="tooltip">
                    <RecommendedModel request={recommendation} type={type} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState inline icon="trend" title="No products to classify" detail="Widen the date range or clear filters." />
      )}
    </Card>
  );
}

export function AnalystDashboard({ filters, filteredSales }) {
  const { datasets, forecastHistory, inventory, can, canOpen } = useStore();
  const { goTo } = useWorkspace();
  const [runPage, setRunPage] = useState(1);

  // Quality figures: valid filtered records plus the problems found in validated uploads
  const checked = datasets.filter((d) => d.checks);
  const missing = checked.reduce((sum, d) => sum + d.checks.missing, 0);
  const duplicates = checked.reduce((sum, d) => sum + d.checks.duplicates, 0);
  const invalid = checked.reduce((sum, d) => sum + d.checks.invalidDates + d.checks.invalidNumeric, 0);
  const valid = filteredSales.length;
  const total = valid + missing + duplicates + invalid;
  const validPercent = total ? (valid / total) * 100 : 100;
  // Each category has its own colour, in the legend and in the donut
  const qualityParts = [
    ["Valid", valid, "var(--green)"],
    ["Missing", missing, "var(--yellow)"],
    ["Duplicates", duplicates, "var(--violet)"],
    ["Invalid", invalid, "var(--red)"],
  ];
  let qualityStart = 0;
  const qualityArcs = qualityParts
    .map(([, count, color]) => {
      const from = qualityStart;
      qualityStart += total ? (count / total) * 100 : 0;
      return `${color} ${from}% ${qualityStart}%`;
    })
    .join(", ");
  const latest = datasets.find((d) => d.validation !== "Failed");
  const [comparisonTable, pageSize] = useFitRows({ min: 3 });
  // Saved runs of the picked models for the products in the filters
  const scopedRuns = filterForecasts(forecastHistory, filters, inventory);
  const runs = paginate(scopedRuns, runPage, pageSize);

  return (
    <div className="analyst-dashboard">
      <div className="analyst-row">
      <Card className="analyst-quality-card">
        <CardHeader title="Data quality summary" subtitle="Filtered records and upload checks" />
        <div className="quality-donut-wrap">
          <div
            className="quality-donut"
            style={{ background: total ? `conic-gradient(${qualityArcs})` : "var(--green)" }}
          >
            <div>
              <strong>{validPercent >= 99.95 ? "100%" : `${validPercent.toFixed(1)}%`}</strong>
              <span>Valid</span>
            </div>
          </div>
          <div className="quality-legend">
            {qualityParts.map(([label, count, color]) => (
              <div key={label}>
                <span>
                  <i style={{ background: color }} />
                  {label}
                </span>
                <strong>{count.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <DemandTypeCard filters={filters} filteredSales={filteredSales} />
      <Card className="analyst-pipeline-card">
        <CardHeader
          title="Latest data pipeline"
          subtitle={latest ? latest.fileName : "No datasets yet"}
          action={
            latest && latest.cleaning === "Pending" && can("Clean data") && canOpen(PAGE.SALES) ? (
              <Button variant="ghost" onClick={() => goTo(PAGE.SALES)}>
                Clean data
              </Button>
            ) : undefined
          }
        />
        {latest && <PipelineTracker dataset={latest} vertical />}
      </Card>
      </div>
      <Card className="analyst-comparison-card">
        <CardHeader title="Forecast comparison" subtitle="Evaluation metrics from actual runs" />
        <div className="table-wrap">
          <table ref={comparisonTable}>
            <thead>
              <tr>
                <th>Model</th>
                <th>SKU</th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>MAPE</th>
                <th>Horizon</th>
              </tr>
            </thead>
            <tbody>
              {runs.rows.length ? (
                runs.rows.map((run) => (
                  <tr key={`${run.generatedAt}-${run.sku}`}>
                    <td>
                      <strong>{run.model === "ARIMA" ? `ARIMA (${run.configuration.order})` : run.model}</strong>
                    </td>
                    <td>{run.sku}</td>
                    <td>{run.mae?.toFixed(2) ?? "N/A"}</td>
                    <td>{run.rmse?.toFixed(2) ?? "N/A"}</td>
                    <td>{run.mape == null ? "N/A" : `${run.mape.toFixed(2)}%`}</td>
                    <td>{run.horizon} days</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No forecast runs for these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TableFooter
          label={plural(scopedRuns.length, "forecast run")}
          page={runs.page}
          pageCount={runs.pageCount}
          onPage={setRunPage}
        />
      </Card>
    </div>
  );
}
