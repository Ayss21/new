// Business logic and sample data (from the Figma Make prototype),
// extended with ARIMA, data cleaning and dataset/user types.
import { importSales } from "./salesImport";
import { arimaForecast, validateArimaOrder } from "./arima";
import { ROLE, SIGN_UP_ROLE_IDS, roleName } from "./roles";

export const demoAccounts = [
  { name: "Omar Hassan", email: "store.manager@demo.demandiq", password: "Store123!", roleId: ROLE.STORE_MANAGER, initials: "OH" },
  { name: "Noura Alharbi", email: "analyst@demo.demandiq", password: "Analyze123!", roleId: ROLE.DATA_ANALYST, initials: "NA" },
  { name: "Layla Noor", email: "inventory@demo.demandiq", password: "Stock123!", roleId: ROLE.INVENTORY_SUPERVISOR, initials: "LN" },
  { name: "Ahmed Malik", email: "admin@demo.demandiq", password: "Admin123!", roleId: ROLE.ADMIN, initials: "AM" },
];

export function initialsOf(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function authenticateDemoUser(email, password) {
  return (
    demoAccounts.find(
      (account) => account.email.toLowerCase() === email.trim().toLowerCase() && account.password === password,
    ) || null
  );
}

/** Finds a user by email or employee ID (case-insensitive). */
export function findUser(users, login) {
  const key = login.trim().toLowerCase();
  if (!key) return null;
  return users.find((u) => u.email.toLowerCase() === key || u.id.toLowerCase() === key) ?? null;
}

/**
 * Sign-in check against the managed user list, used by the demo backend for POST /auth/login
 * (src/services/mock/routes/auth.js). It runs in the browser, so it is a demonstration, not security.
 * Checks, in this order:
 *   1. the account exists and the password matches  → reason "credentials" (never says which was wrong)
 *   2. the account is Active                        → reason "pending" or "inactive"
 *   3. the selected role is the account's role       → reason "role"
 * Returns { user } on success, or { error, reason, field, user? } — field is the form field to
 * highlight ("credentials", "role" or null) and user is set once the password has been confirmed.
 */
export function authenticateUser(users, login, password, roleId) {
  const user = findUser(users, login);
  if (!user || user.password !== password)
    return { error: "Invalid user ID or password. Please try again.", reason: "credentials", field: "credentials" };
  if (user.status === "Pending activation")
    return { error: "This account is waiting for an administrator to activate it.", reason: "pending", field: null, user };
  if (user.status !== "Active")
    return { error: "This account is inactive. Contact your administrator.", reason: "inactive", field: null, user };
  if (user.roleId !== roleId)
    return {
      error: `This account isn't registered as ${articleFor(roleName(roleId))} ${roleName(roleId)}.`,
      reason: "role",
      field: "role",
      user,
    };
  return { user };
}

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export const EMPLOYEE_ID_PATTERN = /^[A-Za-z]{2,4}-\d{3,6}$/;

/**
 * Checks a sign-up form. Returns an object of field → message; empty when valid.
 * form: { name, email, id, password, confirmPassword, roleId }
 */
export function validateSignUp(users, form) {
  const errors = {};
  const email = (form.email ?? "").trim();
  const id = (form.id ?? "").trim();
  if (!(form.name ?? "").trim()) errors.name = "Enter your full name.";
  if (!email) errors.email = "Enter your work email.";
  else if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = "Enter a valid email address.";
  else if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) errors.email = "An account with this email already exists.";
  if (!id) errors.id = "Enter your employee ID.";
  else if (!EMPLOYEE_ID_PATTERN.test(id)) errors.id = "Use the format USR-2044.";
  else if (users.some((u) => u.id.toLowerCase() === id.toLowerCase())) errors.id = "This employee ID is already registered.";
  const password = form.password ?? "";
  if (!password) errors.password = "Enter a password.";
  else if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    errors.password = "Use at least 8 characters with a letter and a number.";
  if (!form.confirmPassword) errors.confirmPassword = "Confirm your password.";
  else if (form.confirmPassword !== password) errors.confirmPassword = "Passwords don't match.";
  if (!SIGN_UP_ROLE_IDS.includes(form.roleId)) errors.roleId = "Select a role.";
  return errors;
}

export const FORECAST_MODELS = ["Moving Average", "Linear Regression", "ARIMA"];

/** Date range presets in the Global filters. The default view is the last 3 months of data. */
export const DATE_PRESETS = ["Last 30 Days", "Last 3 Months", "Last 6 Months", "Custom Range"];
export const DEFAULT_DATE_PRESET = "Last 3 Months";

/**
 * Global filters. Category, SKU, region and model are lists: several can be picked, and an empty list means
 * all. `status` (Safe / Warning / Critical) is used by the Inventory Supervisor dashboard's own filter.
 */
export const defaultFilters = {
  datePreset: DEFAULT_DATE_PRESET,
  startDate: "2025-03-19",
  endDate: "2025-06-18",
  category: [],
  sku: [],
  region: [],
  model: [],
  status: [],
};

/** The list filters, with the label used for "everything" when nothing is picked. */
export const LIST_FILTERS = {
  category: "All categories",
  sku: "All products",
  region: "All regions",
  model: "All models",
  status: "All statuses",
};

export const products = [
  {
    sku: "PP-4012",
    name: "Polypropylene 4012",
    category: "Polymers",
    location: "Central DC",
    region: "Central",
    channel: "Direct",
    unitPrice: 248,
    unitCost: 162,
    reorder: 650,
    safety: 300,
  },
  {
    sku: "PE-7820",
    name: "HDPE Resin 7820",
    category: "Polyethylene",
    location: "East Hub",
    region: "East",
    channel: "Distributor",
    unitPrice: 224,
    unitCost: 148,
    reorder: 400,
    safety: 220,
  },
  {
    sku: "CH-2155",
    name: "Glycol Industrial",
    category: "Chemicals",
    location: "East DC",
    region: "East",
    channel: "Direct",
    unitPrice: 316,
    unitCost: 204,
    reorder: 500,
    safety: 240,
  },
  {
    sku: "PC-3308",
    name: "Polycarbonate 3308",
    category: "Specialties",
    location: "West Hub",
    region: "West",
    channel: "Distributor",
    unitPrice: 382,
    unitCost: 255,
    reorder: 380,
    safety: 180,
  },
  {
    sku: "FE-1094",
    name: "Fertilizer Grade 1094",
    category: "Agri-Nutrients",
    location: "North Hub",
    region: "North",
    channel: "Direct",
    unitPrice: 174,
    unitCost: 108,
    reorder: 520,
    safety: 260,
  },
  {
    sku: "PS-5510",
    name: "Styrene Resin 5510",
    category: "Chemicals",
    location: "South DC",
    region: "South",
    channel: "Direct",
    unitPrice: 286,
    unitCost: 188,
    reorder: 450,
    safety: 200,
  },
  {
    sku: "AB-6621",
    name: "ABS Resin 6621",
    category: "Specialties",
    location: "Central Hub",
    region: "Central",
    channel: "Distributor",
    unitPrice: 344,
    unitCost: 226,
    reorder: 400,
    safety: 180,
  },
  {
    sku: "ME-7732",
    name: "Methanol Grade 7732",
    category: "Chemicals",
    location: "North DC",
    region: "North",
    channel: "Direct",
    unitPrice: 198,
    unitCost: 126,
    reorder: 420,
    safety: 190,
  },
  {
    sku: "EV-8843",
    name: "EVA Copolymer 8843",
    category: "Polymers",
    location: "West DC",
    region: "West",
    channel: "Distributor",
    unitPrice: 312,
    unitCost: 205,
    reorder: 500,
    safety: 240,
  },
  {
    sku: "UR-9954",
    name: "Urea Industrial 9954",
    category: "Agri-Nutrients",
    location: "South Hub",
    region: "South",
    channel: "Direct",
    unitPrice: 166,
    unitCost: 104,
    reorder: 480,
    safety: 200,
  },
  {
    sku: "LL-2468",
    name: "LLDPE Resin 2468",
    category: "Polyethylene",
    location: "East Hub",
    region: "East",
    channel: "Distributor",
    unitPrice: 236,
    unitCost: 152,
    reorder: 460,
    safety: 210,
  },
];

const initialStocks = {
  "PP-4012": 1240,
  "PE-7820": 184,
  "CH-2155": 470,
  "PC-3308": 820,
  "FE-1094": 290,
  "PS-5510": 730,
  "AB-6621": 360,
  "ME-7732": 500,
  "EV-8843": 910,
  "UR-9954": 440,
  "LL-2468": 680,
};

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/**
 * How each demo product sells, so all four demand types appear:
 *   smooth       – sells every day in steady amounts (the prototype's original pattern)
 *   erratic      – sells almost every day, amounts vary a lot
 *   intermittent – sells on about a third of days, steady amounts
 *   lumpy        – sells on about a third of days, amounts vary a lot
 */
export const DEMAND_PROFILES = {
  "PP-4012": { pattern: "smooth" },
  "PE-7820": { pattern: "smooth" },
  "CH-2155": { pattern: "smooth" },
  "PC-3308": { pattern: "smooth" },
  "LL-2468": { pattern: "smooth" },
  "FE-1094": { pattern: "erratic", base: 64, saleChance: 0.93, spread: 0.85 },
  "PS-5510": { pattern: "erratic", base: 72, saleChance: 0.95, spread: 0.9 },
  "AB-6621": { pattern: "intermittent", base: 78, saleChance: 0.36, spread: 0.12 },
  "ME-7732": { pattern: "intermittent", base: 66, saleChance: 0.32, spread: 0.12 },
  "EV-8843": { pattern: "lumpy", base: 95, saleChance: 0.3, spread: 0.95 },
  "UR-9954": { pattern: "lumpy", base: 84, saleChance: 0.34, spread: 1.0 },
};

/** Small deterministic random generator, so the demo data is the same on every load. */
function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSku(sku) {
  return [...sku].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
}

/** Units sold for every day 0..days-1 for one product. */
function dailyUnitsFor(product, productIndex, days) {
  const profile = DEMAND_PROFILES[product.sku] ?? { pattern: "smooth" };
  if (profile.pattern === "smooth") {
    return Array.from({ length: days }, (_, day) => {
      const weekly = Math.sin((day / 7) * Math.PI * 2) * 7;
      const trend = day * (0.09 + productIndex * 0.015);
      return Math.max(8, Math.round(58 + productIndex * 12 + weekly + trend + ((day * (productIndex + 3)) % 11)));
    });
  }
  const rand = seededRandom(hashSku(product.sku));
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
  return Array.from({ length: days }, () => {
    if (rand() > profile.saleChance) return 0;
    const size = profile.base * Math.exp(profile.spread * gaussian() - (profile.spread * profile.spread) / 2);
    return Math.max(1, Math.round(size));
  });
}

function salesRecord(product, productIndex, day, units, idPrefix) {
  const discountRate = (day + productIndex) % 13 === 0 ? 0.05 : (day + productIndex) % 7 === 0 ? 0.02 : 0;
  return {
    id: `${idPrefix}-${product.sku}-${day + 1}`,
    date: addDays(SAMPLE_START, day),
    sku: product.sku,
    category: product.category,
    location: product.location,
    region: product.region,
    channel: product.channel,
    units,
    unitPrice: product.unitPrice,
    discountRate,
    netRevenue: Number((units * product.unitPrice * (1 - discountRate)).toFixed(2)),
  };
}

/** Six months of demo sales: 19 Dec 2024 – 18 Jun 2025 (182 days). */
export const SAMPLE_START = "2024-12-19";
export const SAMPLE_DAYS = 182;
const PENDING_DAYS = 7; // 19–25 Jun 2025, the upload waiting to be cleaned

// A sales record looks like:
// { id, date: "YYYY-MM-DD", sku, category, location, region, channel, units, unitPrice, discountRate, netRevenue }
// Days without sales have no record (as in a real sales export).
export function createSampleSales() {
  const rows = [];
  products.forEach((product, productIndex) => {
    const units = dailyUnitsFor(product, productIndex, SAMPLE_DAYS + PENDING_DAYS);
    for (let day = 0; day < SAMPLE_DAYS; day += 1)
      if (units[day] > 0) rows.push(salesRecord(product, productIndex, day, units[day], "SAL"));
  });
  return rows;
}

/** The next week of sales (19–25 Jun 2025), used as a pending upload waiting to be cleaned. */
export function createPendingUploadRecords() {
  const rows = [];
  products.forEach((product, productIndex) => {
    const units = dailyUnitsFor(product, productIndex, SAMPLE_DAYS + PENDING_DAYS);
    // The demo week is an ordinary week: variable products stay within twice their usual order
    // size, so the only value the cleaning step caps is the keying error added below.
    const profile = DEMAND_PROFILES[product.sku];
    const ceiling = profile?.base ? Math.round(profile.base * 2) : Infinity;
    for (let day = SAMPLE_DAYS; day < SAMPLE_DAYS + PENDING_DAYS; day += 1)
      if (units[day] > 0) rows.push(salesRecord(product, productIndex, day, Math.min(units[day], ceiling), "UPL-JUN"));
  });
  // A keying error the cleaning step should catch: one value entered ten times too high.
  const spike = rows.find((row) => row.sku === "CH-2155" && row.date === "2025-06-21");
  if (spike) {
    spike.units = spike.units * 10;
    spike.netRevenue = Number((spike.units * spike.unitPrice * (1 - spike.discountRate)).toFixed(2));
  }
  return rows;
}

/** Safe / Warning (shown as "Low") / Critical, from stock vs. reorder level and safety stock. */
export function inventoryStatus(stock, product) {
  return stock <= product.safety * 1.15 ? "Critical" : stock < product.reorder ? "Warning" : "Safe";
}

function deriveInventory(product, stock, demand) {
  const status = inventoryStatus(stock, product);
  const suggested = status === "Safe" ? 0 : Math.max(0, Math.round(demand + product.safety - stock));
  return { ...product, stock, demand, status, suggested, days: Math.max(1, Math.round(stock / (demand / 30))) };
}

/**
 * The inventory record of a product added from an uploaded file (newProduct from importSales, with its
 * records in the file). Its safety stock and reorder level start at 7 and 14 days of its average daily sales
 * in the file, its 30-day demand at 30 days of them; its stock is the file's, or 0. Its cost isn't known.
 */
export function inventoryForNewProduct(newProduct, records) {
  const dates = records.map((record) => record.date).sort();
  const days = dates.length ? Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000) + 1 : 1;
  const perDay = records.reduce((sum, record) => sum + record.units, 0) / days;
  const safety = Math.max(1, Math.round(perDay * 7));
  const product = {
    sku: newProduct.sku,
    name: newProduct.name,
    category: newProduct.category,
    location: newProduct.location,
    region: newProduct.region,
    channel: newProduct.channel,
    unitPrice: newProduct.unitPrice,
    unitCost: null,
    reorder: Math.max(safety + 1, Math.round(perDay * 14)),
    safety,
  };
  return deriveInventory(product, newProduct.stock ?? 0, Math.max(1, Math.round(perDay * 30)));
}

export function createInitialInventory() {
  return products.map((product) => {
    const stock = initialStocks[product.sku];
    const demand =
      product.sku === "PP-4012"
        ? 890
        : product.sku === "PE-7820"
          ? 760
          : product.sku === "CH-2155"
            ? 590
            : product.sku === "PC-3308"
              ? 510
              : 840;
    return deriveInventory(product, stock, demand);
  });
}

/** A list filter's picked values: [] (all) for a missing value or an "All …" label, a single value as a list. */
export function filterList(value) {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined && v !== null && v !== "" && !String(v).startsWith("All "));
  if (value === undefined || value === null || value === "" || String(value).startsWith("All ")) return [];
  return [value];
}

/** Does a value pass a list filter? (An empty list lets everything through.) */
export const inList = (list, value) => !list.length || list.includes(value);

/** Filters with every list filter as a list, and the default dates when missing. */
export function normalizeFilters(value) {
  const safe = value && typeof value === "object" ? { ...defaultFilters, ...value } : { ...defaultFilters };
  for (const key of Object.keys(LIST_FILTERS)) safe[key] = filterList(safe[key]);
  return safe;
}

/** Sales records in the date range for the picked categories, products and regions. */
export function filterSales(records, filters) {
  const safe = normalizeFilters(filters);
  return records.filter(
    (row) =>
      row.date >= safe.startDate &&
      row.date <= safe.endDate &&
      inList(safe.category, row.category) &&
      inList(safe.sku, row.sku) &&
      inList(safe.region, row.region),
  );
}

/** Products for the picked categories, products, regions and stock statuses. */
export function filterInventory(records, filters) {
  const safe = normalizeFilters(filters);
  return records.filter(
    (row) => inList(safe.category, row.category) && inList(safe.sku, row.sku) && inList(safe.region, row.region) && inList(safe.status, row.status),
  );
}

/** The picked list filters as text, e.g. "Polymers, Chemicals · Central" ("" when nothing is picked). */
export function describeFilters(filters, keys = ["category", "sku", "region", "model"]) {
  const safe = normalizeFilters(filters);
  return keys
    .map((key) => safe[key].join(", "))
    .filter(Boolean)
    .join(" · ");
}

/** Saved forecast runs for the picked models and for products that pass the other filters (newest first, as given). */
export function filterForecasts(forecasts, filters, inventory) {
  const safe = normalizeFilters(filters);
  const skus = inventory ? new Set(filterInventory(inventory, { ...safe, status: [] }).map((row) => row.sku)) : null;
  return forecasts.filter((run) => inList(safe.model, run.model) && (!skus || skus.has(run.sku)));
}

export function calculateMetrics(sales, inventory, forecast) {
  const actualPoints = forecast?.points.filter((point) => typeof point.actual === "number") || [];
  const mape = actualPoints.length
    ? (actualPoints.reduce((sum, point) => sum + Math.abs((point.actual - point.forecast) / point.actual), 0) /
        actualPoints.length) *
      100
    : null;
  return {
    revenue: sales.reduce((sum, row) => sum + row.netRevenue, 0),
    units: sales.reduce((sum, row) => sum + row.units, 0),
    activeSkus: new Set(sales.map((row) => row.sku)).size,
    forecastDemand: forecast ? forecast.points.reduce((sum, point) => sum + point.forecast, 0) : 0,
    forecastAccuracy: mape === null ? null : Math.max(0, 100 - mape),
    inventoryValue: inventory.reduce((sum, row) => sum + row.stock * row.unitCost, 0),
    belowReorder: inventory.filter((row) => row.stock < row.reorder).length,
    critical: inventory.filter((row) => row.status === "Critical").length,
  };
}

/** Units per day for the days that have sales, oldest first (sorted on the full date, so ranges can cross a year end). */
export function aggregateDaily(records) {
  const grouped = new Map();
  records.forEach((row) => grouped.set(row.date, (grouped.get(row.date) || 0) + row.units));
  return Array.from(grouped, ([date, value]) => ({ date, label: date.slice(5), value })).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/**
 * Units per day for every day from startDate to endDate (0 on days without sales) — the same
 * zero-filled history the forecasting models use. Without dates, the first and last sale dates are used.
 */
export function dailySeries(records, startDate, endDate) {
  const grouped = new Map();
  let first = startDate;
  let last = endDate;
  for (const row of records) {
    if (!startDate && (!first || row.date < first)) first = row.date;
    if (!endDate && (!last || row.date > last)) last = row.date;
    grouped.set(row.date, (grouped.get(row.date) || 0) + row.units);
  }
  if (!first || !last || first > last) return [];
  const series = [];
  for (let date = first; date <= last; date = addDays(date, 1)) series.push({ date, value: grouped.get(date) || 0 });
  return series;
}

export function aggregateCategories(records) {
  const grouped = new Map();
  records.forEach((row) => grouped.set(row.category, (grouped.get(row.category) || 0) + row.units));
  return Array.from(grouped, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/** Current stock summed per category (with the number of products), largest first. */
export function stockByCategory(inventory) {
  const grouped = new Map();
  for (const row of inventory) {
    const entry = grouped.get(row.category) ?? { label: row.category, value: 0, products: [] };
    entry.value += row.stock;
    entry.products.push(row.sku);
    grouped.set(row.category, entry);
  }
  return [...grouped.values()].sort((a, b) => b.value - a.value);
}

/** The newest forecast run whose SKU is among the given sales rows (forecast history is newest first). */
export function forecastInView(forecastHistory, sales) {
  const skus = new Set(sales.map((row) => row.sku));
  return forecastHistory.find((run) => skus.has(run.sku)) ?? null;
}

/**
 * Daily units for one SKU, with every day in the range present (0 on days without sales).
 * The range defaults to the first and last date found in `records`.
 */
export function demandSeries(records, sku, startDate, endDate) {
  const grouped = new Map();
  let first = startDate;
  let last = endDate;
  for (const row of records) {
    if (!startDate && (!first || row.date < first)) first = row.date;
    if (!endDate && (!last || row.date > last)) last = row.date;
    if (row.sku === sku) grouped.set(row.date, (grouped.get(row.date) || 0) + row.units);
  }
  if (!first || !last || first > last) return [];
  return datesBetween(first, last).map((date) => ({ date, units: grouped.get(date) || 0 }));
}

let lastDates = { key: "", dates: [] };
/** Every date from first to last (the last list is kept: many series are built over the same range). */
function datesBetween(first, last) {
  const key = `${first}|${last}`;
  if (lastDates.key !== key) {
    const dates = [];
    for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date);
    lastDates = { key, dates };
  }
  return lastDates.dates;
}

function evaluate(actual, predicted) {
  if (!actual.length || actual.length !== predicted.length) return { mae: null, rmse: null, mape: null };
  const errors = actual.map((value, index) => value - predicted[index]);
  return {
    mae: errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length),
    mape: actual.some((value) => value === 0)
      ? null
      : (actual.reduce((sum, value, index) => sum + Math.abs((value - predicted[index]) / value), 0) / actual.length) *
        100,
  };
}

function linearFit(values) {
  const n = values.length;
  const sumX = ((n - 1) * n) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + index * value, 0);
  const sumXX = values.reduce((sum, _, index) => sum + index * index, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  return { slope, intercept: (sumY - slope * sumX) / n };
}

/**
 * Runs a forecast for one SKU.
 * options: { sku, model: "Moving Average" | "Linear Regression" | "ARIMA", horizon, windowSize?, order?: [p, d, q],
 *            startDate?, endDate? }  (the history range; days without sales count as 0)
 * Moving Average uses a 7-day window unless windowSize is given.
 * Returns { model, sku, horizon, points: [{ period, date, forecast }], mae, rmse, mape, holdoutDays, generatedAt, configuration }.
 * Accuracy (MAE / RMSE / MAPE) is measured on the most recent periods held back from fitting (holdoutDays of them).
 */
export function runForecast(records, options) {
  const series = demandSeries(records, options.sku, options.startDate, options.endDate);
  if (series.length < 21) throw new Error("At least 21 historical periods are required to run this forecast.");
  const values = series.map((point) => point.units);
  const evaluationSize = Math.min(14, Math.floor(values.length / 4));
  const train = values.slice(0, -evaluationSize);
  const evaluationActual = values.slice(-evaluationSize);
  let evaluationPredicted = [];
  let future = [];
  const configuration = { horizon: options.horizon };

  if (options.model === "Moving Average") {
    const window = Math.max(2, Math.min(options.windowSize || 7, train.length));
    configuration.windowSize = window;
    const evolving = [...train];
    evaluationPredicted = evaluationActual.map(() => {
      const prediction = evolving.slice(-window).reduce((sum, value) => sum + value, 0) / window;
      evolving.push(prediction);
      return prediction;
    });
    const futureValues = [...values];
    future = Array.from({ length: options.horizon }, () => {
      const prediction = futureValues.slice(-window).reduce((sum, value) => sum + value, 0) / window;
      futureValues.push(prediction);
      return prediction;
    });
  } else if (options.model === "Linear Regression") {
    const evaluationFit = linearFit(train);
    evaluationPredicted = evaluationActual.map(
      (_, index) => evaluationFit.intercept + evaluationFit.slope * (train.length + index),
    );
    const fit = linearFit(values);
    configuration.slope = Number(fit.slope.toFixed(4));
    future = Array.from({ length: options.horizon }, (_, index) => fit.intercept + fit.slope * (values.length + index));
  } else {
    const order = options.order ?? [2, 1, 2];
    const problem = validateArimaOrder(order);
    if (problem) throw new Error(problem);
    const [p, d, q] = order;
    configuration.order = [p, d, q]; // the same [p, d, q] the request sends
    evaluationPredicted = arimaForecast(train, evaluationSize, p, d, q);
    future = arimaForecast(values, options.horizon, p, d, q);
  }

  const metrics = evaluate(
    evaluationActual,
    evaluationPredicted.map((v) => Math.max(0, v)),
  );
  const lastDate = series.at(-1).date;
  return {
    model: options.model,
    sku: options.sku,
    horizon: options.horizon,
    points: future.map((value, index) => ({
      period: index + 1,
      date: addDays(lastDate, index + 1),
      forecast: Math.max(0, Math.round(value)),
    })),
    mae: metrics.mae,
    rmse: metrics.rmse,
    mape: metrics.mape,
    holdoutDays: evaluationSize,
    generatedAt: new Date().toISOString(),
    configuration,
  };
}

/** Short label for a run's settings: "Window: 7", "Order (2,1,2)" or "Time trend". */
export function describeConfiguration(result) {
  if (result.model === "Moving Average") return `Window: ${result.configuration.windowSize}`;
  if (result.model === "ARIMA") return `Order (${result.configuration.order})`;
  return "Time trend";
}

/**
 * Splits delimited text (CSV, or tab-separated) into rows of cells: quoted cells may hold the delimiter, line
 * breaks and doubled quotes. Blank lines are dropped.
 */
export function splitDelimited(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * The delimiter of a text file — comma, tab, semicolon or pipe: the one that splits the most of its first
 * lines into the same number of cells (a title line above the table doesn't matter).
 */
export function detectDelimiter(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).slice(0, 25);
  let best = { delimiter: ",", lines: 0, cells: 1 };
  for (const delimiter of [",", "\t", ";", "|"]) {
    const widths = lines.map((line) => splitDelimited(line, delimiter)[0]?.length ?? 1).filter((width) => width > 1);
    const tally = new Map();
    for (const width of widths) tally.set(width, (tally.get(width) ?? 0) + 1);
    for (const [cells, count] of tally)
      if (count > best.lines || (count === best.lines && cells > best.cells)) best = { delimiter, lines: count, cells };
  }
  return best.delimiter;
}

/**
 * Validates the rows of an uploaded sales file (the header row included) against the product catalog: any
 * layout, see src/lib/salesImport.js. The demo backend passes its products; tests use the built-in list.
 */
export function parseSalesTable(rows, catalog = products) {
  return importSales(rows, catalog);
}

/** Validates an uploaded CSV, or tab- or semicolon-separated text. */
export function parseSalesCsv(text, catalog = products) {
  return importSales(splitDelimited(text, detectDelimiter(text)), catalog);
}

/** "Valid", "3 warnings" or "Failed": the label shown in the dataset history. */
export function validationLabel(v) {
  if (v.errors.length || v.valid === 0) return "Failed";
  const warnings = v.missing + v.duplicates + v.invalidDates + v.invalidNumeric;
  return warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "Valid";
}

// ---------------------------------------------------------------------------
// Datasets and the Uploaded → Cleaned → Forecasted pipeline
// ---------------------------------------------------------------------------
//
// A dataset (one upload) as the demo backend stores it:
// {
//   id, fileName, uploadedAt, uploaderId, uploader, recordCount,
//   validation: "Valid" | "3 warnings" | "Failed",
//   checks: { total, valid, missing, duplicates, invalidDates, invalidNumeric },
//   coverage: { firstDate, lastDate, products } or null,  // what its valid records cover
//   cleaning: "Pending" | "Completed" | "Not started",
//   cleanedAt,                               // ISO date string or null
//   pendingRecords: [...],                   // validated sales records waiting to be cleaned, each with datasetId
//   cleaningSummary: { inputRecords, excludedAtValidation, outliersCapped, replaced, skipped, added, cleanedBy, cleanedAt } or null,
//   error
// }
// Cleaning merges its records (keeping their datasetId) into the shared sales history. Its forecasting
// status isn't stored: it is worked out from the saved forecasts' lineage (lib/lineage.js).

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Cleans a validated upload and merges it into the shared sales data.
 * - Extreme spikes are capped to Q3 + 3×IQR of that SKU's history (optional).
 * - Records for a date/SKU that already exists either replace it or are skipped.
 */
export function cleanDataset(pending, existing, options, excludedAtValidation, cleanedBy) {
  let outliersCapped = 0;
  const cleaned = pending.map((row) => ({ ...row }));

  if (options.capOutliers) {
    const skus = new Set(cleaned.map((row) => row.sku));
    for (const sku of skus) {
      const history = [...existing, ...cleaned]
        .filter((row) => row.sku === sku)
        .map((row) => row.units)
        .sort((a, b) => a - b);
      if (history.length < 8) continue;
      const q1 = quantile(history, 0.25);
      const q3 = quantile(history, 0.75);
      const upper = q3 + 3 * Math.max(q3 - q1, 1);
      for (const row of cleaned) {
        if (row.sku === sku && row.units > upper) {
          row.units = Math.round(upper);
          row.netRevenue = Number((row.units * row.unitPrice * (1 - row.discountRate)).toFixed(2));
          outliersCapped += 1;
        }
      }
    }
  }

  const byKey = new Map(existing.map((row) => [`${row.date}|${row.sku}`, row]));
  let replaced = 0;
  let skipped = 0;
  let added = 0;
  for (const row of cleaned) {
    const key = `${row.date}|${row.sku}`;
    if (byKey.has(key)) {
      if (options.overlap === "replace") {
        byKey.set(key, row);
        replaced += 1;
      } else skipped += 1;
    } else {
      byKey.set(key, row);
      added += 1;
    }
  }
  const merged = Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku));
  return {
    merged,
    summary: {
      inputRecords: pending.length,
      excludedAtValidation,
      outliersCapped,
      replaced,
      skipped,
      added,
      cleanedBy,
      cleanedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function updateInventoryRecord(records, sku, stock) {
  return records.map((row) => (row.sku === sku ? deriveInventory(row, stock, row.demand) : row));
}

/** Uses a forecast run to set the SKU's 30-day demand, then recalculates its suggestion and status. */
export function applyForecastToInventory(records, result) {
  if (!result.points.length) return records;
  const perDay = result.points.reduce((sum, point) => sum + point.forecast, 0) / result.points.length;
  const demand = Math.max(1, Math.round(perDay * 30));
  return records.map((row) => (row.sku === result.sku ? deriveInventory(row, row.stock, demand) : row));
}

export function reportRows(sales, inventory) {
  return sales.map((row) => {
    const item = inventory.find((record) => record.sku === row.sku);
    return {
      Date: row.date,
      SKU: row.sku,
      Category: row.category,
      Region: row.region,
      Warehouse: row.location,
      Channel: row.channel,
      Units: row.units,
      "Net Revenue": row.netRevenue,
      "Current Stock": item?.stock ?? "",
    };
  });
}

/** Earliest and latest sale dates. */
export function dateBounds(sales) {
  let start = defaultFilters.startDate;
  let end = defaultFilters.endDate;
  if (sales.length) {
    start = sales[0].date;
    end = sales[0].date;
    for (const row of sales) {
      if (row.date < start) start = row.date;
      if (row.date > end) end = row.date;
    }
  }
  return { start, end };
}

/** Adds whole calendar months to a YYYY-MM-DD date (day clamped to the month's length). */
export function addMonths(dateString, months) {
  const [y, m, d] = dateString.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return isoDate(target);
}

/** Date presets relative to the latest sales date: Last 30 Days, Last 3 Months, Last 6 Months. */
export function presetRange(preset, latest, earliest) {
  let from;
  if (preset === "Last 30 Days") from = addDays(latest, -29);
  else if (preset === "Last 3 Months") from = addDays(addMonths(latest, -3), 1);
  else if (preset === "Last 6 Months") from = addDays(addMonths(latest, -6), 1);
  else return null;
  return [from < earliest ? earliest : from, latest];
}

// ---------------------------------------------------------------------------
// Demand type classification (Syntetos–Boylan)
// ---------------------------------------------------------------------------

export const DEMAND_TYPES = ["Smooth", "Erratic", "Intermittent", "Lumpy"];
export const NOT_ENOUGH_DATA = "Not enough data";

/**
 * Classifies one product's daily units (one value per day in the range, zeros included).
 *   ADI = days in the range ÷ days with sales
 *   CV² = (standard deviation ÷ mean of the non-zero daily sales)²
 * Fewer than 2 sale days → "Not enough data".
 */
export function classifyDemand(dailyUnits) {
  const nonZero = dailyUnits.filter((units) => units > 0);
  if (nonZero.length < 2) return { type: NOT_ENOUGH_DATA, adi: null, cv2: null, saleDays: nonZero.length, days: dailyUnits.length };
  const adi = dailyUnits.length / nonZero.length;
  const mean = nonZero.reduce((sum, v) => sum + v, 0) / nonZero.length;
  const variance = nonZero.reduce((sum, v) => sum + (v - mean) ** 2, 0) / nonZero.length;
  const cv2 = variance / (mean * mean);
  const type = adi < 1.32 ? (cv2 < 0.49 ? "Smooth" : "Erratic") : cv2 < 0.49 ? "Intermittent" : "Lumpy";
  return { type, adi, cv2, saleDays: nonZero.length, days: dailyUnits.length };
}

/**
 * Classifies every product in `skus` over startDate..endDate using the (already filtered) sales.
 * Returns { rows: [{ sku, type, adi, cv2, saleDays, days }], counts: { Smooth, Erratic, Intermittent, Lumpy, "Not enough data" } }.
 */
export function classifyProducts(sales, skus, startDate, endDate) {
  const counts = { Smooth: 0, Erratic: 0, Intermittent: 0, Lumpy: 0, [NOT_ENOUGH_DATA]: 0 };
  const own = salesBySku(sales, skus, startDate, endDate);
  const rows = skus.map((sku) => {
    const series = demandSeries(own(sku), sku, startDate, endDate);
    const result = classifyDemand(series.map((point) => point.units));
    counts[result.type] += 1;
    return { sku, ...result };
  });
  return { rows, counts };
}

/**
 * sku → that product's sales, grouped in one pass (so working through many products doesn't read every sale
 * once per product). Only when both dates are given: without them, a series runs over every product's dates.
 */
function salesBySku(sales, skus, startDate, endDate) {
  if (!startDate || !endDate) return () => sales;
  const groups = new Map(skus.map((sku) => [sku, []]));
  for (const row of sales) groups.get(row.sku)?.push(row);
  return (sku) => groups.get(sku) ?? [];
}

/** Settings used when the three existing models are compared (the Forecasting page defaults). */
export const COMPARISON_SETTINGS = { horizon: 30, windowSize: 7, order: [2, 1, 2] };
/** Fewest held-out test days for a comparison to count as reliable. */
export const MIN_TEST_DAYS = 7;

/**
 * Compares Moving Average, Linear Regression and ARIMA on the same products and the same held-out days.
 * Each model is fitted on each product's daily sales in startDate..endDate (days without sales count as 0)
 * and tested on the most recent days it did not see — the evaluation every forecast run uses.
 *
 * The metric is MAPE when every tested model has it for every product (it is scale-free); otherwise MAE,
 * because MAPE can't be calculated when the test days include zero sales. A model is eligible only when it
 * could be tested on every product. The recommendation is the eligible model with the lowest average metric
 * (RMSE breaks a tie). When there are no products, too few test days, or fewer than two eligible models,
 * `recommended` is null and `reason` says why.
 */
export function compareModelsForProducts(sales, skus, startDate, endDate, settings = COMPARISON_SETTINGS) {
  const days = startDate && endDate ? Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1 : 0;
  const testDays = Math.min(14, Math.floor(days / 4));
  const own = salesBySku(sales, skus, startDate, endDate);
  const models = FORECAST_MODELS.map((model) => {
    const products = skus.map((sku) => {
      try {
        const run = runForecast(own(sku), { ...settings, sku, model, startDate, endDate });
        return { sku, mae: run.mae, rmse: run.rmse, mape: run.mape };
      } catch (error) {
        return { sku, error: error instanceof Error ? error.message : "The model could not be run." };
      }
    });
    const tested = products.filter((p) => !p.error);
    const average = (key) => (tested.length && tested.every((p) => p[key] != null) ? tested.reduce((sum, p) => sum + p[key], 0) / tested.length : null);
    return {
      model,
      products,
      tested: tested.length,
      eligible: skus.length > 0 && tested.length === skus.length,
      error: products.find((p) => p.error)?.error ?? null,
      mae: average("mae"),
      rmse: average("rmse"),
      mape: average("mape"),
      wins: 0,
    };
  });

  const eligible = models.filter((m) => m.eligible);
  const metric = eligible.length && eligible.every((m) => m.mape != null) ? "mape" : "mae";
  // Most accurate model on each product, on the same metric
  skus.forEach((_, index) => {
    const best = eligible
      .map((m) => ({ m, value: m.products[index][metric] }))
      .filter((c) => c.value != null)
      .sort((a, b) => a.value - b.value)[0];
    if (best) best.m.wins += 1;
  });
  const ranked = [...eligible].sort((a, b) => a[metric] - b[metric] || (a.rmse ?? 0) - (b.rmse ?? 0));

  let reason = null;
  if (!skus.length) reason = "There are no products of this demand type in the current filters.";
  else if (testDays < MIN_TEST_DAYS)
    reason = `The selected date range has ${days} days, so only ${testDays} days could be held back to test the models; at least ${MIN_TEST_DAYS} are needed. Choose a longer date range.`;
  else if (eligible.length < 2) {
    const failed = models.filter((m) => !m.eligible);
    reason =
      eligible.length === 1
        ? `Only ${eligible[0].model} could be tested on these products, so there is nothing to compare it with (${failed.map((m) => `${m.model}: ${m.error}`).join(" ")})`
        : `None of the models could be tested on these products (${models[0].error})`;
  }

  const recommended = reason ? null : ranked[0];
  const runnerUp = reason ? null : ranked[1];
  const margin = recommended && runnerUp && runnerUp[metric] > 0 ? (runnerUp[metric] - recommended[metric]) / runnerUp[metric] : null;
  return { models, ranked, metric, recommended: recommended?.model ?? null, reason, days, testDays, margin, close: margin != null && margin < 0.03 };
}

// ---------------------------------------------------------------------------
// Monthly inventory trends (from month-end snapshots)
// ---------------------------------------------------------------------------

/** Snapshot statuses in chart order. "Warning" is shown as "Low". */
export const TREND_STATUSES = [
  { key: "Safe", label: "Safe" },
  { key: "Warning", label: "Low" },
  { key: "Critical", label: "Critical" },
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Calendar months ("YYYY-MM") that overlap startDate..endDate. */
export function monthsInRange(startDate, endDate) {
  const months = [];
  let [y, m] = startDate.slice(0, 7).split("-").map(Number);
  const [ey, em] = endDate.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/**
 * For each month in the range: units in stock and number of products per status, read from that
 * month's snapshot. Months without a snapshot have hasData = false (values are never estimated).
 * Only SKUs in `skus` are counted (pass the products that match the global filters).
 */
export function monthlyInventoryTrend(snapshots, startDate, endDate, skus) {
  const allowed = skus ? new Set(skus) : null;
  return monthsInRange(startDate, endDate).map((month) => {
    const snapshot = snapshots.find((s) => s.month === month);
    const groups = Object.fromEntries(TREND_STATUSES.map(({ key }) => [key, { units: 0, products: 0 }]));
    if (snapshot) {
      for (const item of snapshot.items) {
        if (allowed && !allowed.has(item.sku)) continue;
        groups[item.status].units += item.stock;
        groups[item.status].products += 1;
      }
    }
    return { month, label: monthLabel(month), asOf: snapshot?.asOf ?? null, hasData: Boolean(snapshot), groups };
  });
}

/** Sets one SKU's stock in a month's snapshot (creating the snapshot if needed). */
export function updateSnapshot(snapshots, month, asOf, item, product) {
  return updateSnapshotItems(snapshots, month, asOf, [{ item, product }]);
}

/** Sets several SKUs' stock in a month's snapshot at once: changes [{ item: { sku, stock }, product }]. */
export function updateSnapshotItems(snapshots, month, asOf, changes) {
  const entries = new Map(changes.map(({ item, product }) => [item.sku, { sku: item.sku, stock: item.stock, status: inventoryStatus(item.stock, product) }]));
  if (!entries.size) return snapshots;
  if (!snapshots.some((s) => s.month === month)) return [...snapshots, { month, asOf, items: [...entries.values()] }];
  return snapshots.map((s) => {
    if (s.month !== month) return s;
    const present = new Set(s.items.map((i) => i.sku));
    const added = [...entries.values()].filter((entry) => !present.has(entry.sku));
    return { ...s, asOf, items: [...s.items.map((i) => entries.get(i.sku) ?? i), ...added] };
  });
}
