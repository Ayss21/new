// Report generation (PDF, XLSX, CSV), report history and downloads.
// A report is generated in the background: POST returns it as Processing; the app polls
// GET /reports/{id} until it is Completed (then downloads the file) or Failed.
import { api } from "./api";
import { filterQuery, segment } from "./query";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const reportService = {
  /** GET /reports → the signed-in user's reports (Admin: everyone's), newest first */
  getReports: () => api.get("/reports"),

  /** POST /reports { name, format, filters } → 202 report (status Processing) */
  generateReport: ({ name, format, filters }) => api.post("/reports", { name, format, filters: filterQuery(filters) }),

  /** GET /reports/{id} → the report and its status */
  getReport: (id) => api.get(`/reports/${segment(id)}`),

  /** GET /reports/{id}/file → { blob, fileName } */
  downloadReport: (id) => api.download(`/reports/${segment(id)}/file`),

  /**
   * POST /reports/email { name, format, filters, recipients, subject, message } → 202 { id, status: "Queued", recipients }
   * The server generates the report and emails it.
   */
  emailReport: ({ name, format, filters, recipients, subject, message }) =>
    api.post("/reports/email", { name, format, filters: filterQuery(filters), recipients, subject, message }),

  /** Polls GET /reports/{id} until it is no longer Processing. Resolves to the report. */
  async waitForReport(id, { interval = 500, timeout = 60000 } = {}) {
    const started = Date.now();
    for (;;) {
      const report = await this.getReport(id);
      if (report.status !== "Processing") return report;
      if (Date.now() - started > timeout) throw new Error("The report is taking longer than expected. Check the report history later.");
      await sleep(interval);
    }
  },
};
