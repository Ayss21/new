// Sales Data: file upload (Store Manager), cleaning (Data Analyst) and the dataset history with the
// Uploaded → Cleaned → Forecasted tracker. The Admin sees everything, with the actions switched off.
// API: POST /datasets (upload), POST /datasets/{id}/clean, GET /datasets — through the store.
// An upload's "Forecasted" status comes from its lineage: the saved forecasts that used its records.
import { useMemo, useState } from "react";
import { formatDateTime, formatRange, plural } from "../lib/format";
import { PAGE } from "../navigation";
import { useStore } from "../store/AppStore";
import { useWorkspace } from "../store/WorkspaceContext";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Icon,
  Modal,
  MultiSelect,
  PipelineTracker,
  ProgressState,
  SearchBox,
  Select,
  Status,
  TableFooter,
  paginate,
  useFitRows,
} from "../components/ui";

/** File types offered when browsing (any file can be chosen; the server reads it by its contents). */
const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm";
/** Dataset history: an upload is Uploaded or Failed, and Forecasted once forecasts used all its products. */
const actionOf = (d) => (d.validation === "Failed" ? "Failed" : "Uploaded");
const forecastStatusOf = (d) => (d.forecasting === "Completed" ? "Forecasted" : "Not Forecasted");

function ValidationGrid({ checks }) {
  // [label, count, a warning when above 0]
  const cells = [
    ["Rows in file", checks.total, false],
    ["Valid records", checks.valid, false],
    ...(checks.combined ? [["Rows combined", checks.combined, false]] : []),
    ["Missing values", checks.missing, true],
    ["Duplicates", checks.duplicates, true],
    ["Invalid data", checks.invalidDates + checks.invalidNumeric, true],
  ];
  return (
    <div className={`validation-grid ${cells.length > 5 ? "six" : ""}`}>
      {cells.map(([label, count, warn]) => (
        <div key={label} className={warn && count > 0 ? "warning-result" : ""} title={label === "Rows combined" ? "Rows for the same product and day, added together" : undefined}>
          <span>{label}</span>
          <strong>{count.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

function CleaningSummaryList({ summary }) {
  return (
    <div className="summary-list">
      {[
        ["Validated records cleaned", summary.inputRecords],
        ["Rows excluded at validation", summary.excludedAtValidation],
        ["Extreme values capped", summary.outliersCapped],
        ["New records added", summary.added],
        ["Existing records replaced", summary.replaced],
        ["Overlapping records skipped", summary.skipped],
      ].map((item) => (
        <div key={item[0]}>
          <span>{item[0]}</span>
          <strong>{Number(item[1]).toLocaleString()}</strong>
        </div>
      ))}
      <div>
        <span>Cleaned by</span>
        <strong>
          {summary.cleanedBy} · {formatDateTime(summary.cleanedAt)}
        </strong>
      </div>
    </div>
  );
}

/** Data Analyst: confirm cleaning options, run cleaning, show what changed. */
function CleanDatasetModal({ dataset, onClose }) {
  const { cleanDataset, notify, can, canOpen, appliedFilters, showDates } = useStore();
  const { goTo } = useWorkspace();
  const [options, setOptions] = useState({ capOutliers: true, overlap: "replace" });
  const [stage, setStage] = useState("options");
  const [summary, setSummary] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState("");
  // Sales from before (or after) the dates in the filters wouldn't show anywhere until the dates change
  const outside = coverage && (coverage.lastDate < appliedFilters.startDate || coverage.firstDate > appliedFilters.endDate);
  const showCoverage = () => showDates(coverage.firstDate, coverage.lastDate);

  const run = async () => {
    setStage("progress");
    setError("");
    const result = await cleanDataset(dataset.id, options);
    if (!result.ok) {
      setError(result.error.message);
      setStage("options");
      return;
    }
    setSummary(result.data.summary);
    setCoverage(result.data.dataset.coverage);
    setStage("done");
    notify(`${dataset.fileName} cleaned. ${(result.data.summary.added + result.data.summary.replaced).toLocaleString()} records are now in the shared dataset.`);
  };

  if (stage === "progress")
    return (
      <Modal title="Cleaning sales dataset" onClose={() => {}}>
        <div className="modal-body">
          <ProgressState
            title={`Cleaning ${dataset.fileName}`}
            detail="Capping extreme values and merging records into the shared sales dataset…"
          />
        </div>
      </Modal>
    );

  if (stage === "done" && summary)
    return (
      <Modal title="Cleaning complete" onClose={onClose}>
        <div className="success-hero">
          <div>
            <Icon name="check" size={28} />
          </div>
          <h3>Dataset cleaned and ready for forecasting</h3>
        </div>
        <div className="modal-body">
          <CleaningSummaryList summary={summary} />
          {outside && <p className="clean-dates-note">These sales are from {formatRange(coverage.firstDate, coverage.lastDate)}, outside the dates in the filters.</p>}
        </div>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {outside && (
            <Button
              variant="secondary"
              onClick={() => {
                showCoverage();
                onClose();
              }}
            >
              Show these dates
            </Button>
          )}
          {can("Run forecasts") && canOpen(PAGE.FORECASTING) && (
            <Button
              icon="trend"
              onClick={() => {
                if (outside) showCoverage();
                onClose();
                goTo(PAGE.FORECASTING);
              }}
            >
              Run forecast
            </Button>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal title="Clean sales dataset" onClose={onClose} width="wide">
      <div className="modal-body">
        <div className="file-summary">
          <div className="file-icon">
            <Icon name="report" />
          </div>
          <div>
            <strong>{dataset.fileName}</strong>
            <span>
              Uploaded by {dataset.uploader} · {formatDateTime(dataset.uploadedAt)}
            </span>
          </div>
          <Status value={dataset.validation} />
        </div>
        {dataset.checks && <ValidationGrid checks={dataset.checks} />}
        <div className="clean-options">
          <label className="check">
            <input
              type="checkbox"
              checked={options.capOutliers}
              onChange={(e) => setOptions({ ...options, capOutliers: e.target.checked })}
            />
            <span>
              <strong>Cap extreme values</strong> (above Q3 + 3×IQR)
            </span>
          </label>
          <Field label="Records for a date and SKU that already exist">
            <Select value={options.overlap} onChange={(v) => setOptions({ ...options, overlap: v })}>
              <option value="replace">Replace the existing record (corrected upload)</option>
              <option value="skip">Keep the existing record and skip the new one</option>
            </Select>
          </Field>
        </div>
        {error && (
          <div className="form-error no-margin" role="alert">
            <Icon name="warning" size={16} />
            {error}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button icon="clean" onClick={run}>
          Clean & merge {dataset.recordCount.toLocaleString()} records
        </Button>
      </div>
    </Modal>
  );
}

/** Where an upload's records went and which saved forecasts used them (its lineage, worked out by the server). */
function DatasetLineage({ dataset }) {
  const { forecastHistory } = useStore();
  if (dataset.validation === "Failed" || !dataset.coverage) return null;
  const { recordsInHistory, skus, forecastedSkus, forecastIds } = dataset.lineage;
  const runs = forecastIds.map((id) => forecastHistory.find((run) => run.id === id)).filter(Boolean);
  const cleaned = dataset.cleaning === "Completed";
  const covers = `${formatRange(dataset.coverage.firstDate, dataset.coverage.lastDate)} · ${plural(dataset.coverage.products, "product")}`;
  return (
    <section className="dataset-lineage" aria-label="Forecasting lineage">
      <div className="demand-section-head">
        <strong>Used for forecasting</strong>
        <Status value={dataset.forecasting} />
      </div>
      <p>
        {!cleaned
          ? `Covers ${covers}. Waiting for cleaning.`
          : !skus.length
            ? `Covers ${covers}. None of its records are in the sales history.`
            : `Covers ${covers} · ${plural(recordsInHistory, "record")} in the sales history · ${forecastedSkus.length.toLocaleString()} of ${plural(skus.length, "product")} forecast.`}
      </p>
      {cleaned && skus.length > 0 && (
        <div className="lineage-products" aria-label="Products forecast with this upload">
          {skus.map((sku) => {
            const done = forecastedSkus.includes(sku);
            return (
              <span key={sku} className={done ? "is-done" : ""} title={done ? `${sku}: forecast with this upload's records` : `${sku}: not forecast with these records yet`}>
                {done && <Icon name="check" size={12} />}
                {sku}
              </span>
            );
          })}
        </div>
      )}
      {runs.length > 0 && (
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Forecast run</th>
                <th>Product</th>
                <th>Model</th>
                <th className="num" title="Records from this upload that the run used">Records used</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 4).map((run) => (
                <tr key={run.id}>
                  <td>
                    <strong>{run.id}</strong>
                  </td>
                  <td>{run.sku}</td>
                  <td>{run.model}</td>
                  <td className="num">{run.lineage?.sources.find((s) => s.datasetId === dataset.id)?.records ?? "—"}</td>
                  <td>{formatDateTime(run.generatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length > 4 && <p className="demand-footnote">…and {plural(runs.length - 4, "more run")}.</p>}
        </div>
      )}
    </section>
  );
}

function DatasetDetailsModal({ dataset, onClose, onClean }) {
  const { can, level } = useStore();
  const waiting = dataset.cleaning === "Pending" && dataset.pendingCount > 0;
  const cleanable = waiting && level("Clean data") !== "No";
  return (
    <Modal title="Dataset information" onClose={onClose} width="wide">
      <div className="modal-body">
        <div className="summary-list">
          {[
            ["File name", dataset.fileName],
            ["Uploaded", formatDateTime(dataset.uploadedAt)],
            ["Uploader", dataset.uploader],
            ["Record count", dataset.recordCount.toLocaleString()],
            ["Validation", dataset.validation],
          ].map((item) => (
            <div key={item[0]}>
              <span>{item[0]}</span>
              <strong>{item[1]}</strong>
            </div>
          ))}
        </div>
        <div className="card pipeline-card">
          <PipelineTracker dataset={dataset} centered={false} />
        </div>
        {dataset.error && (
          <div className="form-error no-margin" role="alert">
            <Icon name="warning" size={16} />
            Validation failed: {dataset.error}
          </div>
        )}
        {dataset.newProducts?.length > 0 && (
          <p className="new-products-note">
            <Icon name="box" size={15} />
            New products added from this file: {dataset.newProducts.slice(0, 12).join(", ")}
            {dataset.newProducts.length > 12 ? ` and ${(dataset.newProducts.length - 12).toLocaleString()} more` : ""}
          </p>
        )}
        <DatasetLineage dataset={dataset} />
        {dataset.checks && <ValidationGrid checks={dataset.checks} />}
        {dataset.cleaningSummary && <CleaningSummaryList summary={dataset.cleaningSummary} />}
      </div>
      <div className="modal-actions">
        <Button variant={cleanable ? "secondary" : "primary"} onClick={onClose}>
          Close
        </Button>
        {cleanable && (
          <Button icon="clean" onClick={onClean} disabled={!can("Clean data")} title={can("Clean data") ? undefined : "View only"}>
            Clean dataset
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** The upload dialog: choose or drop a file → Upload. The server validates it and keeps the valid records. */
function UploadDialog({ onClose }) {
  const { uploadDataset, notify } = useStore();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputId = "sales-file-input";

  const choose = (selected) => {
    if (!selected) return;
    setError("");
    if (selected.size === 0) {
      setFile(null);
      return setError("The selected file is empty.");
    }
    setFile(selected);
  };

  /** POST /datasets — the server validates the file and saves its valid records for cleaning. */
  const upload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    const result = await uploadDataset(file);
    setUploading(false);
    if (!result.ok) return setError(result.error.message);
    const { valid, total, combined } = result.data.validation;
    const excluded = total - valid - combined;
    const added = result.data.dataset.newProducts.length;
    notify(
      `${plural(valid, "record")} uploaded${added ? ` · ${plural(added, "new product")}` : ""}${excluded ? ` · ${plural(excluded, "row")} excluded` : ""}.`,
      5000,
    );
    onClose();
  };

  return (
    <Modal title="Upload sales data" onClose={uploading ? () => {} : onClose} width="wide">
      <div className="modal-body upload-dialog">
        <input id={inputId} className="file-input" type="file" accept={ACCEPT} onChange={(e) => choose(e.target.files?.[0])} />
        <label
          htmlFor={inputId}
          className={`dropzone ${file ? "has-file" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
        >
          {file ? (
            <>
              <div className="file-icon">
                <Icon name="report" />
              </div>
              <div>
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB</span>
              </div>
              <Status value="Selected" />
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove file"
                disabled={uploading}
                onClick={(e) => {
                  e.preventDefault();
                  setFile(null);
                }}
              >
                <Icon name="close" />
              </button>
            </>
          ) : (
            <>
              <div className="upload-icon">
                <Icon name="upload" size={24} />
              </div>
              <strong>Drop your sales file here</strong>
              <span className="btn btn-secondary">Browse files</span>
              <small>CSV, text or Excel · any columns</small>
            </>
          )}
        </label>
        {error && (
          <div className="form-error no-margin" role="alert">
            <Icon name="warning" size={16} />
            {error}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" disabled={uploading} onClick={onClose}>
          Cancel
        </Button>
        <Button icon="upload" disabled={!file || uploading} onClick={upload}>
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </Modal>
  );
}

function CleaningQueueCard({ onClean }) {
  const { datasets, can } = useStore();
  // Oldest first, so uploads are merged in the order they arrived and the sales history has no gaps
  const queue = datasets.filter((d) => d.cleaning === "Pending" && d.pendingCount > 0).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const canClean = can("Clean data");
  return (
    <Card>
      <CardHeader title="Waiting for cleaning" action={<Status value={queue.length ? `${queue.length} pending` : "Completed"} />} />
      {queue.length ? (
        <div className="queue-list">
          {queue.map((d) => (
            <div key={d.id} className="file-summary">
              <div className="file-icon">
                <Icon name="report" />
              </div>
              <div>
                <strong>{d.fileName}</strong>
                <span>
                  {d.recordCount.toLocaleString()} records · {d.uploader} · {formatDateTime(d.uploadedAt)}
                </span>
              </div>
              <Status value={d.validation} />
              <Button icon="clean" onClick={() => onClean(d)} disabled={!canClean} title={canClean ? undefined : "View only"}>
                Clean
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState inline icon="check" title="All uploads are cleaned" />
      )}
    </Card>
  );
}

const ACTIONS = ["Uploaded", "Failed"];
const FORECAST_STATUSES = ["Forecasted", "Not Forecasted"];

export default function SalesUploadPage() {
  const { datasets, can, level } = useStore();
  const [search, setSearch] = useState("");
  const [actions, setActions] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [cleaningId, setCleaningId] = useState(null);
  const canUpload = can("Upload sales");
  // Data Analysts clean; the Admin sees the queue with Clean switched off
  const seesCleaning = level("Clean data") !== "No";

  // One row per upload attempt (GET /datasets, newest first)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return datasets.filter((d) => {
      const text = [d.fileName, formatDateTime(d.uploadedAt), d.uploader, actionOf(d), forecastStatusOf(d)].join(" ").toLowerCase();
      return (!q || text.includes(q)) && (!actions.length || actions.includes(actionOf(d))) && (!statuses.length || statuses.includes(forecastStatusOf(d)));
    });
  }, [datasets, search, actions, statuses]);
  // As many rows as fit down to the bottom of the screen, then pagination
  const [historyTable, pageSize] = useFitRows({ min: 5 });
  const pageData = paginate(visible, page, pageSize);
  const selected = datasets.find((d) => d.id === selectedId) ?? null;
  const cleaning = datasets.find((d) => d.id === cleaningId) ?? null;
  const resetPage = (fn) => (value) => {
    fn(value);
    setPage(1);
  };

  return (
    <div className="page-stack sales-data-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DATA MANAGEMENT</span>
          <h1>Sales Data</h1>
        </div>
        <div className="heading-actions">
          <Button icon="upload" disabled={!canUpload} title={canUpload ? undefined : "View only"} onClick={() => setUploadOpen(true)}>
            Upload sales data
          </Button>
        </div>
      </div>
      {seesCleaning && <CleaningQueueCard onClean={(d) => setCleaningId(d.id)} />}
      <Card className="dataset-history-card">
        <CardHeader title="Dataset history" />
        <div className="history-filters">
          <SearchBox value={search} onChange={resetPage(setSearch)} placeholder="Search datasets or users" />
          <MultiSelect ariaLabel="Action" allLabel="All actions" options={ACTIONS} value={actions} onChange={resetPage(setActions)} />
          <MultiSelect ariaLabel="Status" allLabel="All statuses" options={FORECAST_STATUSES} value={statuses} onChange={resetPage(setStatuses)} />
        </div>
        <div className="table-wrap">
          <table ref={historyTable}>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Date & Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageData.rows.map((d) => (
                <tr key={d.id} className="clickable-row" onClick={() => setSelectedId(d.id)} title="View dataset details">
                  <td>
                    <button className="table-link" onClick={() => setSelectedId(d.id)}>
                      {d.fileName}
                    </button>
                  </td>
                  <td>{formatDateTime(d.uploadedAt)}</td>
                  <td>{d.uploader}</td>
                  <td>
                    <Status value={actionOf(d)} />
                  </td>
                  <td>
                    <Status value={forecastStatusOf(d)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <EmptyState inline title="No datasets found" detail="Try a different search, action or status." />}
        </div>
        <TableFooter label={pageData.label} page={pageData.page} pageCount={pageData.pageCount} onPage={setPage} />
      </Card>

      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
      {selected && (
        <DatasetDetailsModal
          dataset={selected}
          onClose={() => setSelectedId(null)}
          onClean={() => {
            setSelectedId(null);
            setCleaningId(selected.id);
          }}
        />
      )}
      {cleaning && <CleanDatasetModal dataset={cleaning} onClose={() => setCleaningId(null)} />}
    </div>
  );
}
