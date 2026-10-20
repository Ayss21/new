// /activity, /sessions and /errors — the audit log, sign-in sessions and the error log (demo backend).
import { created, fail, invalid, logEvent, ok, requireAction, text } from "../http";
import { publicSession } from "../shapes";

/** Events the browser may record itself (everything else is logged by the server as it happens). */
const CLIENT_EVENTS = { "Screen access denied": "Authentication" };
const ERROR_STATUSES = ["Open", "Investigating", "Resolved"];

/** An error log entry as the API returns it (notes is null until someone adds one). */
const toApiError = (e) => ({ id: e.id, at: e.at, module: e.module, type: e.type, severity: e.severity, message: e.message, status: e.status, notes: e.notes ?? null });

/** GET /activity — newest first */
export function list(req) {
  requireAction(req, "View system logs");
  return ok(req.db.activity);
}

/** POST /activity { action, details } — an event only the browser sees, e.g. a refused screen address */
export function record(req) {
  const { action, details = "" } = req.body ?? {};
  invalid({ action: !CLIENT_EVENTS[action] && `Only these events can be sent: ${Object.keys(CLIENT_EVENTS).join(", ")}.` });
  logEvent(req, action, CLIENT_EVENTS[action], "Failed", text(details).slice(0, 200));
  return created(req.db.activity[0]);
}

/** GET /sessions — sign-in sessions (login, logout) */
export function sessions(req) {
  requireAction(req, "View system logs");
  return ok(req.db.sessions.map(publicSession));
}

/** GET /errors — newest first */
export function errors(req) {
  requireAction(req, "View system logs");
  return ok(req.db.errors.map(toApiError));
}

/** PATCH /errors/{id} { status: "Open" | "Investigating" | "Resolved", notes? } */
export function updateError(req) {
  requireAction(req, "View system logs");
  const error = req.db.errors.find((e) => e.id === req.params.id);
  if (!error) fail(404, "not_found", "That error no longer exists.");
  const { status, notes = "" } = req.body ?? {};
  invalid({ status: !ERROR_STATUSES.includes(status) && `Use one of: ${ERROR_STATUSES.join(", ")}.` });
  error.status = status;
  if (text(notes)) error.notes = text(notes).slice(0, 1000);
  logEvent(req, "Error status updated", "Admin Panel", "Completed", `${error.id} marked ${status.toLowerCase()}`);
  return ok(toApiError(error));
}
