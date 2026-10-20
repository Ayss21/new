// Demand forecasting: pick the horizon → run → view the forecast, its accuracy and the run history.
// The product, the model and the history's dates come from the Global filters:
//   • product: the one SKU picked there; otherwise the product shown (a run picked in the history), else the
//     newest run's product — preferring products that have sales in the date range — else the first product
//     with sales
//   • model: the one model picked there; otherwise the most accurate of the picked models (all three when
//     none is picked), found by comparing them on the same history (POST /forecasts/compare)
// API: POST /forecasts (run and save, through the store), POST /forecasts/compare and GET /forecasts/lineage
// (forecastService), GET /forecasts (the run history, loaded by the store).
import { useMemo, useState } from "react";
import { FORECAST_MODELS, dailySeries, dateBounds, describeConfiguration, filterForecasts, filterInventory, filterSales, normalizeFilters } from "../lib/domain";
import { formatDateTime, formatRange, plural } from "../lib/format";
import { settle } from "../services/api";
import { forecastService } from "../services/forecastService";
import { useStore } from "../store/AppStore";
import { useRequest } from "../store/useRequest";
import { useWorkspace } from "../store/WorkspaceContext";
import { Button, Card, CardHeader, DataLineChart, EmptyState, Field, Icon, Kpi, Modal, ProgressState, Status, TableFooter, paginate } from "../components/ui";

/** Moving Average always uses a 7-day window; ARIMA uses order (2,1,2). */
const MOVING_AVERAGE_WINDOW = 7;
const ARIMA_ORDER = [2, 1, 2];
const HORIZONS = ["7", "14", "30", "60", "90"];
const DEFAULT_HORIZON = "30";

const uploadsLabel = (lineage) => plural(lineage.sources.filter((s) => s.datasetId).length, "cleaned upload");
const sourceTitle = (s) => `${s.fileName ?? "Sales history loaded before uploads"} · ${formatRange(s.firstDate, s.lastDate)} · ${plural(s.records, "record")}`;

/** The most accurate result of a comparison: lowest MAPE, else lowest MAE. */
function mostAccurate(results) {
  const done = results.filter((r) => r.status === "Completed" && r.metrics);
  const metric = done.length && done.every((r) => r.metrics.mape != null) ? "mape" : "mae";
  return [...done].sort((a, b) => a.metrics[metric] - b.metrics[metric] || a.metrics.rmse - b.metrics.rmse)[0]?.model ?? null;
}

/**
 * One sentence naming the dataset the forecast uses: the newest cleaned upload in its history. When the product
 * has no sales in the date range, a button switches the range to the dates its sales cover (`range`).
 */
function DatasetSentence({ request, sku, range, onUseRange }) {
  const lineage = request.data;
  let text;
  if (request.error) text = `Couldn't check the data: ${request.error.message}`;
  else if (!lineage) text = "Checking the dataset…";
  else if (!lineage.records) text = `No cleaned sales for ${sku} in this date range.`;
  else {
    const uploads = lineage.sources.filter((s) => s.fileName);
    const newest = uploads.at(-1);
    text = newest
      ? `Dataset: ${newest.fileName}${uploads.length > 1 ? ` and ${plural(uploads.length - 1, "earlier upload")}` : ""}.`
      : "Dataset: the sales history loaded before uploads.";
  }
  return (
    <p className="dataset-sentence" aria-live="polite" title={lineage?.sources.map(sourceTitle).join("\n")}>
      <Icon name="report" size={15} />
      <span className="dataset-sentence-text">{text}</span>
      {lineage && !lineage.records && range && (
        <button type="button" className="dataset-sentence-action" onClick={onUseRange}>
          Use {formatRange(range.start, range.end)}
        </button>
      )}
    </p>
  );
}

export default function ForecastingPage() {
  const { sales, datasets, appliedFilters, forecastHistory, inventory, runForecast, notify, can, canExport, showDates } = useStore();
  const filters = normalizeFilters(appliedFilters);
  const canDownload = canExport("Demand Forecast Report");
  const { openExport } = useWorkspace();
  // A role can open this screen without the "Run forecasts" action (the Admin, or "View"): it sees results only
  const canRun = can("Run forecasts");
  const viewOnly = canRun ? undefined : "View only";
  // Saved runs and products that match the global filters
  const runs = filterForecasts(forecastHistory, filters, inventory);
  const products = filterInventory(inventory, { ...filters, status: [] });
  const models = filters.model.length ? FORECAST_MODELS.filter((m) => filters.model.includes(m)) : FORECAST_MODELS;

  // Products with sales in the date range: when no SKU is picked, the page forecasts one of them
  const withSales = useMemo(() => {
    const skus = new Set();
    for (const row of sales) if (row.date >= filters.startDate && row.date <= filters.endDate) skus.add(row.sku);
    return skus;
  }, [sales, filters.startDate, filters.endDate]);
  /** The product to forecast: the one SKU picked; else `current` (the run shown) or the newest run's product, preferring products with sales in the range, else the first product with sales. */
  const pickSku = (current) => {
    if (filters.sku.length === 1) return filters.sku[0];
    const listed = (candidate) => products.some((p) => p.sku === candidate);
    if (current && listed(current) && withSales.has(current)) return current;
    return (
      runs.find((run) => listed(run.sku) && withSales.has(run.sku))?.sku ??
      products.find((p) => withSales.has(p.sku))?.sku ??
      (current && listed(current) ? current : null) ??
      runs.find((run) => listed(run.sku))?.sku ??
      products[0]?.sku ??
      null
    );
  };

  const [result, setResult] = useState(() => {
    const first = pickSku(null);
    return runs.find((run) => run.sku === first) ?? null;
  });
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON);
  const [stage, setStage] = useState(null); // null | "choosing" | "running"
  const [comparing, setComparing] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [comparison, setComparison] = useState(null);

  // The product to forecast (see the top of this file)
  const sku = pickSku(result?.sku);
  const modelLabel = models.length === 1 ? models[0] : `Most accurate of ${models.length === 3 ? "3 models" : models.join(" / ")}`;
  const resultHistory = result ? filterSales(sales, { ...filters, sku: [result.sku] }) : [];
  // The dates this product's sales cover, whatever the filters
  const skuRange = useMemo(() => {
    const own = sku ? sales.filter((row) => row.sku === sku) : [];
    return own.length ? dateBounds(own) : null;
  }, [sales, sku]);
  // Which uploads this product's history comes from — asked again when the product, the range or the data changes
  const lineagePreview = useRequest(
    () => (sku ? forecastService.getLineage({ sku, startDate: filters.startDate, endDate: filters.endDate }) : Promise.resolve(null)),
    [sku, filters.startDate, filters.endDate, sales, datasets],
  );

  const request = (model) => ({
    sku,
    model,
    horizon: Number(horizon),
    windowSize: MOVING_AVERAGE_WINDOW,
    order: ARIMA_ORDER,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  /** POST /forecasts/compare — the models on the same history; nothing is saved. */
  const compareModels = () => settle(forecastService.compareModels(request(models[0])));

  /** POST /forecasts — runs on the server and is saved to the run history. With several models, the most accurate. */
  const run = async (chosen) => {
    if (!canRun || stage || !sku) return;
    setForecastError("");
    setResultPage(1);
    let model = chosen ?? (models.length === 1 ? models[0] : null);
    if (!model) {
      setStage("choosing");
      const compared = await compareModels();
      model = compared.ok ? mostAccurate(compared.data.results.filter((r) => models.includes(r.model))) : null;
      if (!model) {
        setStage(null);
        return setForecastError(compared.ok ? "None of the models could run on this history." : compared.error.message);
      }
    }
    setStage(model);
    const outcome = await runForecast(request(model));
    setStage(null);
    if (!outcome.ok) {
      setForecastError(outcome.error.message);
      notify(outcome.error.message, 4500, "error");
      return;
    }
    setResult(outcome.data);
    notify(`${model} forecast saved for ${sku}.`);
  };

  /** Compare models for the product: accuracy of each, nothing saved. */
  const compare = async () => {
    if (!canRun || comparing || !sku) return;
    setForecastError("");
    setComparing(true);
    const outcome = await compareModels();
    setComparing(false);
    if (!outcome.ok) return setForecastError(outcome.error.message);
    setComparison(
      outcome.data.results.map((item) => ({
        model: item.model,
        result: item.status === "Completed" ? { ...item.metrics, total: item.totalPredicted } : null,
        error: item.error,
      })),
    );
  };

  const reset = () => {
    setHorizon(DEFAULT_HORIZON);
    setForecastError("");
    setResultPage(1);
    setResult(runs.find((r) => r.sku === sku) ?? null);
  };

  const forecastTotal = result?.points.reduce((sum, point) => sum + point.forecast, 0) || 0;
  const average = result ? forecastTotal / result.points.length : 0;
  const peak = result ? Math.max(...result.points.map((point) => point.forecast)) : 0;
  const resultRows = paginate(result?.points ?? [], resultPage, 5);
  const historyRows = paginate(runs, historyPage, 4);
  // The comparison lists the picked models (all three when one or none is picked); only a picked model can be run
  const compared = comparison && models.length > 1 ? comparison.filter((c) => models.includes(c.model)) : comparison;
  const best = compared
    ? mostAccurate(compared.map((c) => ({ model: c.model, status: c.result ? "Completed" : "Failed", metrics: c.result })))
    : null;
  const evaluationLabel = result?.holdoutDays ? `${result.holdoutDays}-period holdout` : "Holdout evaluation";

  return (
    <div className="page-stack forecasting-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEMAND PLANNING</span>
          <h1>Demand forecasting</h1>
        </div>
        {canDownload && (
          <Button variant="secondary" icon="download" onClick={() => openExport("CSV", "Demand Forecast Report")}>
            Download results
          </Button>
        )}
      </div>
      <div className="forecast-layout">
        <Card className="config-panel is-simple">
          <CardHeader title="Forecast configuration" subtitle={sku ? `${sku} · ${modelLabel}` : "No product matches the filters"} />
          <Field label="Forecast horizon" as="div">
            <div className="segmented" role="radiogroup" aria-label="Forecast horizon">
              {HORIZONS.map((x) => (
                <button type="button" role="radio" aria-checked={x === horizon} onClick={() => setHorizon(x)} className={x === horizon ? "active" : ""} key={x}>
                  {x} days
                </button>
              ))}
            </div>
          </Field>
          {sku && <DatasetSentence request={lineagePreview} sku={sku} range={skuRange} onUseRange={() => showDates(skuRange.start, skuRange.end)} />}
          {forecastError && (
            <div className="form-error forecast-error" role="alert">
              <Icon name="warning" size={16} />
              {forecastError}
            </div>
          )}
          <div className="config-actions">
            <Button variant="secondary" onClick={reset} disabled={!canRun} title={viewOnly}>
              Reset
            </Button>
            <Button icon="trend" onClick={() => run()} disabled={!canRun || !sku} title={viewOnly}>
              Run forecast
            </Button>
          </div>
        </Card>

        <div className="page-stack forecast-results-layout">
          <Card>
            <CardHeader
              title={`Demand forecast · ${result?.sku ?? sku ?? "—"} · ${result?.model || "Not run"}`}
              subtitle={`Historical and predicted units · ${result?.horizon ?? horizon}-day horizon`}
              action={
                <div className="legend chart-legend" aria-hidden="true">
                  <span>
                    <i className="legend-actual" />
                    Historical
                  </span>
                  <span>
                    <i className="legend-forecast" />
                    Forecast
                  </span>
                </div>
              }
            />
            {result ? (
              <DataLineChart
                historical={dailySeries(resultHistory, filters.startDate, filters.endDate)}
                forecast={result.points.map((point) => ({ date: point.date, value: point.forecast }))}
              />
            ) : (
              <EmptyState className="forecast-empty" icon="trend" title="No forecast yet" detail="Pick a horizon and run a forecast." />
            )}
            {result && (
              <div className="forecast-stats">
                {[
                  ["Forecast demand", `${forecastTotal.toLocaleString()} units`, result.model],
                  ["Daily average", `${average.toFixed(1)} units`, describeConfiguration(result)],
                  ["Peak demand", `${peak} units`, `${result.horizon}-day horizon`],
                  result.lineage
                    ? ["Data used", plural(result.lineage.records, "record"), uploadsLabel(result.lineage), result.lineage.sources.map(sourceTitle).join("\n")]
                    : ["Data used", "Not recorded", "Saved before lineage"],
                ].map((x) => (
                  <div key={x[0]} title={x[3]}>
                    <span>{x[0]}</span>
                    <strong>{x[1]}</strong>
                    <small>{x[2]}</small>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="three-col">
            <Kpi label="MAE" value={result?.mae == null ? "N/A" : result.mae.toFixed(2)} change={evaluationLabel} icon="trend" />
            <Kpi label="RMSE" value={result?.rmse == null ? "N/A" : result.rmse.toFixed(2)} change={evaluationLabel} icon="trend" />
            <Kpi
              label="MAPE"
              value={result?.mape == null ? "N/A" : `${result.mape.toFixed(2)}%`}
              change={result ? `${result.model} evaluation` : "Run required"}
              icon="check"
            />
          </div>
          {result && (
            <div className="run-again">
              <span>
                {result.id} · {result.model} ({describeConfiguration(result)})
                {result.generatedBy ? ` · run by ${result.generatedBy.name}` : ""}
              </span>
              <Button variant="secondary" onClick={() => run()} disabled={!canRun || !sku} title={viewOnly}>
                Run again
              </Button>
            </div>
          )}
        </div>
      </div>

      {result && (
        <Card className="compact-forecast-table">
          <CardHeader
            title={`Forecast results · ${result.model}`}
            subtitle={`Daily values · ${result.horizon}-day horizon`}
            action={
              canDownload ? (
                <Button variant="ghost" icon="download" onClick={() => openExport("CSV", "Demand Forecast Report")}>
                  Download
                </Button>
              ) : undefined
            }
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Forecasted units</th>
                  <th>Actual units</th>
                  <th>Forecast error</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {resultRows.rows.map((point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td>
                      <strong>{point.forecast} units</strong>
                    </td>
                    <td>Future period</td>
                    <td>N/A</td>
                    <td>{result.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TableFooter label={resultRows.label} page={resultRows.page} pageCount={resultRows.pageCount} onPage={setResultPage} />
        </Card>
      )}

      <Card className="compact-forecast-history">
        <CardHeader
          title="Model comparison & run history"
          subtitle="Saved forecast runs"
          action={
            <div className="table-tools">
              <Button variant="secondary" icon="check" onClick={compare} disabled={!canRun || comparing || !sku} title={viewOnly}>
                {comparing ? "Comparing models…" : `Compare models for ${sku ?? "—"}`}
              </Button>
              <Status value={runs.length ? "Completed" : "Pending"} />
            </div>
          }
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Model</th>
                <th>SKU</th>
                <th>Data used</th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>MAPE</th>
                <th>Horizon</th>
                <th>Executed</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.rows.length ? (
                historyRows.rows.map((saved) => (
                  <tr key={saved.id} className={saved.id === result?.id ? "selected-row" : ""}>
                    <td className="muted">{saved.id}</td>
                    <td>
                      <button className="table-link" onClick={() => setResult(saved)} title={`View this run (${describeConfiguration(saved)})`}>
                        {saved.model === "ARIMA" ? `ARIMA (${saved.configuration.order})` : saved.model}
                      </button>
                    </td>
                    <td>{saved.sku}</td>
                    <td title={saved.lineage?.sources.map(sourceTitle).join("\n")}>
                      {saved.lineage ? saved.lineage.sources.map((s) => s.datasetId ?? "Earlier").join(", ") : "—"}
                    </td>
                    <td>{saved.mae?.toFixed(2) ?? "N/A"}</td>
                    <td>{saved.rmse?.toFixed(2) ?? "N/A"}</td>
                    <td>{saved.mape == null ? "N/A" : `${saved.mape.toFixed(2)}%`}</td>
                    <td>{saved.horizon} days</td>
                    <td>{formatDateTime(saved.generatedAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9}>No forecast runs for these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TableFooter label={plural(runs.length, "saved run")} page={historyRows.page} pageCount={historyRows.pageCount} onPage={setHistoryPage} />
      </Card>

      {stage && (
        <Modal title="Running demand forecast" onClose={() => {}}>
          <div className="modal-body">
            <ProgressState
              title={stage === "choosing" ? "Choosing the most accurate model" : `Processing ${stage}`}
              detail={stage === "choosing" ? `Testing ${models.join(", ")} on ${sku}'s sales…` : `Fitting ${stage} to ${sku}'s daily sales…`}
            />
          </div>
        </Modal>
      )}

      {comparison && (
        <Modal title={`Model accuracy · ${sku}`} onClose={() => setComparison(null)} width="wide">
          <div className="modal-body">
            <p>Tested on the most recent days each model didn't see. Lower is better.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>MAE</th>
                    <th>RMSE</th>
                    <th>MAPE</th>
                    <th>Accuracy</th>
                    <th>{horizon}-day demand</th>
                  </tr>
                </thead>
                <tbody>
                  {compared.map((c) => (
                    <tr key={c.model}>
                      <td>
                        <strong>{c.model}</strong>
                        {best === c.model && <span className="best">Most accurate</span>}
                      </td>
                      {c.result ? (
                        <>
                          <td>{c.result.mae?.toFixed(2) ?? "N/A"}</td>
                          <td>{c.result.rmse?.toFixed(2) ?? "N/A"}</td>
                          <td>{c.result.mape == null ? "N/A" : `${c.result.mape.toFixed(2)}%`}</td>
                          <td>{c.result.mape == null ? "N/A" : `${Math.max(0, 100 - c.result.mape).toFixed(1)}%`}</td>
                          <td>{c.result.total.toLocaleString()} units</td>
                        </>
                      ) : (
                        <td colSpan={5}>{c.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setComparison(null)}>
              Close
            </Button>
            {best && models.includes(best) && (
              <Button
                onClick={() => {
                  setComparison(null);
                  run(best);
                }}
              >
                Run {best}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
