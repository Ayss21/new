// Report export from the dashboards and modules ("Export …" buttons).
// POST /reports → the report appears in the history as Processing → the app polls until it is Completed
// → GET /reports/{id}/file downloads it (all through the store's generateReport).
import { useState } from "react";
import { EXPORT_FORMATS } from "../../data/seed";
import { describeFilters } from "../../lib/domain";
import { formatRange } from "../../lib/format";
import { useStore } from "../../store/AppStore";
import { Button, Field, Icon, Modal, ProgressState, Select } from "../ui";

/** Confirm dialog used by the "Export …" buttons on dashboards and modules. */
export function ExportModal({ reportName, requestedFormat, onClose }) {
  const { appliedFilters: filters, generateReport, notify } = useStore();
  const [format, setFormat] = useState(requestedFormat);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const exportReport = async () => {
    setGenerating(true);
    setError("");
    const result = await generateReport(reportName, format);
    if (result.ok) {
      notify(`${format} file generated and downloaded.`);
      onClose();
      return;
    }
    setGenerating(false);
    setError(result.error.message);
  };

  const activeFilters = describeFilters(filters) || "None";

  return (
    <Modal title="Confirm report export" onClose={generating ? () => {} : onClose}>
      <div className="modal-body">
        {generating ? (
          <ProgressState title={`Generating ${format} report`} detail="It downloads when it's ready…" />
        ) : (
          <>
            <div className="summary-list">
              <div>
                <span>Report</span>
                <strong>{reportName}</strong>
              </div>
              <div>
                <span>Date range</span>
                <strong>{formatRange(filters.startDate, filters.endDate)}</strong>
              </div>
              <div>
                <span>Active filters</span>
                <strong>{activeFilters}</strong>
              </div>
            </div>
            <Field label="File format">
              <Select value={format} onChange={(value) => setFormat(value)}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            {error && (
              <div className="form-error no-margin" role="alert">
                <Icon name="warning" size={16} />
                {error}
              </div>
            )}
          </>
        )}
      </div>
      {!generating && (
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={exportReport}>{error ? "Try again" : "Confirm download"}</Button>
        </div>
      )}
    </Modal>
  );
}
