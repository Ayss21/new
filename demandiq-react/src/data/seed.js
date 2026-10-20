// Starting data for the demonstration workspace.
// Every number the app shows is calculated from these records; nothing on screen is typed in.
import {
  createInitialInventory,
  createPendingUploadRecords,
  createSampleSales,
  demoAccounts,
  inventoryStatus,
  products,
  runForecast,
} from "../lib/domain";
import { datasetCoverage } from "../lib/lineage";
import { ROLE, ROLE_IDS } from "../lib/roles";

/**
 * The cleaned uploads the sales history (19 Dec 2024 – 18 Jun 2025) came from: [datasetId, last date].
 * Every sales record keeps the ID of its upload (datasetId), so a forecast can record which uploads it
 * used (its lineage, lib/lineage.js).
 */
const HISTORY_UPLOADS = [
  ["DS-0002", "2025-03-31"], // sales_dec_2024_mar_2025.csv
  ["DS-0003", "2025-04-30"], // sales_april_2025.csv
  ["DS-0004", "2025-05-31"], // sales_may_2025.csv
  ["DS-0005", "2025-06-18"], // sales_jun_1_18_2025.csv
];
const uploadFor = (date) => HISTORY_UPLOADS.find(([, last]) => date <= last)?.[0] ?? null;

export const sampleSales = createSampleSales().map((record) => ({ ...record, datasetId: uploadFor(record.date) }));
export const initialInventory = createInitialInventory();
/** The week after the history (19–25 Jun 2025): the upload DS-0007, waiting to be cleaned. */
const pendingRecords = createPendingUploadRecords().map((record) => ({ ...record, datasetId: "DS-0007" }));

// ---------------------------------------------------------------------------
// Users (roleId, never role names)
// ---------------------------------------------------------------------------

const userDetails = {
  "analyst@demo.demandiq": { id: "USR-1042", department: "Data & Analytics" },
  "store.manager@demo.demandiq": { id: "USR-2091", department: "Commercial" },
  "inventory@demo.demandiq": { id: "USR-3381", department: "Supply Chain" },
  "admin@demo.demandiq": { id: "USR-1001", department: "Digital Operations" },
};

const order = ["analyst@demo.demandiq", "store.manager@demo.demandiq", "inventory@demo.demandiq", "admin@demo.demandiq"];

/** Two more accounts that show a refused sign-in: one deactivated, one the Admin hasn't activated yet. */
const blockedAccounts = [
  {
    id: "USR-2107",
    name: "Yusuf Rahman",
    email: "former.manager@demo.demandiq",
    password: "Former123!",
    roleId: ROLE.STORE_MANAGER,
    initials: "YR",
    department: "Commercial",
    status: "Inactive",
  },
  {
    id: "USR-1188",
    name: "Hana Idris",
    email: "new.analyst@demo.demandiq",
    password: "Welcome123!",
    roleId: ROLE.DATA_ANALYST,
    initials: "HI",
    department: "Data & Analytics",
    status: "Pending activation",
  },
];

/**
 * { id, name, email, password, roleId, initials, department, status }
 * Passwords are plain text only because the demo backend runs in the browser (src/services/mock). The real
 * backend stores password hashes and never sends a password back (see docs/API_CONTRACT.md).
 */
export const initialUsers = [
  ...order.map((email) => {
    const account = demoAccounts.find((a) => a.email === email);
    return { ...account, ...userDetails[email], status: "Active" };
  }),
  ...blockedAccounts,
];

/** The accounts listed under "Demonstration accounts" on the sign-in page. */
export const DEMO_ACCOUNT_IDS = initialUsers.map((user) => user.id);

const OMAR = "USR-2091";
const NOURA = "USR-1042";
const LAYLA = "USR-3381";
const AHMED = "USR-1001";
const userById = Object.fromEntries(initialUsers.map((u) => [u.id, u]));

/** Product categories. How many products each has is counted from the products, not stored. */
export const initialCategories = [
  { id: "CAT-001", name: "Polymers", description: "Thermoplastic resin portfolio", status: "Active" },
  { id: "CAT-002", name: "Polyethylene", description: "HDPE, LDPE and LLDPE products", status: "Active" },
  { id: "CAT-003", name: "Chemicals", description: "Industrial and specialty chemicals", status: "Active" },
  { id: "CAT-004", name: "Agri-Nutrients", description: "Fertilizer and nutrient products", status: "Active" },
  { id: "CAT-005", name: "Specialties", description: "Engineering and specialty resins", status: "Active" },
];

// ---------------------------------------------------------------------------
// Role permissions, keyed by role ID
// ---------------------------------------------------------------------------

export const PERMISSION_ACTIONS = [
  "Upload sales",
  "Clean data",
  "Run forecasts",
  "Update inventory",
  "Generate reports",
  "Manage users",
  "View system logs",
];

const perms = (storeManager, dataAnalyst, inventorySupervisor, admin) => ({
  [ROLE.STORE_MANAGER]: storeManager,
  [ROLE.DATA_ANALYST]: dataAnalyst,
  [ROLE.INVENTORY_SUPERVISOR]: inventorySupervisor,
  [ROLE.ADMIN]: admin,
});

/**
 * permissions[action][roleId] = "Yes" | "View" | "Review" | "No" (the app shows "No" as "No access").
 * The Admin sees Sales Data, Inventory and Forecasting without changing anything (view only, locked).
 */
export const initialPermissions = {
  "Upload sales": perms("Yes", "Review", "No", "Review"),
  "Clean data": perms("No", "Yes", "No", "View"),
  "Run forecasts": perms("View", "Yes", "View", "View"),
  "Update inventory": perms("No", "No", "Yes", "View"),
  "Generate reports": perms("Yes", "Yes", "Yes", "Yes"),
  "Manage users": perms("No", "No", "No", "Yes"),
  "View system logs": perms("No", "No", "No", "Yes"),
};

/** The screen where each action is carried out. An action only works for a role that can open that screen. */
export const PERMISSION_SCREEN = {
  "Upload sales": "SCR-02",
  "Clean data": "SCR-02",
  "Run forecasts": "SCR-05",
  "Update inventory": "SCR-03",
  "Generate reports": "SCR-04",
  "Manage users": "SCR-06",
  "View system logs": "SCR-06",
};

/** Allowed values per row when an admin edits the matrix. */
export const PERMISSION_OPTIONS = {
  "Upload sales": ["Yes", "Review", "No"],
  "Clean data": ["Yes", "View", "No"],
  "Run forecasts": ["Yes", "View", "No"],
  "Update inventory": ["Yes", "View", "No"],
  "Generate reports": ["Yes", "No"],
  "Manage users": ["Yes", "No"],
  "View system logs": ["Yes", "No"],
};

// ---------------------------------------------------------------------------
// Sign-in sessions and the activity log (24–26 Jun 2025)
// ---------------------------------------------------------------------------

/**
 * Seeded sessions. Each: [sessionId, userId, day, login, logout, events]
 * Each event: [time, action, module, details, status]. Login / logout events are added automatically.
 */
const SEED_SESSIONS = [
  ["SES-0001", LAYLA, "2025-06-24", "07:52", "09:06", [
    ["08:10", "Stock quantity updated", "Inventory", "PC-3308 set to 820 units (Physical stock count)", "Completed"],
    ["08:58", "Inventory Status Report exported", "Reports & Exports", "PDF", "Completed"],
  ]],
  ["SES-0002", NOURA, "2025-06-24", "09:12", "11:04", [
    ["10:02", "Linear Regression forecast executed", "Forecasting", "PE-7820 · 30-day horizon", "Completed"],
    ["10:18", "ARIMA forecast failed", "Forecasting", "EV-8843 · ARIMA(5,2,5) needs at least 46 historical periods", "Failed"],
    ["10:31", "Moving Average forecast executed", "Forecasting", "FE-1094 · 30-day horizon", "Completed"],
    ["10:50", "Forecast Accuracy Report exported", "Reports & Exports", "XLSX", "Completed"],
  ]],
  ["SES-0003", OMAR, "2025-06-24", "11:30", "12:21", [
    ["11:44", "Sales Summary exported", "Reports & Exports", "PDF", "Completed"],
  ]],
  ["SES-0004", AHMED, "2025-06-24", "14:02", "16:24", [
    ["14:26", "Role modified", "Admin Panel", "Store Manager · Run forecasts → View", "Completed"],
    ["14:58", "Product category updated", "Admin Panel", "CAT-005 Specialties", "Completed"],
    ["15:38", "User Activity Report exported", "Reports & Exports", "CSV", "Completed"],
    ["15:52", "System Error Report export failed", "Reports & Exports", "PDF renderer timed out", "Failed"],
  ]],
  ["SES-0005", LAYLA, "2025-06-25", "07:48", "09:02", [
    ["08:04", "Stock quantity updated", "Inventory", "UR-9954 set to 440 units (Goods received)", "Completed"],
    ["08:29", "Reorder placed", "Inventory", "RO-0002 · FE-1094, 810 units", "Completed"],
    ["08:46", "Stock update failed", "Inventory", "ME-7732 · adjustment reason missing", "Failed"],
    ["08:55", "Inventory Status Report export failed", "Reports & Exports", "CSV · file was locked", "Failed"],
  ]],
  ["SES-0006", OMAR, "2025-06-25", "09:13", "10:44", [
    ["09:51", "Dataset upload failed", "Sales Upload", "sales_jun_draft.csv · Couldn't find a quantity column (Units Sold, Quantity, Qty …). Columns in the file: Date, Product_ID, Unit_Price, Discount_Rate.", "Failed"],
    ["10:20", "Product Performance Report export failed", "Reports & Exports", "CSV", "Failed"],
    ["10:31", "Product Performance Report exported", "Reports & Exports", "XLSX", "Completed"],
  ]],
  ["SES-0007", NOURA, "2025-06-25", "13:40", "15:18", [
    ["14:05", "ARIMA forecast executed", "Forecasting", "LL-2468 · ARIMA(2,1,2), 30-day horizon", "Completed"],
    ["14:22", "Moving Average forecast executed", "Forecasting", "PP-4012 · 30-day horizon", "Completed"],
    ["14:40", "Data Quality Report exported", "Reports & Exports", "PDF", "Completed"],
  ]],
  ["SES-0008", AHMED, "2025-06-25", "15:55", "17:10", [
    ["16:05", "Data Quality Report exported", "Reports & Exports", "XLSX", "Completed"],
    ["16:30", "User updated", "Admin Panel", "USR-3381 · department confirmed", "Completed"],
    ["16:48", "Error status updated", "Admin Panel", "ERR-0010 marked investigating", "Completed"],
  ]],
  ["SES-0009", LAYLA, "2025-06-26", "07:55", "09:20", [
    ["08:40", "Reorder Recommendation Report exported", "Reports & Exports", "XLSX", "Completed"],
    ["09:05", "Reorder placed", "Inventory", "RO-0003 · PE-7820, 796 units", "Completed"],
  ]],
  ["SES-0010", OMAR, "2025-06-26", "08:05", "09:12", [
    ["08:30", "Dataset uploaded", "Sales Upload", `sales_jun_19_25_2025.csv · ${pendingRecords.length} valid records`, "Completed"],
  ]],
  ["SES-0011", NOURA, "2025-06-26", "10:00", "11:10", [
    ["10:22", "Linear Regression forecast failed", "Forecasting", "ME-7732 · At least 21 historical periods are required", "Failed"],
  ]],
  ["SES-0012", AHMED, "2025-06-26", "11:02", "11:58", [
    ["11:15", "Role permissions reviewed", "Admin Panel", "No changes", "Completed"],
  ]],
];

/** Failed sign-in attempts (no session). [day, time, userId or null, login entered, reason] */
const SEED_FAILED_SIGN_INS = [
  ["2025-06-24", "13:05", null, "j.doe@company.com", "Invalid user ID or password"],
  ["2025-06-25", "09:10", OMAR, "store.manager@demo.demandiq", "Invalid user ID or password"],
  ["2025-06-26", "10:47", LAYLA, "inventory@demo.demandiq", "This account isn't registered as a Store Manager"],
];

const at = (day, time) => new Date(`${day}T${time}:00`).toISOString();

/** { id, userId, loginAt, logoutAt } — logoutAt is null while the session is active. */
export const initialSessions = SEED_SESSIONS.map(([id, userId, day, login, logout]) => ({
  id,
  userId,
  loginAt: at(day, login),
  logoutAt: logout ? at(day, logout) : null,
}));

/**
 * Activity log rows, newest first:
 * { id, at, sessionId, userId, userName, roleId, action, module, details, status }
 * (userId / roleId are null for a failed sign-in with an unknown account.) IDs count up in time order, as a
 * server would give them.
 */
export const initialActivities = (() => {
  const rows = [];
  const push = (row) => rows.push(row);
  for (const [sessionId, userId, day, login, logout, events] of SEED_SESSIONS) {
    const user = userById[userId];
    const base = { sessionId, userId, userName: user.name, roleId: user.roleId };
    push({ ...base, at: at(day, login), action: "User login", module: "Authentication", details: "Signed in", status: "Completed" });
    for (const [time, action, module, details, status] of events) push({ ...base, at: at(day, time), action, module, details, status });
    if (logout) push({ ...base, at: at(day, logout), action: "User logout", module: "Authentication", details: "Signed out", status: "Completed" });
  }
  for (const [day, time, userId, login, reason] of SEED_FAILED_SIGN_INS) {
    const user = userId ? userById[userId] : null;
    push({
      at: at(day, time),
      sessionId: null,
      userId: user?.id ?? null,
      userName: user?.name ?? login,
      roleId: user?.roleId ?? null,
      action: "Sign-in failed",
      module: "Authentication",
      details: `${login} · ${reason}`,
      status: "Failed",
    });
  }
  return rows
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((row, index) => ({ id: `EVT-${String(index + 1).padStart(4, "0")}`, ...row }))
    .reverse();
})();

/** Error log: { id, at, module, type, severity, message, status } — status is Open, Investigating or Resolved. */
export const initialErrors = [
  ["ERR-0010", "2025-06-18", "10:36", "Forecasting", "Execution failure", "Critical", "ARIMA order (5,2,5) needs more history than the selected range", "Investigating"],
  ["ERR-0009", "2025-06-18", "10:11", "Sales Upload", "Invalid columns", "Error", "Required column Product_ID not found", "Open"],
  ["ERR-0008", "2025-06-17", "15:32", "Reports & Exports", "Export failure", "Warning", "PDF renderer timed out", "Resolved"],
  ["ERR-0007", "2025-06-17", "11:08", "Data Quality", "Missing values", "Info", "34 rows require category mapping", "Resolved"],
  ["ERR-0006", "2025-06-16", "16:14", "Inventory", "Validation warning", "Warning", "Stock adjustment reason was incomplete", "Resolved"],
  ["ERR-0005", "2025-06-16", "13:42", "Forecasting", "Insufficient history", "Error", "Selected SKU had fewer than 21 periods", "Resolved"],
  ["ERR-0004", "2025-06-15", "12:18", "Sales Upload", "Duplicate rows", "Info", "12 duplicate rows were excluded", "Resolved"],
  ["ERR-0003", "2025-06-14", "17:06", "Reports & Exports", "Export warning", "Warning", "Workbook contained no forecast rows", "Resolved"],
  ["ERR-0002", "2025-06-14", "09:34", "Authentication", "Session expired", "Info", "Inactive demonstration session expired", "Resolved"],
  ["ERR-0001", "2025-06-13", "14:50", "Data Quality", "Invalid numeric", "Error", "Units_Sold contained invalid values", "Resolved"],
].map(([id, day, time, module, type, severity, message, status]) => ({ id, at: at(day, time), module, type, severity, message, status }));

// ---------------------------------------------------------------------------
// Datasets (Uploaded → Cleaned → Forecasted) and the dataset history
// ---------------------------------------------------------------------------

const uploader = { uploaderId: OMAR, uploader: userById[OMAR].name };

/** An upload that was cleaned into the sales history. Its numbers are counted from its records. */
function cleanedUpload(id, fileName, uploadedAt, cleanedAt, warnings = {}) {
  const records = sampleSales.filter((record) => record.datasetId === id);
  const excluded = Object.values(warnings).reduce((sum, n) => sum + n, 0);
  return {
    id,
    fileName,
    uploadedAt,
    ...uploader,
    recordCount: records.length,
    validation: excluded ? `${excluded} warning${excluded === 1 ? "" : "s"}` : "Valid",
    checks: { total: records.length + excluded, valid: records.length, combined: 0, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, ...warnings },
    coverage: datasetCoverage(records),
    cleaning: "Completed",
    cleanedAt,
    cleaningSummary: {
      inputRecords: records.length,
      excludedAtValidation: excluded,
      outliersCapped: 0,
      replaced: 0,
      skipped: 0,
      added: records.length,
      cleanedBy: userById[NOURA].name,
      cleanedAt,
    },
    pendingRecords: [],
    error: null,
  };
}

/** An upload that failed validation: nothing reached the sales history. */
function rejectedUpload(id, fileName, uploadedAt, error, checks) {
  return {
    id,
    fileName,
    uploadedAt,
    ...uploader,
    recordCount: 0,
    validation: "Failed",
    checks: { total: 0, valid: 0, combined: 0, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, ...checks },
    coverage: null,
    cleaning: "Not started",
    cleanedAt: null,
    cleaningSummary: null,
    pendingRecords: [],
    error,
  };
}

/**
 * Uploads, newest first: { id, fileName, uploadedAt, uploaderId, uploader, recordCount, validation, checks,
 * coverage, cleaning, cleanedAt, cleaningSummary, pendingRecords, error }.
 * Their forecasting status isn't stored: it is worked out from the forecasts' lineage (lib/lineage.js).
 */
export const initialDatasets = [
  {
    id: "DS-0007",
    fileName: "sales_jun_19_25_2025.csv",
    uploadedAt: at("2025-06-26", "08:30"),
    ...uploader,
    recordCount: pendingRecords.length,
    validation: "2 warnings",
    checks: { total: pendingRecords.length + 2, valid: pendingRecords.length, combined: 0, missing: 1, duplicates: 1, invalidDates: 0, invalidNumeric: 0 },
    coverage: datasetCoverage(pendingRecords),
    cleaning: "Pending",
    cleanedAt: null,
    cleaningSummary: null,
    pendingRecords,
    error: null,
  },
  // A first draft of the same week, rejected
  rejectedUpload("DS-0006", "sales_jun_draft.csv", at("2025-06-25", "09:51"), "Couldn't find a quantity column (Units Sold, Quantity, Qty …). Columns in the file: Date, Product_ID, Unit_Price, Discount_Rate.", {
    total: pendingRecords.length + 2,
  }),
  cleanedUpload("DS-0005", "sales_jun_1_18_2025.csv", at("2025-06-19", "08:45"), at("2025-06-19", "09:20")),
  cleanedUpload("DS-0004", "sales_may_2025.csv", at("2025-06-02", "11:20"), at("2025-06-02", "12:05"), { missing: 1, duplicates: 2 }),
  cleanedUpload("DS-0003", "sales_april_2025.csv", at("2025-05-03", "08:34"), at("2025-05-03", "09:10")),
  // The corrected re-upload of the legacy file below
  cleanedUpload("DS-0002", "sales_dec_2024_mar_2025.csv", at("2025-04-04", "15:05"), at("2025-04-04", "16:20")),
  // Rejected as a whole (the date column's format), like DS-0006, so no row-level counts
  rejectedUpload("DS-0001", "legacy_sales_q1.csv", at("2025-04-04", "14:12"), "Date column used an unsupported format", {
    total: sampleSales.filter((record) => record.datasetId === "DS-0002").length,
  }),
];

// ---------------------------------------------------------------------------
// Forecast runs
// ---------------------------------------------------------------------------

/**
 * Saved forecast runs, newest first: [saved at, settings]. Each was fitted on the whole history
 * (19 Dec 2024 – 18 Jun 2025), so it used the four cleaned uploads DS-0002 … DS-0005 — and every run is
 * saved after DS-0005 was cleaned (19 Jun, 09:20). The four runs on 24–25 Jun are also in the activity log.
 */
const SEED_RUNS = [
  ["2025-06-25", "14:22", { sku: "PP-4012", model: "Moving Average", horizon: 30, windowSize: 7 }],
  ["2025-06-25", "14:05", { sku: "LL-2468", model: "ARIMA", horizon: 30, order: [2, 1, 2] }],
  ["2025-06-24", "10:31", { sku: "FE-1094", model: "Moving Average", horizon: 30, windowSize: 7 }],
  ["2025-06-24", "10:02", { sku: "PE-7820", model: "Linear Regression", horizon: 30 }],
  ["2025-06-23", "15:40", { sku: "EV-8843", model: "Moving Average", horizon: 60, windowSize: 7 }],
  ["2025-06-23", "11:10", { sku: "ME-7732", model: "Linear Regression", horizon: 7 }],
  ["2025-06-20", "16:25", { sku: "AB-6621", model: "Moving Average", horizon: 30, windowSize: 7 }],
  ["2025-06-20", "10:50", { sku: "PS-5510", model: "Linear Regression", horizon: 90 }],
  ["2025-06-19", "15:15", { sku: "PC-3308", model: "Linear Regression", horizon: 60 }],
  ["2025-06-19", "11:30", { sku: "CH-2155", model: "Moving Average", horizon: 7, windowSize: 7 }],
  ["2025-06-19", "10:05", { sku: "UR-9954", model: "Moving Average", horizon: 30, windowSize: 7 }],
];

export const initialForecastHistory = SEED_RUNS.map(([day, time, options]) => ({
  ...runForecast(sampleSales, options),
  generatedAt: at(day, time),
  generatedBy: { id: NOURA, name: userById[NOURA].name },
}));

// ---------------------------------------------------------------------------
// Reports and the report history
// ---------------------------------------------------------------------------

export const ALL_REPORTS = [
  ["Sales Summary", "Revenue, volume and product performance", "trend"],
  ["Demand Forecast Report", "Forecasts by product, model and horizon", "trend"],
  ["Forecast Accuracy Report", "MAE, RMSE and MAPE evaluation", "check"],
  ["Sales by Region", "Regional revenue and volume performance", "trend"],
  ["Product Performance Report", "Product ranking and contribution", "box"],
  ["Inventory Status Report", "Stock position, risk and coverage", "box"],
  ["Reorder Recommendation Report", "Suggested replenishment actions", "warning"],
  ["Data Quality Report", "Validation and cleaning outcomes", "shield"],
  ["User Activity Report", "Platform actions and audit events", "log"],
  ["System Error Report", "Technical exceptions and resolution", "warning"],
];

/** Reports each role may generate, keyed by role ID. */
export const REPORTS_BY_ROLE = {
  [ROLE.STORE_MANAGER]: ["Sales Summary", "Demand Forecast Report", "Forecast Accuracy Report", "Sales by Region", "Product Performance Report"],
  [ROLE.DATA_ANALYST]: ["Sales Summary", "Demand Forecast Report", "Forecast Accuracy Report", "Data Quality Report"],
  [ROLE.INVENTORY_SUPERVISOR]: ["Inventory Status Report", "Reorder Recommendation Report"],
  [ROLE.ADMIN]: ALL_REPORTS.map((report) => report[0]),
};

export const EXPORT_FORMATS = [
  { value: "PDF", label: "PDF" },
  { value: "XLSX", label: "Excel (XLSX)" },
  { value: "CSV", label: "CSV" },
];

/**
 * Report history rows, newest first: { id, name, format, generatedAt, userId, userName, roleId, status }.
 * IDs count up in time order (RPT-001 is the oldest).
 */
export const initialExports = [
  [OMAR, "2025-06-26", "08:52", "Sales by Region", "XLSX", "Processing"],
  [OMAR, "2025-06-25", "10:31", "Product Performance Report", "XLSX", "Completed"],
  [OMAR, "2025-06-25", "10:20", "Product Performance Report", "CSV", "Failed"],
  [OMAR, "2025-06-24", "11:44", "Sales Summary", "PDF", "Completed"],
  [OMAR, "2025-06-20", "16:02", "Demand Forecast Report", "PDF", "Completed"],
  [OMAR, "2025-06-19", "09:14", "Forecast Accuracy Report", "CSV", "Completed"],
  [NOURA, "2025-06-26", "10:38", "Demand Forecast Report", "CSV", "Processing"],
  [NOURA, "2025-06-25", "14:40", "Data Quality Report", "PDF", "Completed"],
  [NOURA, "2025-06-24", "10:50", "Forecast Accuracy Report", "XLSX", "Completed"],
  [NOURA, "2025-06-23", "15:12", "Sales Summary", "PDF", "Failed"],
  [NOURA, "2025-06-20", "11:05", "Demand Forecast Report", "XLSX", "Completed"],
  [LAYLA, "2025-06-26", "08:47", "Reorder Recommendation Report", "PDF", "Processing"],
  [LAYLA, "2025-06-26", "08:40", "Reorder Recommendation Report", "XLSX", "Completed"],
  [LAYLA, "2025-06-25", "08:55", "Inventory Status Report", "CSV", "Failed"],
  [LAYLA, "2025-06-24", "08:58", "Inventory Status Report", "PDF", "Completed"],
  [LAYLA, "2025-06-21", "09:30", "Inventory Status Report", "XLSX", "Completed"],
  [AHMED, "2025-06-26", "11:20", "User Activity Report", "PDF", "Processing"],
  [AHMED, "2025-06-25", "16:05", "Data Quality Report", "XLSX", "Completed"],
  [AHMED, "2025-06-24", "15:52", "System Error Report", "PDF", "Failed"],
  [AHMED, "2025-06-24", "15:38", "User Activity Report", "CSV", "Completed"],
  [AHMED, "2025-06-22", "10:10", "System Error Report", "CSV", "Completed"],
].map(([userId, day, time, name, format, status]) => ({
  name,
  format,
  generatedAt: at(day, time),
  userId,
  userName: userById[userId].name,
  roleId: userById[userId].roleId,
  status,
}))
  .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  .map((report, index) => ({ id: `RPT-${String(index + 1).padStart(3, "0")}`, ...report }))
  .reverse();

// ---------------------------------------------------------------------------
// Month-end inventory snapshots (units in stock per product at each month end)
// ---------------------------------------------------------------------------

/** Month-end stock by SKU, Dec 2024 – May 2025. June 2025 is the current month (live stock). */
const MONTH_END_STOCK = {
  //          Dec   Jan   Feb   Mar   Apr   May
  "PP-4012": [1150, 980, 720, 610, 1350, 1290],
  "PE-7820": [520, 430, 360, 240, 610, 300],
  "CH-2155": [610, 455, 330, 260, 540, 480],
  "PC-3308": [700, 640, 590, 520, 470, 760],
  "FE-1094": [640, 560, 470, 380, 280, 690],
  "PS-5510": [690, 520, 410, 330, 610, 540],
  "AB-6621": [455, 390, 240, 410, 330, 200],
  "ME-7732": [470, 440, 405, 380, 600, 520],
  "EV-8843": [820, 760, 690, 560, 430, 1010],
  "UR-9954": [560, 510, 450, 390, 200, 520],
  "LL-2468": [600, 540, 470, 420, 640, 300],
};
const SNAPSHOT_MONTHS = [
  ["2024-12", "2024-12-31"],
  ["2025-01", "2025-01-31"],
  ["2025-02", "2025-02-28"],
  ["2025-03", "2025-03-31"],
  ["2025-04", "2025-04-30"],
  ["2025-05", "2025-05-31"],
];
/** The current month; its snapshot follows live stock changes. */
export const CURRENT_SNAPSHOT_MONTH = "2025-06";

/**
 * Reorders, newest first: { id, sku, quantity, supplier, status, orderedAt, deliveredAt, userId, userName }.
 * A reorder is Ordered when the Inventory Supervisor places it, and Delivered when it is marked delivered
 * (which adds the quantity to stock). RO-0002 and RO-0003 are the orders the activity log mentions (25 and
 * 26 Jun); RO-0001 arrived on 18 Jun, before the stock figures were taken.
 */
export const initialReorders = [
  ["RO-0003", "PE-7820", 796, ["2025-06-26", "09:05"], null],
  ["RO-0002", "FE-1094", 810, ["2025-06-25", "08:29"], null],
  ["RO-0001", "ME-7732", 300, ["2025-06-11", "10:15"], ["2025-06-18", "15:30"]],
].map(([id, sku, quantity, ordered, delivered]) => ({
  id,
  sku,
  quantity,
  supplier: "Approved supplier · SUP-024",
  status: delivered ? "Delivered" : "Ordered",
  orderedAt: at(...ordered),
  deliveredAt: delivered ? at(...delivered) : null,
  userId: LAYLA,
  userName: userById[LAYLA].name,
}));

/**
 * Snapshots: { month: "YYYY-MM", asOf: "YYYY-MM-DD", items: [{ sku, stock, status }] }
 * status is "Safe", "Warning" (shown as Low) or "Critical".
 */
export const initialSnapshots = [
  ...SNAPSHOT_MONTHS.map(([month, asOf], m) => ({
    month,
    asOf,
    items: products.map((product) => {
      const stock = MONTH_END_STOCK[product.sku][m];
      return { sku: product.sku, stock, status: inventoryStatus(stock, product) };
    }),
  })),
  {
    month: CURRENT_SNAPSHOT_MONTH,
    asOf: "2025-06-18",
    items: initialInventory.map((item) => ({ sku: item.sku, stock: item.stock, status: item.status })),
  },
];

export { ROLE_IDS };
