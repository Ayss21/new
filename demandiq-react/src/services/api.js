// HTTP client for the DemandIQ FastAPI backend. Every service file (authService.js, salesService.js …)
// calls the backend through this client:
//
//   api.get(path, { query })   api.post(path, body)   api.put(path, body)   api.patch(path, body)
//   api.delete(path)           api.download(path, { query }) → { blob, fileName }
//
// Two modes, chosen in .env (see .env.example):
//   VITE_API_MODE=demo  (default) The requests are answered by the demo backend that runs in the browser
//                       (src/services/mock). It follows the same contract (docs/API_CONTRACT.md), so the
//                       app works before FastAPI exists.
//   VITE_API_MODE=live  The requests go to FastAPI at VITE_API_URL (default /api, which vite.config.js
//                       forwards to http://localhost:8000).
// Pages, the store and the services are the same in both modes.
//
// What the client takes care of:
//   • the sign-in token: sent as "Authorization: Bearer <token>", kept across page loads (tokenStore.js)
//   • JSON bodies, file uploads (FormData → multipart/form-data) and file downloads (PDF, XLSX, CSV)
//   • query strings, e.g. { start: "2025-03-19", sku: "PP-4012" } → ?start=2025-03-19&sku=PP-4012
//   • errors: every failure becomes an ApiError with a readable message, the HTTP status, a code and,
//     for forms, field messages. FastAPI's own validation errors (422, detail = [...]) are understood too.
//   • a 401 on a signed-in request (expired or revoked session) signs the user out (see AppStore.jsx)
//   • the backend being down or too slow: status 0, or 502 / 503 / 504 from a proxy (see isUnreachable)

import { tokenStore } from "./tokenStore";

const env = import.meta.env ?? {};

/** "demo" or "live" (see above). */
export const API_MODE = env.VITE_API_MODE === "live" ? "live" : "demo";

const settings = {
  mode: API_MODE,
  baseUrl: String(env.VITE_API_URL ?? "/api").replace(/\/+$/, ""),
  latency: Number(env.VITE_DEMO_LATENCY_MS ?? 250), // demo mode: pretend network delay, in ms
  timeoutMs: 30000, // live mode: give up after 30 s
  fetch: (...args) => globalThis.fetch(...args),
};

let unauthorizedHandler = null;

export class ApiError extends Error {
  /**
   * status  HTTP status, or 0 when the server could not be reached
   * code    machine-readable reason sent by the server, e.g. "invalid_credentials"
   * fields  { fieldName: message } for form errors
   * details whatever else the server sent (e.g. the validation summary of a rejected upload)
   */
  constructor(status, message, { code = null, fields = {}, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

const STATUS_MESSAGES = {
  400: "The request was not valid.",
  401: "Please sign in again.",
  403: "Your role isn't allowed to do this.",
  404: "That item no longer exists.",
  409: "That change conflicts with the current data. Refresh and try again.",
  413: "The file is too large.",
  422: "Some of the values are not valid.",
  429: "Too many requests. Wait a moment and try again.",
  500: "The server had a problem. Try again in a moment.",
  502: "Can't reach the DemandIQ server. Check that the backend is running and try again.",
  503: "The server is not available right now. Try again in a moment.",
  504: "The server took too long to answer. Try again.",
};

/** Answers from a proxy in front of a backend that is down or not answering (Vite's dev proxy sends 502). */
const UNAVAILABLE = [502, 503, 504];

/**
 * True when the server couldn't be reached or isn't answering: no response at all (status 0), or a proxy's
 * 502 / 503 / 504. The app then keeps the saved sign-in and offers "Try again" instead of signing out.
 */
export const isUnreachable = (error) => error?.status === 0 || UNAVAILABLE.includes(error?.status);

/** "?start=2025-03-19&sku=PP-4012" — empty, null and undefined values are left out. */
export function toQuery(query) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The file name from a Content-Disposition header. */
function fileNameOf(response, fallback = "download") {
  const header = response.headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded) return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

/** Turns an error response into an ApiError. Understands FastAPI's detail string, detail object and 422 list. */
export async function toApiError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* not JSON */
  }
  const detail = body?.detail;
  if (Array.isArray(detail)) {
    // FastAPI request validation: [{ loc: ["body", "horizon"], msg: "Input should be ...", type }]
    const fields = {};
    for (const item of detail) {
      const name = (item.loc ?? []).filter((part) => !["body", "query", "path"].includes(part)).join(".") || "request";
      fields[name] ??= item.msg;
    }
    const [first] = Object.entries(fields);
    return new ApiError(response.status, first ? `${first[0]}: ${first[1]}` : STATUS_MESSAGES[422], {
      code: "validation_error",
      fields,
      details: detail,
    });
  }
  if (detail && typeof detail === "object")
    return new ApiError(response.status, detail.message ?? STATUS_MESSAGES[response.status] ?? `Request failed (${response.status}).`, {
      code: detail.code ?? null,
      fields: detail.fields ?? {},
      details: detail,
    });
  if (typeof detail === "string") return new ApiError(response.status, detail);
  return new ApiError(response.status, STATUS_MESSAGES[response.status] ?? `Request failed (${response.status}).`, {
    code: UNAVAILABLE.includes(response.status) ? "server_unavailable" : null,
  });
}

/** Sends one request through the active transport and returns a Response. */
async function send({ method, path, query, headers, body }) {
  if (settings.mode === "live") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      return await settings.fetch(`${settings.baseUrl}${path}${toQuery(query)}`, { method, headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  const { handleDemoRequest } = await import("./mock/server.js");
  if (settings.latency > 0) await new Promise((resolve) => setTimeout(resolve, settings.latency));
  return handleDemoRequest({ method, path, query: query ?? {}, headers, body });
}

async function request(method, path, { query, body, responseType = "json" } = {}) {
  const token = tokenStore.get();
  const headers = { Accept: responseType === "json" ? "application/json" : "*/*" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (typeof FormData !== "undefined" && body instanceof FormData) payload = body; // the browser sets the multipart header
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await send({ method, path, query, headers, body: payload });
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(0, "The server took too long to answer. Try again.", { code: "timeout" });
    throw new ApiError(
      0,
      settings.mode === "live"
        ? "Can't reach the DemandIQ server. Check that the backend is running and try again."
        : `The demo backend failed: ${error?.message ?? "unknown error"}`,
      { code: "network_error" },
    );
  }

  if (!response.ok) {
    const error = await toApiError(response);
    // A signed-in request was refused because the session ended (expired, signed out elsewhere,
    // account deactivated, role changed): let the app sign out and say why.
    if (response.status === 401 && token && unauthorizedHandler) unauthorizedHandler(error);
    throw error;
  }
  if (response.status === 204) return null;
  if (responseType === "file") return { blob: await response.blob(), fileName: fileNameOf(response) };
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  get: (path, { query } = {}) => request("GET", path, { query }),
  post: (path, body, { query } = {}) => request("POST", path, { body, query }),
  put: (path, body) => request("PUT", path, { body }),
  patch: (path, body) => request("PATCH", path, { body }),
  delete: (path) => request("DELETE", path),
  /** Downloads a file (PDF, XLSX, CSV): resolves to { blob, fileName }. */
  download: (path, { query } = {}) => request("GET", path, { query, responseType: "file" }),
};

/** Called with the ApiError when a signed-in request gets 401 (the store signs the user out). */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/**
 * Runs a request and returns { ok: true, data } or { ok: false, error } instead of throwing,
 * so a page can show the error without try / catch. Programming errors become an ApiError too.
 */
export async function settle(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error : new ApiError(-1, error?.message ?? "Something went wrong.", { code: "client_error" }),
    };
  }
}

/** Tests only: change the mode, base URL, demo latency or fetch function. */
export function configureApi(overrides) {
  Object.assign(settings, overrides);
}
