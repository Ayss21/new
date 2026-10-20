// Helpers for the demo backend's routes: results, errors in FastAPI's shape, permission checks and the
// audit log. A FastAPI implementation would use HTTPException(status_code, detail={...}) and
// dependencies for the same checks.
import { PERMISSION_SCREEN } from "../../data/seed";
import { ADMIN_VIEW_ONLY } from "../../lib/permissions";
import { ROLE, roleName } from "../../lib/roles";
import { screenIdsFor } from "../../navigation";
import { nextId } from "./db";

/** An error response: { "detail": { "code", "message", ...extra } } with the HTTP status. */
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function fail(status, code, message, extra) {
  throw new HttpError(status, code, message, extra);
}

/** 422 with field messages: { detail: { code: "validation_error", message, fields: { name: message } } } */
export function invalid(fields) {
  const entries = Object.entries(fields).filter(([, message]) => message);
  if (entries.length) fail(422, "validation_error", entries[0][1], { fields: Object.fromEntries(entries) });
}

export const ok = (json, status = 200) => ({ status, json });
export const created = (json) => ({ status: 201, json });
export const accepted = (json) => ({ status: 202, json });
export const noContent = () => ({ status: 204 });
export const file = (blob, fileName, contentType) => ({ status: 200, blob, fileName, contentType });

const nowIso = () => new Date().toISOString();
export { nowIso as now };

const ACTION_TEXT = {
  "Upload sales": "upload sales data",
  "Clean data": "clean datasets",
  "Run forecasts": "run forecasts",
  "Update inventory": "update stock or reorders",
  "Generate reports": "generate reports",
  "Manage users": "manage users, categories and permissions",
  "View system logs": "view system logs",
};

/**
 * A role's level for an action: "Yes" | "View" | "Review" | "No". An action is carried out on one screen
 * (PERMISSION_SCREEN), so a role that can't open that screen has "No", whatever the matrix says.
 * The Admin is always view-only on Sales Data, Inventory and Forecasting (ADMIN_VIEW_ONLY).
 */
export function effectiveLevel(db, roleId, action) {
  const level = (roleId === ROLE.ADMIN && ADMIN_VIEW_ONLY[action]) || (db.permissions[action]?.[roleId] ?? "No");
  const screen = PERMISSION_SCREEN[action];
  return screen && !screenIdsFor(db.screenAccess, roleId).includes(screen) ? "No" : level;
}

/** The signed-in user's level for an action. */
export function levelOf(req, action) {
  return effectiveLevel(req.db, req.user.roleId, action);
}

/** 403 unless the signed-in user's role has the action ("Yes"). */
export function requireAction(req, action) {
  if (levelOf(req, action) !== "Yes")
    fail(403, "forbidden", `The ${roleName(req.user.roleId)} role isn't allowed to ${ACTION_TEXT[action] ?? action.toLowerCase()}.`);
}

/** 403 when the signed-in user's role has no access at all to an action ("No"); "View" or "Review" is enough. */
export function requireView(req, action) {
  if (levelOf(req, action) === "No")
    fail(403, "forbidden", `The ${roleName(req.user.roleId)} role has no access to ${action.toLowerCase()}.`);
}

/** Adds a row to the activity log (server-side audit). `who` defaults to the signed-in user. */
export function logEvent(req, action, module, status = "Completed", details = "", who = req.user) {
  req.changed = true;
  req.db.activity.unshift({
    id: nextId("EVT"),
    at: nowIso(),
    sessionId: req.session?.id ?? null,
    userId: who?.id ?? null,
    userName: who?.name ?? "Unknown",
    roleId: who?.roleId ?? null,
    action,
    module,
    details,
    status,
  });
}

/** Adds a row to the error log (status Open). */
export function logError(req, module, type, severity, message) {
  req.changed = true;
  req.db.errors.unshift({ id: nextId("ERR"), at: nowIso(), module, type, severity, message, status: "Open" });
}

/** A JSON body field that must be a non-empty string. */
export const text = (value) => (typeof value === "string" ? value.trim() : "");

/** "Store Manager", or "role 9" for an unknown ID. */
export const roleLabel = (roleId) => roleName(roleId);
