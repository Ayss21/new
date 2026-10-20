// Reports & Exports: role-authorised reports as PDF, Excel (XLSX) or CSV, plus the report history.
// API: POST /reports + polling + GET /reports/{id}/file (through the store), POST /reports/email
// (reportService), GET /reports (the history, loaded by the store).
import { useMemo, useState } from "react";
import { ALL_REPORTS, EXPORT_FORMATS, REPORTS_BY_ROLE } from "../data/seed";
import { describeFilters } from "../lib/domain";
import { formatDateTime, formatRange } from "../lib/format";
import { ROLE, roleName } from "../lib/roles";
import { settle } from "../services/api";
import { reportService } from "../services/reportService";
import { useStore } from "../store/AppStore";
import { Button, Card, CardHeader, EmptyState, Field, Icon, Modal, MultiSelect, SearchBox, Select, Status, TableFooter, paginate, useFitRows } from "../components/ui";

const REPORT_STATUSES = ["Completed", "Processing", "Failed"];

export default function ReportsPage() {
  const { currentUser, appliedFilters: filters, exports, notify, can, generateReport, downloadReport, refresh } = useStore();
  const [format, setFormat] = useState("PDF");
  const [reportIndex, setReportIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState([]); // [] = all
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const roleId = currentUser?.roleId;
  const isAdmin = roleId === ROLE.ADMIN;
  // A role can open this screen without the "Generate reports" action: it then sees its history only.
  const canGenerate = can("Generate reports");
  const viewOnly = canGenerate ? undefined : "Your role can view report history but not generate reports.";

  const reports = ALL_REPORTS.filter((report) => (REPORTS_BY_ROLE[roleId] ?? []).includes(report[0]));
  const report = reports[Math.min(reportIndex, reports.length - 1)];

  // Admins see every report; everyone else sees the reports they generated.
  const history = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exports
      .filter((row) => isAdmin || row.userId === currentUser?.id)
      .filter((row) => !statuses.length || statuses.includes(row.status))
      .filter((row) => !q || [row.name, row.format, row.userName, formatDateTime(row.generatedAt), row.status].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }, [exports, isAdmin, currentUser, search, statuses]);
  const [historyTable, pageSize] = useFitRows({ min: 5 });
  const pageData = paginate(history, page, pageSize);

  if (!currentUser) return null;

  const activeFilters = describeFilters(filters);

  /** POST /reports, wait until it's ready, then download it. */
  const generate = async () => {
    if (!report || busy || !canGenerate) return;
    setBusy(true);
    setPage(1);
    const result = await generateReport(report[0], format);
    setBusy(false);
    if (result.ok) notify(`${format} file generated and downloaded.`);
    else notify(result.error.message, 4500, "error");
  };

  /** GET /reports/{id}/file — download a finished report again. */
  const download = async (row) => {
    setDownloadingId(row.id);
    const result = await downloadReport(row.id);
    setDownloadingId(null);
    if (!result.ok) notify(result.error.message, 4500, "error");
  };

  /** GET /reports */
  const reload = async () => {
    setRefreshing(true);
    setPage(1);
    await refresh(["reports"]);
    setRefreshing(false);
    notify("Report history refreshed.", 2500);
  };

  return (
    <div className="page-stack store-reports compact-reports">
      <div className="page-heading">
        <div>
          <h1>Reports & Exports</h1>
        </div>
      </div>
      <Card className="store-report-config">
        <CardHeader title="Configure report" subtitle={report ? report[1] : "Choose a report type and output format"} />
        <div className="report-config-row">
          <Field label="Report type">
            <Select value={String(reportIndex)} onChange={(value) => setReportIndex(Number(value))}>
              {reports.map((r, index) => (
                <option value={index} key={r[0]}>
                  {r[0]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Output format">
            <Select value={format} onChange={setFormat}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="export-buttons">
            <Button variant="secondary" icon="report" onClick={() => setEmailOpen(true)} disabled={!canGenerate} title={viewOnly}>
              Email report
            </Button>
            <Button icon="download" disabled={!report || busy || !canGenerate} onClick={generate} title={viewOnly}>
              {busy ? "Generating…" : "Generate report"}
            </Button>
          </div>
        </div>
        <div className="report-filter-note">
          <Icon name={viewOnly ? "shield" : "filter"} size={14} />
          <span>
            {viewOnly ?? (
              <>
                Filters: <strong>{formatRange(filters.startDate, filters.endDate)}</strong>
                {activeFilters && ` · ${activeFilters}`}
              </>
            )}
          </span>
        </div>
      </Card>
      <Card className="recent-exports-card">
        <CardHeader
          title="Report history"
          subtitle={isAdmin ? "All users" : "Your reports"}
          action={
            <div className="table-tools">
              <SearchBox
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                placeholder="Search reports"
              />
              <MultiSelect
                ariaLabel="Status"
                allLabel="All statuses"
                options={REPORT_STATUSES}
                value={statuses}
                onChange={(v) => {
                  setStatuses(v);
                  setPage(1);
                }}
              />
              <Button variant="secondary" icon="refresh" disabled={refreshing} onClick={reload}>
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          }
        />
        <div className="table-wrap">
          <table ref={historyTable}>
            <thead>
              <tr>
                <th>Report name</th>
                <th>Format</th>
                <th>Generated on</th>
                <th>Generated by</th>
                <th>Status</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {pageData.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.format}</td>
                  <td>{formatDateTime(row.generatedAt)}</td>
                  <td title={roleName(row.roleId)}>{row.userName}</td>
                  <td>
                    <Status value={row.status} />
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      icon="download"
                      disabled={row.status !== "Completed" || downloadingId === row.id}
                      title={row.status === "Failed" ? (row.error ?? "This report failed.") : undefined}
                      onClick={() => download(row)}
                    >
                      {downloadingId === row.id ? "Downloading…" : "Download"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length && <EmptyState inline title="No reports found" detail="Generate a report, or change the search or status filter." />}
        </div>
        <TableFooter label={pageData.label} page={pageData.page} pageCount={pageData.pageCount} onPage={setPage} />
      </Card>

      {emailOpen && report && <EmailReportDialog report={report[0]} format={format} filters={filters} onClose={() => setEmailOpen(false)} />}
    </div>
  );
}

/** "Email report" — POST /reports/email. The server builds the report and emails it. */
function EmailReportDialog({ report, format, filters, onClose }) {
  const { notify } = useStore();
  const [recipients, setRecipients] = useState("");
  const [subject, setSubject] = useState(`DemandIQ ${report} · ${filters.endDate.slice(0, 7)}`);
  const [message, setMessage] = useState(`Please find the requested ${report.toLowerCase()} summary.`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const addresses = recipients.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

  const send = async () => {
    setSending(true);
    setError(null);
    const result = await settle(reportService.emailReport({ name: report, format, filters, recipients: addresses, subject, message }));
    setSending(false);
    if (!result.ok) return setError(result.error);
    notify(`${report} (${format}) queued for ${addresses.length} recipient${addresses.length === 1 ? "" : "s"}.`);
    onClose();
  };

  return (
    <Modal title="Email report" onClose={sending ? () => {} : onClose}>
      <div className="modal-body">
        <Field label="Recipients" error={error?.fields?.recipients} helper="Separate addresses with commas.">
          <input placeholder="name@company.com, name2@company.com" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
        </Field>
        <Field label="Subject" error={error?.fields?.subject}>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="file-summary">
          <div className="file-icon">
            <Icon name="report" />
          </div>
          <div>
            <strong>{report}</strong>
            <span>
              {format} · {formatRange(filters.startDate, filters.endDate)}
            </span>
          </div>
        </div>
        {error && !error.fields?.recipients && !error.fields?.subject && (
          <div className="form-error no-margin" role="alert">
            <Icon name="warning" size={16} />
            {error.message}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" disabled={sending} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!addresses.length || sending} onClick={send}>
          {sending ? "Sending…" : "Send report"}
        </Button>
      </div>
    </Modal>
  );
}
