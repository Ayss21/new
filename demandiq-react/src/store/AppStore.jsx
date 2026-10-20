// Shared application state. All data comes from the API through the service files in src/services
// (in demo mode the demo backend answers; with VITE_API_MODE=live, FastAPI does).
//
// The store keeps a copy of what the server sent so every page can render it, and offers actions that
// call a service and then reload what changed. Every action resolves to a result object instead of
// throwing:  { ok: true, data }  or  { ok: false, error }  (error is an ApiError: message, status, code, fields).
// A page that only needs an answer for itself (for example comparing models) calls a service directly.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { REPORTS_BY_ROLE } from "../data/seed";
import { DEFAULT_DATE_PRESET, dateBounds, defaultFilters, presetRange } from "../lib/domain";
import { saveBlob } from "../lib/exporters";
import { formatRange } from "../lib/format";
import { accessLock, canOpenPage, screenIdsFor, withScreenAccess } from "../navigation";
import { ApiError, isUnreachable, onUnauthorized, settle } from "../services/api";
import { tokenStore } from "../services/tokenStore";
import { activityService } from "../services/activityService";
import { adminService } from "../services/adminService";
import { authService } from "../services/authService";
import { demoService } from "../services/demoService";
import { forecastService } from "../services/forecastService";
import { inventoryService } from "../services/inventoryService";
import { reorderService } from "../services/reorderService";
import { reportService } from "../services/reportService";
import { salesService } from "../services/salesService";

const StoreContext = createContext(null);

const EMPTY_DATA = {
  sales: [],
  inventory: [],
  snapshots: [],
  alerts: [],
  forecasts: [],
  datasets: [],
  reorders: [],
  reports: [],
  categories: [],
  users: [],
  permissions: {},
  screenAccess: {},
  activity: [],
  sessions: [],
  errors: [],
};

/** How each collection is loaded from the API. */
const LOADERS = {
  sales: () => salesService.getSales(),
  inventory: () => inventoryService.getInventory(),
  snapshots: () => inventoryService.getSnapshots(),
  alerts: () => inventoryService.getAlerts(),
  forecasts: () => forecastService.getForecasts(),
  datasets: () => salesService.getDatasets(),
  reorders: () => reorderService.getReorders(),
  reports: () => reportService.getReports(),
  categories: () => adminService.getCategories(),
  users: () => adminService.getUsers(),
  permissions: () => adminService.getPermissions(),
  screenAccess: () => adminService.getScreenAccess(),
  activity: () => activityService.getActivity(),
  sessions: () => activityService.getSessions(),
  errors: () => activityService.getErrors(),
};

/** Every signed-in user loads these; the rest depend on the role's permissions. */
const COMMON_DATA = ["sales", "inventory", "snapshots", "alerts", "forecasts", "datasets", "reorders", "reports", "categories"];
const ADMIN_DATA = ["users", "permissions", "screenAccess"]; // "Manage users"
const LOG_DATA = ["activity", "sessions", "errors"]; // "View system logs" — reloaded after actions, which the server logs

function dataKeysFor(permissions) {
  return [
    ...COMMON_DATA,
    ...(permissions?.["Manage users"] === "Yes" ? ADMIN_DATA : []),
    ...(permissions?.["View system logs"] === "Yes" ? LOG_DATA : []),
  ];
}

/** Filters for a date preset, keeping the other filter values. */
function withPreset(filters, preset, bounds) {
  const range = presetRange(preset, bounds.end, bounds.start);
  return range ? { ...filters, datePreset: preset, startDate: range[0], endDate: range[1] } : filters;
}

const signedOut = (notice = "") => ({ status: "signed-out", user: null, session: null, permissions: {}, screens: [], origin: null, notice });

/** A failed result for a check the browser makes before calling the API. */
const refused = (message, code = "client_check") => ({ ok: false, error: new ApiError(400, message, { code }) });

export function AppStoreProvider({ children }) {
  // status: "checking" (a saved token is being verified) | "offline" (the server can't be reached) | "signed-out" | "signed-in"
  const [auth, setAuth] = useState(() => (tokenStore.get() ? { ...signedOut(), status: "checking" } : signedOut()));
  const [data, setData] = useState(EMPTY_DATA);
  const [workspace, setWorkspace] = useState({ status: "idle", error: null }); // idle | loading | ready | error
  const [roles, setRoles] = useState([]); // public: each role with its screen IDs (sign-in page)
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState("success"); // "success" | "warning" | "error"
  const toastTimer = useRef(undefined);
  const authRef = useRef(auth);
  authRef.current = auth;
  const generation = useRef(0); // changes on every sign-in / sign-out, so late answers are ignored

  const bounds = useMemo(() => dateBounds(data.sales), [data.sales]);
  // Default view: the last 3 months of data, every other filter on "All".
  const baseFilters = useMemo(() => withPreset({ ...defaultFilters }, DEFAULT_DATE_PRESET, bounds), [bounds]);
  const [draftFilters, setDraftFilters] = useState(baseFilters);
  const [appliedFilters, setAppliedFilters] = useState(baseFilters);

  /** Shows a toast. tone: "success" (default), "warning" (e.g. access refused) or "error". */
  const notify = useCallback((message, ms = 3500, tone = "success") => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    setToastTone(tone);
    toastTimer.current = window.setTimeout(() => setToast(""), ms);
  }, []);

  // ---------------- Loading data ----------------

  /** Loads everything the signed-in role needs. */
  const loadWorkspace = useCallback(async (permissions) => {
    const run = generation.current;
    setWorkspace({ status: "loading", error: null });
    const keys = dataKeysFor(permissions);
    const results = await Promise.all(keys.map((key) => settle(LOADERS[key]())));
    if (run !== generation.current) return; // signed out (or in again) meanwhile
    const failed = results.find((result) => !result.ok);
    if (failed) {
      if (failed.error.status !== 401) setWorkspace({ status: "error", error: failed.error });
      return;
    }
    const loaded = Object.fromEntries(keys.map((key, i) => [key, results[i].data]));
    setData({ ...EMPTY_DATA, ...loaded });
    const base = withPreset({ ...defaultFilters }, DEFAULT_DATE_PRESET, dateBounds(loaded.sales));
    setDraftFilters(base);
    setAppliedFilters(base);
    setWorkspace({ status: "ready", error: null });
  }, []);

  /**
   * Reloads some collections (e.g. after an action). Resolves to the new values. Collections the role
   * can't read are skipped; a failure keeps the old values and shows a warning.
   */
  const refresh = useCallback(
    async (keys) => {
      const run = generation.current;
      const allowed = dataKeysFor(authRef.current.permissions);
      const wanted = [...new Set(keys)].filter((key) => allowed.includes(key));
      const results = await Promise.all(wanted.map((key) => settle(LOADERS[key]())));
      if (run !== generation.current) return {};
      const loaded = {};
      let problem = null;
      wanted.forEach((key, i) => {
        if (results[i].ok) loaded[key] = results[i].data;
        else problem ??= results[i].error;
      });
      if (Object.keys(loaded).length) setData((current) => ({ ...current, ...loaded }));
      if (problem && problem.status !== 401) notify(`Some data couldn't be refreshed: ${problem.message}`, 4500, "warning");
      return loaded;
    },
    [notify],
  );

  // ---------------- Sign in / sign out ----------------

  const startSession = useCallback(
    (payload, origin) => {
      generation.current += 1;
      const next = { status: "signed-in", user: payload.user, session: payload.session, permissions: payload.permissions, screens: payload.screens, origin, notice: "" };
      authRef.current = next;
      setAuth(next);
      loadWorkspace(payload.permissions);
    },
    [loadWorkspace],
  );

  /** Signs out in this browser (the token is dropped) and shows `notice` on the sign-in page. */
  const endSession = useCallback((notice = "") => {
    generation.current += 1;
    tokenStore.clear();
    const next = signedOut(notice);
    authRef.current = next;
    setAuth(next);
    setData(EMPTY_DATA);
    setWorkspace({ status: "idle", error: null });
  }, []);

  /** After a refresh: is the saved token still valid? (GET /auth/me) */
  const checkSavedSession = useCallback(async () => {
    if (!tokenStore.get()) return endSession("");
    setAuth((current) => ({ ...current, status: "checking" }));
    const result = await settle(authService.getCurrentUser());
    if (result.ok) return startSession(result.data, "resumed");
    // Server down: keep the saved sign-in and offer "Try again"
    if (isUnreachable(result.error)) setAuth({ ...signedOut(result.error.message), status: "offline" });
    else endSession(result.error.status === 401 ? result.error.message : `Your session couldn't be restored: ${result.error.message}`);
  }, [endSession, startSession]);

  // Once, when the app loads (the ref also stops React's development double-run from asking twice)
  const savedChecked = useRef(false);
  useEffect(() => {
    if (savedChecked.current) return;
    savedChecked.current = true;
    if (tokenStore.get()) checkSavedSession();
  }, [checkSavedSession]);

  // Any signed-in request answered with 401 (session expired, signed out elsewhere, account deactivated, role changed)
  useEffect(() => {
    onUnauthorized((error) => {
      if (["signed-in", "checking"].includes(authRef.current.status)) endSession(error.message);
    });
    return () => onUnauthorized(null);
  }, [endSession]);

  /** Public list of roles and their screen IDs (sign-in page). */
  const loadRoles = useCallback(async () => {
    const result = await settle(authService.getRoles());
    if (result.ok) setRoles(result.data);
    return result;
  }, []);

  /** POST /auth/login. Resolves to { ok: true } or { ok: false, error } (error.code says why). */
  const login = async (loginId, password, roleId, { remember = false } = {}) => {
    const result = await settle(authService.login({ login: loginId, password, roleId, remember }));
    if (!result.ok) return result;
    const { accessToken, ...payload } = result.data;
    tokenStore.save(accessToken, { remember });
    startSession(payload, "signed-in");
    return { ok: true, data: payload.user };
  };

  /** POST /auth/logout, and sign out here straight away (even if the server can't be reached). */
  const logout = () => {
    const request = authService.logout(); // takes the token before it is cleared below
    endSession("");
    request.catch(() => {});
  };

  /** Reloads the signed-in user's own permissions and screens (after the Admin changes their own role). */
  const refreshMe = useCallback(async () => {
    const result = await settle(authService.getCurrentUser());
    if (result.ok)
      setAuth((current) => ({ ...current, user: result.data.user, session: result.data.session, permissions: result.data.permissions, screens: result.data.screens }));
  }, []);

  // ---------------- Permissions of the signed-in user ----------------

  /** Action permission: "Yes" | "View" | "Review" | "No" (from the sign-in response). */
  const level = useCallback((action) => auth.permissions?.[action] ?? "No", [auth.permissions]);
  const can = useCallback((action) => level(action) === "Yes", [level]);
  /** The signed-in user's screens as a role ID → screen IDs map (for the navigation helpers). */
  const navAccess = useMemo(() => (auth.user ? { [auth.user.roleId]: auth.screens } : {}), [auth.user, auth.screens]);
  /** Can the signed-in user generate this report (the "Export …" buttons)? The server checks it again. */
  const canExport = useCallback(
    (reportName) => can("Generate reports") && (REPORTS_BY_ROLE[auth.user?.roleId] ?? []).includes(reportName),
    [can, auth.user],
  );
  /** Can the signed-in user open this page? Decided by the screen IDs the server sent for the role. */
  const canOpen = useCallback((page) => (auth.user ? canOpenPage(navAccess, auth.user.roleId, page) : false), [auth.user, navAccess]);

  // ---------------- Filters ----------------

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
    notify("Filters applied across the current workspace.", 3000);
  };

  const clearFilters = () => {
    setDraftFilters(baseFilters);
    setAppliedFilters(baseFilters);
    notify("All filters cleared. Default data restored.", 3000);
  };

  /** Shows these dates everywhere: a custom date range in the global filters (the other filters stay). */
  const showDates = (startDate, endDate) => {
    const dated = (f) => ({ ...f, datePreset: "Custom Range", startDate, endDate });
    setDraftFilters(dated);
    setAppliedFilters(dated);
    notify(`Date range set to ${formatRange(startDate, endDate)}.`, 3000);
  };

  // ---------------- Sales data ----------------

  /** POST /datasets. A rejected file resolves to { ok: false } with error.details.validation (the attempt is recorded). */
  /** POST /datasets. A file can add products to the catalog, so their lists are loaded again too. */
  const uploadDataset = async (file) => {
    const result = await settle(salesService.uploadDataset(file));
    const added = result.ok && result.data.dataset.newProducts?.length ? ["inventory", "categories", "snapshots", "alerts"] : [];
    await refresh(["datasets", ...added, ...LOG_DATA]);
    return result;
  };

  /** POST /datasets/{id}/clean, then reloads the sales data (and moves the date presets to the new latest date). */
  const cleanDataset = async (datasetId, options) => {
    const result = await settle(salesService.cleanDataset(datasetId, options));
    if (!result.ok) return result;
    const oldEnd = bounds.end;
    const loaded = await refresh(["sales", "datasets", ...LOG_DATA]);
    if (loaded.sales) {
      const newBounds = dateBounds(loaded.sales);
      // Keep preset ranges relative to the latest data; extend a custom range that ended at the old latest date.
      const extend = (f) =>
        f.datePreset !== "Custom Range" ? withPreset(f, f.datePreset, newBounds) : f.endDate === oldEnd ? { ...f, endDate: newBounds.end } : f;
      setDraftFilters(extend);
      setAppliedFilters(extend);
    }
    return result;
  };

  // ---------------- Forecasting ----------------

  /** POST /forecasts — runs and saves; the product's demand and the dataset pipeline update on the server. */
  const runForecast = async (request) => {
    const result = await settle(forecastService.runForecast(request));
    if (result.ok) setData((current) => ({ ...current, forecasts: [result.data, ...current.forecasts.filter((run) => run.id !== result.data.id)] }));
    refresh(result.ok ? ["inventory", "alerts", "datasets", ...LOG_DATA] : LOG_DATA);
    return result;
  };

  // ---------------- Inventory ----------------

  /** PATCH /inventory/{sku} */
  const updateStock = async (sku, stock, reason, notes = "") => {
    const result = await settle(inventoryService.updateStock(sku, { stock, reason, notes }));
    if (result.ok) await refresh(["inventory", "snapshots", "alerts", ...LOG_DATA]);
    return result;
  };

  /** POST /reorders → the order, status Ordered. */
  const createReorder = async (sku, quantity, supplier) => {
    const result = await settle(reorderService.createReorder({ sku, quantity, supplier }));
    if (result.ok) await refresh(["reorders", ...LOG_DATA]);
    return result;
  };

  /** PATCH /reorders/{id} { status: "Delivered" } — adds the quantity to the product's stock. */
  const updateReorder = async (id, status) => {
    const result = await settle(reorderService.updateReorderStatus(id, status));
    if (result.ok) await refresh(["reorders", ...(status === "Delivered" ? ["inventory", "snapshots", "alerts"] : []), ...LOG_DATA]);
    return result;
  };

  // ---------------- Administration ----------------

  const addUser = async (form) => {
    const result = await settle(adminService.createUser(form));
    if (result.ok) await refresh(["users", ...LOG_DATA]);
    return result;
  };

  const updateUser = async (id, changes) => {
    const result = await settle(adminService.updateUser(id, changes));
    if (result.ok) await refresh(["users", ...LOG_DATA]);
    return result;
  };

  const addCategory = async (category) => {
    const result = await settle(adminService.createCategory(category));
    if (result.ok) await refresh(["categories", ...LOG_DATA]);
    return result;
  };

  const updateCategory = async (id, changes) => {
    const result = await settle(adminService.updateCategory(id, changes));
    // A new name reaches the category's products and their sales, so those lists are loaded again too
    const renamed = changes.name !== undefined ? ["inventory", "sales"] : [];
    if (result.ok) await refresh(["categories", ...renamed, ...LOG_DATA]);
    return result;
  };

  /** PATCH /roles/permissions — one cell of the action matrix. */
  const setPermission = async (action, roleId, value) => {
    const result = await settle(adminService.updatePermission({ action, roleId, value }));
    if (result.ok) {
      setData((current) => ({ ...current, permissions: result.data }));
      if (roleId === auth.user?.roleId) refreshMe();
      refresh(LOG_DATA);
    }
    return result;
  };

  /** PUT /roles/{roleId}/screens — lets a role open a screen, or stops it. Locked cells are refused here first. */
  const setScreenAccess = async (roleId, screenId, allowed) => {
    const locked = accessLock(roleId, screenId);
    if (locked) return refused(locked, "locked");
    const screens = screenIdsFor(withScreenAccess(data.screenAccess, roleId, screenId, allowed), roleId);
    const result = await settle(adminService.updateScreenAccess(roleId, screens));
    if (result.ok) {
      setData((current) => ({ ...current, screenAccess: result.data }));
      if (roleId === auth.user?.roleId) refreshMe();
      refresh(LOG_DATA);
    }
    return result;
  };

  /** POST /roles/restore-defaults */
  const restoreDefaultAccess = async () => {
    const result = await settle(adminService.restoreDefaults());
    if (result.ok) {
      setData((current) => ({ ...current, permissions: result.data.permissions, screenAccess: result.data.screens }));
      refreshMe();
      refresh(LOG_DATA);
    }
    return result;
  };

  // ---------------- Reports ----------------

  /**
   * POST /reports, then polls until the report is ready and downloads the file.
   * The report appears in the history as Processing straight away.
   */
  const generateReport = async (name, format) => {
    const started = await settle(reportService.generateReport({ name, format, filters: appliedFilters }));
    if (!started.ok) return started;
    setData((current) => ({ ...current, reports: [started.data, ...current.reports.filter((r) => r.id !== started.data.id)] }));
    const finished = await settle(reportService.waitForReport(started.data.id));
    refresh(["reports", ...LOG_DATA]);
    if (!finished.ok) return finished;
    if (finished.data.status !== "Completed")
      return { ok: false, error: new ApiError(409, finished.data.error ?? "The report could not be generated.", { code: "report_failed" }) };
    const file = await settle(reportService.downloadReport(started.data.id));
    if (!file.ok) return file;
    saveBlob(file.data.blob, file.data.fileName);
    return { ok: true, data: finished.data };
  };

  /** GET /reports/{id}/file — downloads a report from the history again. */
  const downloadReport = async (id) => {
    const file = await settle(reportService.downloadReport(id));
    if (file.ok) saveBlob(file.data.blob, file.data.fileName);
    return file;
  };

  // ---------------- Logs ----------------

  /** PATCH /errors/{id} */
  const setErrorStatus = async (errorId, status, notes = "") => {
    const result = await settle(activityService.updateErrorStatus(errorId, status, notes));
    if (result.ok) await refresh(["errors", "activity"]);
    return result;
  };

  /** POST /activity — events only the browser sees (a refused screen address). Fire and forget. */
  const logClientEvent = (action, details = "") => {
    settle(activityService.logEvent({ action, details })).then(() => refresh(["activity"]));
  };

  // ---------------- Demo backend only ----------------

  const getDemoAccounts = () => settle(demoService.getAccounts());

  const resetDemoData = async () => {
    const result = await settle(demoService.reset());
    if (result.ok) {
      loadRoles();
      notify("Data reset to its starting point.");
    }
    return result;
  };

  const value = {
    // who is signed in
    authStatus: auth.status,
    currentUser: auth.user,
    currentSessionId: auth.session?.id ?? null,
    authOrigin: auth.origin,
    authNotice: auth.notice,
    navAccess,
    level,
    can,
    canExport,
    canOpen,
    roles,
    loadRoles,
    login,
    logout,
    retryConnection: checkSavedSession,
    // data from the API
    workspaceStatus: workspace.status,
    workspaceError: workspace.error,
    reloadWorkspace: () => loadWorkspace(auth.permissions),
    refresh,
    sales: data.sales,
    inventory: data.inventory,
    snapshots: data.snapshots,
    alerts: data.alerts,
    forecastHistory: data.forecasts,
    datasets: data.datasets,
    reorders: data.reorders,
    exports: data.reports,
    categories: data.categories,
    users: data.users,
    permissions: data.permissions,
    screenAccess: data.screenAccess,
    activity: data.activity,
    sessions: data.sessions,
    errors: data.errors,
    // filters
    bounds,
    baseFilters,
    draftFilters,
    appliedFilters,
    setDraftFilters,
    applyFilters,
    clearFilters,
    showDates,
    // toasts
    toast,
    toastTone,
    notify,
    dismissToast: () => setToast(""),
    // actions (each resolves to { ok, data } or { ok: false, error })
    uploadDataset,
    cleanDataset,
    runForecast,
    updateStock,
    createReorder,
    updateReorder,
    addUser,
    updateUser,
    addCategory,
    updateCategory,
    setPermission,
    setScreenAccess,
    restoreDefaultAccess,
    generateReport,
    downloadReport,
    setErrorStatus,
    logClientEvent,
    getDemoAccounts,
    resetDemoData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <AppStoreProvider>");
  return store;
}
