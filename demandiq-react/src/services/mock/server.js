// The demo backend: answers the app's API requests inside the browser while FastAPI doesn't exist yet.
// It implements docs/API_CONTRACT.md — the same paths, JSON, status codes, errors and permission checks —
// so the app behaves the same against it as against the real server. Only used when VITE_API_MODE is
// not "live" (see src/services/api.js).
//
// The route table below is also a quick map of the whole API.
import { db, save, whenLoaded } from "./db";
import { HttpError } from "./http";
import * as activity from "./routes/activity";
import * as admin from "./routes/admin";
import * as auth from "./routes/auth";
import * as dashboard from "./routes/dashboard";
import * as demo from "./routes/demo";
import * as forecasts from "./routes/forecasts";
import * as inventory from "./routes/inventory";
import * as reports from "./routes/reports";
import * as sales from "./routes/sales";

const PUBLIC = { public: true };

const ROUTES = [
  // Authentication
  ["POST", "/auth/login", auth.login, PUBLIC],
  ["GET", "/auth/me", auth.me],
  ["POST", "/auth/logout", auth.logout],
  ["GET", "/auth/roles", auth.roles, PUBLIC],
  ["POST", "/auth/password-reset", auth.passwordReset, PUBLIC],
  // Dashboard
  ["GET", "/dashboard/summary", dashboard.summary],
  // Sales data
  ["GET", "/sales", sales.list],
  ["GET", "/datasets", sales.datasets],
  ["POST", "/datasets", sales.upload],
  ["POST", "/datasets/:id/clean", sales.clean],
  // Forecasting
  ["GET", "/forecasts", forecasts.list],
  ["POST", "/forecasts", forecasts.run],
  ["POST", "/forecasts/compare", forecasts.compare],
  ["POST", "/forecasts/recommendation", forecasts.recommendation],
  ["GET", "/forecasts/lineage", forecasts.lineage], // before /forecasts/:id, which would match it too
  ["GET", "/forecasts/:id", forecasts.get],
  // Inventory and reorders
  ["GET", "/inventory", inventory.list],
  ["GET", "/inventory/alerts", inventory.alerts],
  ["GET", "/inventory/snapshots", inventory.snapshots],
  ["PATCH", "/inventory/:sku", inventory.update],
  ["GET", "/reorders", inventory.reorders],
  ["POST", "/reorders", inventory.createReorder],
  ["PATCH", "/reorders/:id", inventory.updateReorder],
  // Administration
  ["GET", "/users", admin.users],
  ["POST", "/users", admin.createUser],
  ["PATCH", "/users/:id", admin.updateUser],
  ["GET", "/categories", admin.categories],
  ["POST", "/categories", admin.createCategory],
  ["PATCH", "/categories/:id", admin.updateCategory],
  ["GET", "/roles/permissions", admin.permissions],
  ["PATCH", "/roles/permissions", admin.updatePermission],
  ["GET", "/roles/screens", admin.screens],
  ["PUT", "/roles/:roleId/screens", admin.updateScreens],
  ["POST", "/roles/restore-defaults", admin.restoreDefaults],
  // Reports
  ["GET", "/reports", reports.list],
  ["POST", "/reports", reports.create],
  ["POST", "/reports/email", reports.email],
  ["GET", "/reports/:id", reports.get],
  ["GET", "/reports/:id/file", reports.download],
  // Activity, sessions and errors
  ["GET", "/activity", activity.list],
  ["POST", "/activity", activity.record],
  ["GET", "/sessions", activity.sessions],
  ["GET", "/errors", activity.errors],
  ["PATCH", "/errors/:id", activity.updateError],
  // Demo backend only (not part of the FastAPI contract)
  ["GET", "/demo/accounts", demo.accounts, PUBLIC],
  ["POST", "/demo/reset", demo.reset, PUBLIC],
].map(([method, pattern, handler, options = {}]) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => (keys.push(key), "([^/]+)"))}$`);
  return { method, pattern, regex, keys, handler, public: Boolean(options.public) };
});

/** The route for a request, with its path parameters ({ id } …). */
function match(method, path) {
  const candidates = ROUTES.filter((route) => route.regex.test(path));
  if (!candidates.length) return { status: 404 };
  const route = candidates.find((r) => r.method === method);
  if (!route) return { status: 405 };
  const values = route.regex.exec(path).slice(1);
  return { route, params: Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(values[i])])) };
}

function errorBody(code, message, extra = {}) {
  return { detail: { code, message, ...extra } };
}

function toResponse(result) {
  if (result.blob)
    return new Response(result.blob, {
      status: result.status,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
      },
    });
  if (result.status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(result.json), { status: result.status, headers: { "Content-Type": "application/json" } });
}

/**
 * Handles one request: { method, path, query, headers, body } → a Response.
 * body is the JSON text the app sent, a FormData (uploads) or undefined.
 */
export async function handleDemoRequest({ method, path, query = {}, headers = {}, body }) {
  await whenLoaded();
  const found = match(method, path);
  if (!found.route)
    return toResponse({
      status: found.status,
      json: errorBody(found.status === 405 ? "method_not_allowed" : "not_found", `${method} ${path} is not part of the API.`),
    });

  const req = { method, path, query, headers, params: found.params, db: db(), body: undefined, changed: false };
  try {
    if (typeof body === "string") {
      try {
        req.body = body ? JSON.parse(body) : undefined;
      } catch {
        throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
      }
    } else req.body = body;
    if (!found.route.public) Object.assign(req, auth.authenticate(req));
    const result = await found.route.handler(req);
    if (method !== "GET" || req.changed) save();
    return toResponse(result);
  } catch (error) {
    if (req.changed) save();
    if (error instanceof HttpError) return toResponse({ status: error.status, json: errorBody(error.code, error.message, error.extra) });
    console.error("Demo backend error", error);
    return toResponse({ status: 500, json: errorBody("server_error", `The demo backend had a problem: ${error?.message ?? error}`) });
  }
}

/** Every route (method and path) — used by the contract tests. */
export const ROUTE_LIST = ROUTES.map(({ method, pattern, public: isPublic }) => ({ method, pattern, public: isPublic }));
