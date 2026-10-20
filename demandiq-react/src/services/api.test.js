// The HTTP client in live mode (FastAPI), with fetch replaced by a fake server, and the token storage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, configureApi, isUnreachable, onUnauthorized, settle, toApiError, toQuery } from "./api";
import { filterQuery } from "./query";
import { tokenStore } from "./tokenStore";

/** An in-memory Web Storage. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    has: (key) => map.has(key),
  };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let calls;
let answer;

beforeEach(() => {
  calls = [];
  answer = () => json({ ok: true });
  tokenStore.useStorages({ local: memoryStorage(), session: memoryStorage() });
  configureApi({
    mode: "live",
    baseUrl: "/api",
    timeoutMs: 30000,
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return answer(url, init);
    },
  });
});

afterEach(() => {
  onUnauthorized(null);
  tokenStore.useStorages(null);
  configureApi({ mode: "demo", fetch: (...args) => globalThis.fetch(...args) });
});

describe("requests", () => {
  it("sends JSON with the saved token to the base URL", async () => {
    tokenStore.save("abc123", { remember: false });
    answer = () => json({ id: "FC-0001" }, 201);
    const result = await api.post("/forecasts", { sku: "PP-4012", horizon: 30 });
    expect(result).toEqual({ id: "FC-0001" });
    const [call] = calls;
    expect(call.url).toBe("/api/forecasts");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer abc123");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.body)).toEqual({ sku: "PP-4012", horizon: 30 });
  });

  it("sends no Authorization header when signed out", async () => {
    await api.get("/auth/roles");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("builds query strings and leaves out empty values", async () => {
    await api.get("/sales", { query: { start: "2025-03-19", end: "", sku: undefined, region: "Central", tags: ["a", "b"] } });
    expect(calls[0].url).toBe("/api/sales?start=2025-03-19&region=Central&tags=a&tags=b");
    expect(toQuery({})).toBe("");
    expect(toQuery(null)).toBe("");
  });

  it("turns the global filters into query parameters: lists repeat, empty lists and 'All …' values are left out", () => {
    expect(
      filterQuery({
        startDate: "2025-03-19",
        endDate: "2025-06-18",
        category: [],
        sku: ["PP-4012", "PE-7820"],
        region: "Central", // a single value from an older saved filter still works
        status: "All statuses",
        model: ["ARIMA"],
      }),
    ).toEqual({ start: "2025-03-19", end: "2025-06-18", sku: ["PP-4012", "PE-7820"], region: ["Central"], model: ["ARIMA"] });
    expect(toQuery(filterQuery({ startDate: "2025-03-19", endDate: "2025-06-18", category: ["Polymers", "Chemicals"] }))).toBe(
      "?start=2025-03-19&end=2025-06-18&category=Polymers&category=Chemicals",
    );
  });

  it("sends uploads as multipart without setting Content-Type itself", async () => {
    const form = new FormData();
    form.append("file", new File(["Date,Product_ID,Units_Sold\n"], "sales.csv", { type: "text/csv" }));
    await api.post("/datasets", form);
    expect(calls[0].body).toBe(form);
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("returns null for 204 and for an empty body", async () => {
    answer = () => new Response(null, { status: 204 });
    expect(await api.post("/auth/logout")).toBeNull();
    answer = () => new Response("", { status: 200 });
    expect(await api.get("/anything")).toBeNull();
  });

  it("downloads files with the name from Content-Disposition", async () => {
    answer = () =>
      new Response(new Blob(["a,b\n"]), { status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="sales-summary.csv"' } });
    const file = await api.download("/reports/RPT-001/file");
    expect(file.fileName).toBe("sales-summary.csv");
    expect(await file.blob.text()).toBe("a,b\n");
    expect(calls[0].headers.Accept).toBe("*/*");

    answer = () =>
      new Response(new Blob(["x"]), { status: 200, headers: { "Content-Disposition": "attachment; filename*=UTF-8''sales%20by%20region.xlsx" } });
    expect((await api.download("/reports/RPT-002/file")).fileName).toBe("sales by region.xlsx");
  });
});

describe("errors", () => {
  it("reads the contract's error shape: code, message and field messages", async () => {
    answer = () =>
      json({ detail: { code: "validation_error", message: "Enter your password.", fields: { password: "Enter your password." } } }, 422);
    const { ok, error } = await settle(api.post("/auth/login", {}));
    expect(ok).toBe(false);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "validation_error", message: "Enter your password.", fields: { password: "Enter your password." } });
  });

  it("keeps extra error data in details (e.g. a rejected upload's validation counts)", async () => {
    answer = () => json({ detail: { code: "invalid_file", message: "The file is empty.", validation: { total: 0 } } }, 422);
    const { error } = await settle(api.post("/datasets", new FormData()));
    expect(error.details.validation).toEqual({ total: 0 });
  });

  it("understands FastAPI's own 422 validation list", async () => {
    const response = json(
      {
        detail: [
          { loc: ["body", "horizon"], msg: "Input should be greater than 0", type: "greater_than" },
          { loc: ["query", "start"], msg: "Input should be a valid date", type: "date_parsing" },
        ],
      },
      422,
    );
    const error = await toApiError(response);
    expect(error.code).toBe("validation_error");
    expect(error.fields).toEqual({ horizon: "Input should be greater than 0", start: "Input should be a valid date" });
    expect(error.message).toBe("horizon: Input should be greater than 0");
  });

  it("understands a plain string detail and a body that isn't JSON", async () => {
    expect((await toApiError(json({ detail: "Not Found" }, 404))).message).toBe("Not Found");
    const error = await toApiError(new Response("<html>Bad gateway</html>", { status: 503 }));
    expect(error.status).toBe(503);
    expect(error.message).toBe("The server is not available right now. Try again in a moment.");
  });

  it("reports an unreachable server as status 0", async () => {
    configureApi({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const { error } = await settle(api.get("/auth/me"));
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(error.message).toMatch(/Can't reach the DemandIQ server/);
  });

  it("treats a proxy's 502 / 503 / 504 like an unreachable server", async () => {
    answer = () => new Response("", { status: 502, headers: { "Content-Type": "text/plain" } }); // Vite's proxy with FastAPI down
    const { error } = await settle(api.get("/auth/me"));
    expect(error).toMatchObject({ status: 502, code: "server_unavailable" });
    expect(error.message).toMatch(/Can't reach the DemandIQ server/);
    expect(isUnreachable(error)).toBe(true);
    expect(isUnreachable(new ApiError(0, "x"))).toBe(true);
    expect(isUnreachable(new ApiError(504, "x"))).toBe(true);
    expect(isUnreachable(new ApiError(401, "x"))).toBe(false);
    expect(isUnreachable(new ApiError(500, "x"))).toBe(false);
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    try {
      configureApi({
        timeoutMs: 1000,
        fetch: (url, init) =>
          new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
      });
      const pending = settle(api.get("/sales"));
      await vi.advanceTimersByTimeAsync(1000);
      const { error } = await pending;
      expect(error).toMatchObject({ status: 0, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls the 401 handler for a signed-in request, not for a failed sign-in", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    answer = () => json({ detail: { code: "invalid_credentials", message: "Invalid user ID or password. Please try again." } }, 401);
    await settle(api.post("/auth/login", {}));
    expect(handler).not.toHaveBeenCalled();

    tokenStore.save("expired-token");
    answer = () => json({ detail: { code: "session_expired", message: "Your session expired. Please sign in again." } }, 401);
    const { error } = await settle(api.get("/auth/me"));
    expect(handler).toHaveBeenCalledWith(error);
    expect(error.code).toBe("session_expired");
  });

  it("settle turns a programming error into an ApiError", async () => {
    const { ok, error } = await settle(Promise.reject(new Error("boom")));
    expect(ok).toBe(false);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: -1, code: "client_error", message: "boom" });
    expect(await settle(Promise.resolve(5))).toEqual({ ok: true, data: 5 });
  });
});

describe("token storage", () => {
  it("keeps a remembered token in localStorage and others in sessionStorage", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    tokenStore.useStorages({ local, session });

    tokenStore.save("long", { remember: true });
    expect(local.getItem("demandiq.token")).toBe("long");
    expect(session.getItem("demandiq.token")).toBeNull();
    expect(tokenStore.get()).toBe("long");

    tokenStore.save("short", { remember: false });
    expect(local.getItem("demandiq.token")).toBeNull(); // a new sign-in replaces the old token
    expect(session.getItem("demandiq.token")).toBe("short");
    expect(tokenStore.get()).toBe("short");

    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it("keeps working when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    tokenStore.useStorages({ local: blocked, session: blocked });
    expect(() => tokenStore.save("x", { remember: true })).not.toThrow();
    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.clear()).not.toThrow();
  });
});
