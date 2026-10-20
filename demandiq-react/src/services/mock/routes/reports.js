// /reports — generate a report in the background, list them, download the file (demo backend).
// A new report starts as Processing; after a moment it becomes Completed (the file can be downloaded)
// or Failed (for example when no data matches the filters). The app polls GET /reports/{id}.
import { ALL_REPORTS, REPORTS_BY_ROLE } from "../../../data/seed";
import { buildReportFile } from "../../../lib/exporters";
import { buildReportRows, reportMetadata } from "../../../lib/reports";
import { ROLE, roleName } from "../../../lib/roles";
import { db, nextId, save, whenLoaded } from "../db";
import { accepted, fail, file, invalid, logError, logEvent, now, ok, requireAction } from "../http";
import { apiDatasets, filtersFromQuery } from "../shapes";

const FORMATS = ["PDF", "XLSX", "CSV"];
let processingMs = 900;
const ready = new Map(); // report id → { rows, filters } for reports finished since the page loaded

/** Tests only: how long a report stays Processing. */
export function setReportDelay(ms) {
  processingMs = ms;
}

const reportData = (data) => ({
  sales: data.sales,
  inventory: data.inventory,
  forecasts: data.forecasts,
  activity: data.activity,
  errors: data.errors,
  reorders: data.reorders,
  datasets: apiDatasets(data), // with each upload's lineage and forecasting status
});

function findReport(req) {
  const report = req.db.reports.find((r) => r.id === req.params.id);
  if (!report || (req.user.roleId !== ROLE.ADMIN && report.userId !== req.user.id)) fail(404, "not_found", "That report doesn't exist.");
  return report;
}

/** GET /reports — Admin sees every report, everyone else their own */
export function list(req) {
  return ok(req.db.reports.filter((r) => req.user.roleId === ROLE.ADMIN || r.userId === req.user.id));
}

/** GET /reports/{id} */
export function get(req) {
  return ok(findReport(req));
}

/** POST /reports { name, format, filters: { start, end, category: [], sku: [], region: [], model: [] } } (empty list = all) */
export function create(req) {
  requireAction(req, "Generate reports");
  const { name, format, filters = {} } = req.body ?? {};
  invalid({
    name: !ALL_REPORTS.some((report) => report[0] === name) && "Choose a report type.",
    format: !FORMATS.includes(format) && "Use PDF, XLSX or CSV.",
  });
  if (!(REPORTS_BY_ROLE[req.user.roleId] ?? []).includes(name))
    fail(403, "report_not_allowed", `The ${roleName(req.user.roleId)} role can't generate the ${name}.`);
  const applied = filtersFromQuery(filters, req.db.sales);
  const report = {
    id: nextId("RPT"),
    name,
    format,
    generatedAt: now(),
    userId: req.user.id,
    userName: req.user.name,
    roleId: req.user.roleId,
    status: "Processing",
    filters,
    error: null,
  };
  req.db.reports.unshift(report);
  const { user, session } = req;
  setTimeout(async () => {
    await whenLoaded(); // another tab may have saved meanwhile
    const data = db();
    const saved = data.reports.find((r) => r.id === report.id);
    if (!saved) return;
    const rows = buildReportRows(reportData(data), applied, saved.name);
    const context = { db: data, user, session };
    if (rows.length) {
      saved.status = "Completed";
      ready.set(saved.id, { rows, filters: applied });
      logEvent(context, `${saved.name} exported`, "Reports & Exports", "Completed", saved.format);
    } else {
      saved.status = "Failed";
      saved.error = "There is no matching data to export.";
      logEvent(context, `${saved.name} export failed`, "Reports & Exports", "Failed", `${saved.format} · ${saved.error}`);
      logError(context, "Reports & Exports", "Export failure", "Warning", `${saved.name}: ${saved.error}`);
    }
    save();
  }, processingMs);
  return accepted(report);
}

/** GET /reports/{id}/file — the PDF, XLSX or CSV file */
export async function download(req) {
  const report = findReport(req);
  if (report.status === "Processing") fail(409, "report_processing", "The report is still being generated.");
  if (report.status === "Failed") fail(409, "report_failed", report.error ?? "The report failed.");
  const cached = ready.get(report.id);
  const filters = cached?.filters ?? filtersFromQuery(report.filters ?? {}, req.db.sales);
  const rows = cached?.rows ?? buildReportRows(reportData(req.db), filters, report.name);
  if (!rows.length) fail(409, "report_failed", "There is no matching data to export.");
  const owner = req.db.users.find((u) => u.id === report.userId) ?? { name: report.userName, roleId: report.roleId };
  const built = await buildReportFile(report.format, rows, report.name, reportMetadata(filters, owner));
  return file(built.blob, built.fileName, built.contentType);
}

/** POST /reports/email { name, format, filters, recipients, subject, message } — the demo backend doesn't send email */
export function email(req) {
  requireAction(req, "Generate reports");
  const { name, format, filters = {}, recipients, subject = "", message = "" } = req.body ?? {};
  invalid({
    name: !ALL_REPORTS.some((report) => report[0] === name) && "Choose a report type.",
    format: !FORMATS.includes(format) && "Use PDF, XLSX or CSV.",
    recipients:
      (!Array.isArray(recipients) || !recipients.length || recipients.length > 20) ? "Enter between 1 and 20 email addresses." :
      recipients.some((address) => !/^\S+@\S+\.\S+$/.test(String(address))) && "One of the email addresses is not valid.",
    subject: String(subject).length > 200 && "Keep the subject under 200 characters.",
  });
  if (!(REPORTS_BY_ROLE[req.user.roleId] ?? []).includes(name))
    fail(403, "report_not_allowed", `The ${roleName(req.user.roleId)} role can't generate the ${name}.`);
  filtersFromQuery(filters, req.db.sales); // checks the dates
  const id = nextId("MAIL");
  logEvent(req, "Report emailed", "Reports & Exports", "Pending", `${name} · ${format} → ${recipients.join(", ")}${message ? " (with a message)" : ""}`);
  return accepted({ id, status: "Queued", recipients, name, format });
}
