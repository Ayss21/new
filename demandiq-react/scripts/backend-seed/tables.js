// The backend's database tables, filled with the records the demo backend starts with — so FastAPI can serve
// the same data the app shows in demo mode.
//
// buildTables(db) turns the demo backend's database (src/services/mock/db.js, built from src/data/seed.js)
// into table rows. writers.js turns the tables into PostgreSQL (schema.sql, seed.sql), CSV and JSON, and
// export.mjs runs both: npm run export:seed.
//
// Values the app works out from other data are not stored — inventory status, suggested order and days of
// cover, products per category, an upload's validation label, pending count and forecasting status. The
// views in views.sql work them out the same way the demo backend does.
import { ALL_REPORTS, EXPORT_FORMATS, PERMISSION_ACTIONS, PERMISSION_OPTIONS, PERMISSION_SCREEN, REPORTS_BY_ROLE } from "../../src/data/seed";
import { FORECAST_MODELS } from "../../src/lib/domain";
import { ADMIN_VIEW_ONLY } from "../../src/lib/permissions";
import { ROLE, ROLE_IDS, roleName } from "../../src/lib/roles";
import { ADMIN_SCREEN, SCREENS } from "../../src/navigation";

const LEVELS = ["Yes", "View", "Review", "No"];
const USER_STATUSES = ["Active", "Pending activation", "Inactive"];
const EVENT_STATUSES = ["Completed", "Failed", "Pending"];
const SEVERITIES = ["Info", "Warning", "Error", "Critical"];
const ERROR_STATUSES = ["Open", "Investigating", "Resolved"];
const CATEGORY_STATUSES = ["Active", "Inactive"];
const STOCK_STATUSES = ["Safe", "Warning", "Critical"];
const REORDER_STATUSES = ["Ordered", "Delivered"];
const CLEANING_STATUSES = ["Not started", "Pending", "Completed"];
const REPORT_STATUSES = ["Processing", "Completed", "Failed"];
const REPORT_FORMATS = EXPORT_FORMATS.map((format) => format.value);
const SOURCE_KINDS = ["used", "waiting"];

/** The API data dictionary's mark for a column the API doesn't send. */
const NOT_SENT = "(not sent)";

/** "status IN ('A', 'B')" */
const oneOf = (column, values) => `${column} IN (${values.map((v) => `'${v}'`).join(", ")})`;

/**
 * A column. options:
 *   pk       part of the primary key            null     may be NULL (columns are NOT NULL otherwise)
 *   ref      foreign key to this table's key    onDelete what deleting the referenced row does (CASCADE)
 *   unique   UNIQUE                             check    a CHECK expression
 *   default  SQL default                        id       [prefix, digits]: IDs like FC-0012 from a sequence
 *   api      the JSON field (docs/API_CONTRACT.md) when its name or place differs
 *   note     what it holds (a COMMENT in schema.sql, and the data dictionary)
 *   file     its name in the CSV and JSON files when that differs
 */
const col = (name, type, options = {}) => ({ name, type, ...options });

/** A password: seed.sql hashes it with pgcrypto; the CSV and JSON files carry the demo password itself. */
export class DemoPassword {
  constructor(plain) {
    this.plain = plain;
  }
}

function check(condition, message) {
  if (!condition) throw new Error(`Backend seed: ${message}`);
}

/** Checks that every row has exactly the table's columns, then returns the table. */
function table(name, spec) {
  const names = spec.columns.map((c) => c.name);
  for (const row of spec.rows) {
    const keys = Object.keys(row);
    check(keys.length === names.length && names.every((n) => n in row), `${name}: a row has [${keys.join(", ")}], expected [${names.join(", ")}]`);
  }
  return { name, checks: [], uniques: [], indexes: [], ...spec };
}

const byId = (rows, key = "id") => new Map(rows.map((row) => [row[key], row]));

/**
 * Every table, in the order they must be loaded (a table only refers to tables before it).
 * db: the demo backend's database — db() from src/services/mock/db.js after resetForTests().
 */
export function buildTables(db) {
  const users = byId(db.users);
  const userIdByName = new Map(db.users.map((u) => [u.name, u.id]));
  const categoryIdByName = new Map(db.categories.map((c) => [c.name, c.id]));
  const products = byId(db.inventory, "sku");
  const datasets = byId(db.datasets);
  /** SKU → the upload that added it to the catalog. */
  const addedFrom = new Map(db.datasets.flatMap((d) => (d.newProducts ?? []).map((sku) => [sku, d.id])));

  /** A sales record's product attributes must be its product's: the database takes them from products. */
  const sameAsProduct = (record, where) => {
    const product = products.get(record.sku);
    check(product, `${where} ${record.id}: unknown product ${record.sku}`);
    for (const key of ["category", "location", "region", "channel"])
      check(record[key] === product[key], `${where} ${record.id}: ${key} "${record[key]}" isn't its product's "${product[key]}"`);
  };
  const userId = (name, where) => {
    check(userIdByName.has(name), `${where}: no user is named "${name}"`);
    return userIdByName.get(name);
  };

  // ---------------------------------------------------------------------------
  // Access: roles, screens, permissions, report types
  // ---------------------------------------------------------------------------

  const roles = table("roles", {
    area: "Access",
    about: "The four roles. Every check uses the role ID; the name is only a label.",
    used: "GET /auth/roles · the sign-in page's role picker",
    columns: [
      col("role_id", "SMALLINT", { pk: true, api: "roleId", note: "1 Store Manager, 2 Data Analyst, 3 Inventory Supervisor, 4 Admin" }),
      col("name", "TEXT", { unique: true }),
    ],
    rows: ROLE_IDS.map((id) => ({ role_id: id, name: roleName(id) })),
  });

  const screens = table("screens", {
    area: "Access",
    about: "The six screens. Every role keeps the Dashboard (SCR-01); only the Admin role has Administration (SCR-06).",
    used: "GET /auth/roles, GET /roles/screens · the top navigation",
    columns: [
      col("screen_id", "TEXT", { pk: true, api: "`screens` (the lists of screen IDs)", check: "screen_id ~ '^SCR-[0-9]{2}$'", note: "SCR-01 … SCR-06" }),
      col("name", "TEXT", { api: NOT_SENT, note: "Its name in the navigation" }),
      col("path", "TEXT", { unique: true, api: NOT_SENT, note: "Its address in the app: #/<path>" }),
    ],
    rows: SCREENS.map((s) => ({ screen_id: s.id, name: s.label, path: s.path })),
  });

  const roleScreens = table("role_screens", {
    area: "Access",
    about: "Which screens each role can open (Administration → Role Permissions → Screen access).",
    used: "POST /auth/login and GET /auth/me (screens), GET /auth/roles, GET /roles/screens, PUT /roles/{roleId}/screens, POST /roles/restore-defaults",
    columns: [
      col("role_id", "SMALLINT", { pk: true, ref: "roles", onDelete: "CASCADE" }),
      col("screen_id", "TEXT", { pk: true, ref: "screens", onDelete: "CASCADE" }),
    ],
    checks: [`screen_id <> '${ADMIN_SCREEN}' OR role_id = ${ROLE.ADMIN}`],
    rows: ROLE_IDS.flatMap((roleId) => (db.screenAccess[roleId] ?? []).map((screenId) => ({ role_id: roleId, screen_id: screenId }))),
  });

  const permissionActions = table("permission_actions", {
    area: "Access",
    about: "The seven actions of the permission matrix, the screen each is carried out on, and the values an Admin can give them.",
    used: "GET /roles/permissions, PATCH /roles/permissions (allowed values, 422)",
    columns: [
      col("action", "TEXT", { pk: true, note: "Its name in the API, e.g. Upload sales" }),
      col("screen_id", "TEXT", { ref: "screens", api: NOT_SENT, note: "Where it is carried out: a role that can't open this screen has No for it, whatever role_permissions says" }),
      col("allowed_levels", "TEXT[]", { api: NOT_SENT, note: "The values an Admin can choose for it (anything else is a 422)" }),
      col("position", "SMALLINT", { unique: true, api: NOT_SENT, note: "Row order in the matrix" }),
    ],
    rows: PERMISSION_ACTIONS.map((action, index) => ({
      action,
      screen_id: PERMISSION_SCREEN[action],
      allowed_levels: PERMISSION_OPTIONS[action],
      position: index + 1,
    })),
  });

  const rolePermissions = table("role_permissions", {
    area: "Access",
    about: "The permission matrix as the Admin set it: each role's level for each action.",
    used: "POST /auth/login and GET /auth/me (permissions, via effective_permissions), GET/PATCH /roles/permissions, POST /roles/restore-defaults; every action check (403)",
    columns: [
      col("action", "TEXT", { pk: true, ref: "permission_actions", onDelete: "CASCADE" }),
      col("role_id", "SMALLINT", { pk: true, ref: "roles", onDelete: "CASCADE" }),
      col("level", "TEXT", { check: oneOf("level", LEVELS), note: "Yes (allowed), View (sees, can't act), Review (sees uploads, can't upload) or No (no access)" }),
    ],
    checks: [
      // The Admin keeps Manage users, and only views Sales Data, Inventory and Forecasting (locked in the app)
      `role_id <> ${ROLE.ADMIN} OR action <> 'Manage users' OR level = 'Yes'`,
      ...Object.entries(ADMIN_VIEW_ONLY).map(([action, level]) => `role_id <> ${ROLE.ADMIN} OR action <> '${action}' OR level = '${level}'`),
    ],
    rows: PERMISSION_ACTIONS.flatMap((action) =>
      ROLE_IDS.map((roleId) => {
        const level = db.permissions[action]?.[roleId];
        check(PERMISSION_OPTIONS[action].includes(level), `permission ${action} for role ${roleId} is "${level}"`);
        return { action, role_id: roleId, level };
      }),
    ),
  });

  const reportTypes = table("report_types", {
    area: "Access",
    about: "The ten report types on the Reports & Exports page.",
    used: "POST /reports, POST /reports/email (422 for an unknown type)",
    columns: [
      col("name", "TEXT", { pk: true, api: "`name` of a report", note: "Sales Summary, Demand Forecast Report …" }),
      col("description", "TEXT", { api: NOT_SENT }),
      col("position", "SMALLINT", { unique: true, api: NOT_SENT, note: "Order on the page" }),
    ],
    rows: ALL_REPORTS.map(([name, description], index) => ({ name, description, position: index + 1 })),
  });

  const roleReportTypes = table("role_report_types", {
    area: "Access",
    about: "The report types each role may generate.",
    used: "POST /reports, POST /reports/email (403 report_not_allowed)",
    columns: [
      col("role_id", "SMALLINT", { pk: true, ref: "roles", onDelete: "CASCADE" }),
      col("report_type", "TEXT", { pk: true, ref: "report_types", onDelete: "CASCADE" }),
    ],
    rows: ROLE_IDS.flatMap((roleId) => REPORTS_BY_ROLE[roleId].map((name) => ({ role_id: roleId, report_type: name }))),
  });

  // ---------------------------------------------------------------------------
  // Accounts and the audit trail
  // ---------------------------------------------------------------------------

  const usersTable = table("users", {
    area: "Accounts and audit",
    about: "Accounts. People sign in with their email or user ID (either case) and must pick the role the account has.",
    used: "POST /auth/login, GET /auth/me, GET/POST/PATCH /users, POST /auth/password-reset · Administration → Users",
    columns: [
      col("user_id", "TEXT", {
        pk: true,
        api: "id",
        check: "user_id ~ '^[A-Za-z]{2,4}-[0-9]{3,6}$'",
        note: "Employee ID such as USR-1042, unique ignoring case. POST /users gives a new account USR- and one more than the highest number in use",
      }),
      col("name", "TEXT"),
      col("email", "TEXT", {
        check: "email ~ '^\\S+@\\S+\\.\\S+$'",
        note: "Unique ignoring case. POST /users makes it from the name: first.last@<the Admin's email domain>, with 2, 3 … added when taken",
      }),
      col("password_hash", "TEXT", {
        file: "password",
        api: NOT_SENT,
        note: "bcrypt hash; never returned by the API. seed.sql hashes the demo passwords with pgcrypto. The CSV and JSON files have the demo password instead (column password): hash it when you load them",
      }),
      col("role_id", "SMALLINT", { ref: "roles", api: "roleId" }),
      col("initials", "TEXT", { note: "First letters of the first two words of the name (Noura Alharbi → NA)" }),
      col("department", "TEXT", { note: "The Admin form offers Commercial, Data & Analytics, Supply Chain, Digital Operations and Finance" }),
      col("status", "TEXT", { check: oneOf("status", USER_STATUSES), note: "Only Active accounts can sign in" }),
    ],
    indexes: ["CREATE UNIQUE INDEX users_email_key ON users (lower(email))", "CREATE UNIQUE INDEX users_user_id_lower_key ON users (lower(user_id))"],
    rows: db.users.map((u) => ({
      user_id: u.id,
      name: u.name,
      email: u.email,
      password_hash: new DemoPassword(u.password),
      role_id: u.roleId,
      initials: u.initials,
      department: u.department,
      status: u.status,
    })),
  });

  const sessions = table("sessions", {
    area: "Accounts and audit",
    about: "Sign-in sessions. The seeded ones have ended; a new sign-in adds a row with the hash of its token.",
    used: "POST /auth/login, POST /auth/logout, the token check on every request, GET /sessions",
    columns: [
      col("session_id", "TEXT", { pk: true, api: "id", id: ["SES", 4] }),
      col("user_id", "TEXT", { ref: "users", api: "userId" }),
      col("role_id", "SMALLINT", { ref: "roles", api: NOT_SENT, note: "The role signed in with; if the account's role changes, the session ends (401 role_changed)" }),
      col("login_at", "TIMESTAMPTZ", { api: "`loginAt`, `session.startedAt`" }),
      col("logout_at", "TIMESTAMPTZ", { null: true, api: "logoutAt", note: "NULL while the session is active" }),
      col("expires_at", "TIMESTAMPTZ", { api: "`expiresAt` (login and /auth/me)", note: "8 hours after sign-in; 7 days with Remember me" }),
      col("remember", "BOOLEAN", { default: "false", api: "`session.remember` (login and /auth/me)" }),
      col("token_hash", "TEXT", { null: true, unique: true, api: NOT_SENT, note: "SHA-256 of the bearer token while the session is active; NULL once it has ended" }),
    ],
    checks: ["logout_at IS NULL OR logout_at >= login_at"],
    rows: db.sessions.map((s) => {
      check(!s.token, `session ${s.id} is still signed in (the seed should only have ended sessions)`);
      return {
        session_id: s.id,
        user_id: s.userId,
        role_id: s.roleId,
        login_at: s.loginAt,
        logout_at: s.logoutAt,
        expires_at: s.expiresAt,
        remember: Boolean(s.remember),
        token_hash: null,
      };
    }),
  });

  const activity = table("activity_log", {
    area: "Accounts and audit",
    about: "The audit log, written by the server as things happen (docs/API_CONTRACT.md, section 9).",
    used: "GET /activity, POST /activity; written by most endpoints · Admin dashboard, Administration → Activity log",
    columns: [
      col("event_id", "TEXT", { pk: true, api: "id", id: ["EVT", 4] }),
      col("at", "TIMESTAMPTZ"),
      col("session_id", "TEXT", { null: true, ref: "sessions", api: "sessionId", note: "NULL for a refused sign-in" }),
      col("user_id", "TEXT", { null: true, ref: "users", api: "userId", note: "NULL when a sign-in names no known account" }),
      col("user_name", "TEXT", { api: "userName", note: "The user's name at the time; for an unknown account, the login that was typed" }),
      col("role_id", "SMALLINT", { null: true, ref: "roles", api: "roleId", note: "The user's role at the time" }),
      col("action", "TEXT", { note: "User login, Reorder placed … (the names in the contract, section 9)" }),
      col("module", "TEXT", { note: "Authentication, Sales Upload, Forecasting, Inventory, Reports & Exports or Admin Panel" }),
      col("details", "TEXT", { default: "''" }),
      col("status", "TEXT", { check: oneOf("status", EVENT_STATUSES) }),
    ],
    indexes: ["CREATE INDEX activity_log_at_idx ON activity_log (at DESC)"],
    rows: db.activity.map((e) => ({
      event_id: e.id,
      at: e.at,
      session_id: e.sessionId,
      user_id: e.userId,
      user_name: e.userName,
      role_id: e.roleId,
      action: e.action,
      module: e.module,
      details: e.details ?? "",
      status: e.status,
    })),
  });

  const errors = table("error_log", {
    area: "Accounts and audit",
    about: "Errors the server recorded, and how far each has been dealt with.",
    used: "GET /errors, PATCH /errors/{id} · Admin dashboard, Administration → System errors",
    columns: [
      col("error_id", "TEXT", { pk: true, api: "id", id: ["ERR", 4] }),
      col("at", "TIMESTAMPTZ"),
      col("module", "TEXT"),
      col("type", "TEXT", { note: "Invalid file, Execution failure, Export failure …" }),
      col("severity", "TEXT", { check: oneOf("severity", SEVERITIES) }),
      col("message", "TEXT"),
      col("status", "TEXT", { default: "'Open'", check: oneOf("status", ERROR_STATUSES) }),
      col("notes", "TEXT", { null: true, note: "Added when the status is changed" }),
    ],
    rows: db.errors.map((e) => ({
      error_id: e.id,
      at: e.at,
      module: e.module,
      type: e.type,
      severity: e.severity,
      message: e.message,
      status: e.status,
      notes: e.notes ?? null,
    })),
  });

  // ---------------------------------------------------------------------------
  // Products, stock and reorders
  // ---------------------------------------------------------------------------

  const categories = table("categories", {
    area: "Products and inventory",
    about: "Product categories. How many products each has is counted (category_view), not stored.",
    used: "GET/POST/PATCH /categories · global filters, Administration → Categories",
    columns: [
      col("category_id", "TEXT", { pk: true, api: "id", id: ["CAT", 3], check: "category_id ~ '^CAT-[0-9]{3,}$'" }),
      col("name", "TEXT", { note: "Unique ignoring case. Products refer to the category by ID, so a rename reaches them" }),
      col("description", "TEXT", { default: "''" }),
      col("status", "TEXT", { default: "'Active'", check: oneOf("status", CATEGORY_STATUSES) }),
    ],
    indexes: ["CREATE UNIQUE INDEX categories_name_key ON categories (lower(name))"],
    rows: db.categories.map((c) => ({ category_id: c.id, name: c.name, description: c.description ?? "", status: c.status })),
  });

  const productsTable = table("products", {
    area: "Products and inventory",
    about:
      "The product catalog. Sales records take their category, location, region and channel from here. An upload that names products the catalog doesn't have adds them (added_from).",
    used: "GET /inventory, GET /sales (through the views), forecasting and uploads (matched by SKU or name; unknown ones are added)",
    columns: [
      col("sku", "TEXT", { pk: true, note: "Unique ignoring case. Products added from an upload keep the file's ID (upper case) or get one made from the name" }),
      col("name", "TEXT"),
      col("category_id", "TEXT", { ref: "categories", api: "`category` (the category's name)" }),
      col("location", "TEXT", { note: "Warehouse or store; Unassigned when a file that added the product didn't say" }),
      col("region", "TEXT"),
      col("channel", "TEXT", { note: "Direct or Distributor; Unassigned for a product added from a file without a channel column" }),
      col("unit_price", "NUMERIC(12,2)", { api: "unitPrice", note: "Used for uploaded sales without a price or amount" }),
      col("unit_cost", "NUMERIC(12,2)", { null: true, api: "unitCost", note: "NULL when not known (products added from an upload)" }),
      col("reorder_level", "INTEGER", { api: "reorder", check: "reorder_level >= 0" }),
      col("safety_stock", "INTEGER", { api: "safety", check: "safety_stock >= 0" }),
      col("position", "SMALLINT", { unique: true, api: NOT_SENT, note: "Catalog order: the API lists products in this order (filters, product pickers)" }),
      col("added_from", "TEXT", {
        null: true,
        ref: "datasets",
        api: "`newProducts` of that dataset",
        note: "The upload that added the product to the catalog; NULL for the catalog's own products",
      }),
    ],
    indexes: ["CREATE UNIQUE INDEX products_sku_lower_key ON products (lower(sku))"],
    rows: db.inventory.map((p, index) => {
      check(categoryIdByName.has(p.category), `product ${p.sku}: no category is named "${p.category}"`);
      return {
        sku: p.sku,
        name: p.name,
        category_id: categoryIdByName.get(p.category),
        location: p.location,
        region: p.region,
        channel: p.channel,
        unit_price: p.unitPrice,
        unit_cost: p.unitCost,
        reorder_level: p.reorder,
        safety_stock: p.safety,
        position: index + 1,
        added_from: addedFrom.get(p.sku) ?? null,
      };
    }),
  });

  const inventory = table("inventory", {
    area: "Products and inventory",
    about: "Stock on hand and the 30-day demand of each product. Status, suggested order and days of cover are worked out by inventory_view.",
    used: "GET /inventory, GET /inventory/alerts, PATCH /inventory/{sku}; POST /forecasts sets demand; PATCH /reorders/{id} (Delivered) adds stock",
    columns: [
      col("sku", "TEXT", { pk: true, ref: "products", onDelete: "CASCADE" }),
      col("stock", "INTEGER", { check: "stock >= 0", note: "Units in stock now" }),
      col("demand_30d", "INTEGER", {
        api: "demand",
        check: "demand_30d > 0",
        note: "Units expected over the next 30 days. Saving a forecast sets it to max(1, round(average predicted units per day × 30)); the seeded values are the demo's starting estimates",
      }),
    ],
    rows: db.inventory.map((p) => ({ sku: p.sku, stock: p.stock, demand_30d: p.demand })),
  });

  const snapshots = table("inventory_snapshots", {
    area: "Products and inventory",
    about: "Month-end stock readings, one per month. The current month's follows live stock.",
    used: "GET /inventory/snapshots · Inventory Supervisor dashboard (monthly trends)",
    columns: [
      col("month", "TEXT", { pk: true, check: "month ~ '^[0-9]{4}-[0-9]{2}$'", note: "YYYY-MM" }),
      col("as_of", "DATE", { api: "asOf", note: "The day stock was read: the month end, or the latest sales date for the current month" }),
    ],
    rows: db.snapshots.map((s) => ({ month: s.month, as_of: s.asOf })),
  });

  const snapshotItems = table("inventory_snapshot_items", {
    area: "Products and inventory",
    about: "Each product's stock and status in a monthly snapshot (kept as read, not recalculated).",
    used: "GET /inventory/snapshots (items); stock updates and delivered reorders change the current month's rows",
    columns: [
      col("month", "TEXT", { pk: true, ref: "inventory_snapshots", onDelete: "CASCADE" }),
      col("sku", "TEXT", { pk: true, ref: "products" }),
      col("stock", "INTEGER", { check: "stock >= 0" }),
      col("status", "TEXT", { check: oneOf("status", STOCK_STATUSES), note: "Safe, Warning (shown as Low) or Critical on that day" }),
    ],
    rows: db.snapshots.flatMap((s) => s.items.map((item) => ({ month: s.month, sku: item.sku, stock: item.stock, status: item.status }))),
  });

  const reorders = table("reorders", {
    area: "Products and inventory",
    about: "Reorders: Ordered when the Inventory Supervisor places one, Delivered when it is marked delivered (which adds the quantity to stock).",
    used: "GET/POST /reorders, PATCH /reorders/{id} · Inventory page → Reorder status",
    columns: [
      col("reorder_id", "TEXT", { pk: true, api: "id", id: ["RO", 4] }),
      col("sku", "TEXT", { ref: "products" }),
      col("quantity", "INTEGER", { check: "quantity > 0" }),
      col("supplier", "TEXT"),
      col("status", "TEXT", { default: "'Ordered'", check: oneOf("status", REORDER_STATUSES) }),
      col("ordered_at", "TIMESTAMPTZ", { api: "orderedAt", note: "When it was placed" }),
      col("delivered_at", "TIMESTAMPTZ", { null: true, api: "deliveredAt", note: "When it was marked delivered; NULL until then" }),
      col("ordered_by", "TEXT", { ref: "users", api: "`userId`; `userName` from users" }),
    ],
    checks: ["(status = 'Delivered') = (delivered_at IS NOT NULL)", "delivered_at IS NULL OR delivered_at >= ordered_at"],
    rows: db.reorders.map((r) => {
      check(REORDER_STATUSES.includes(r.status), `reorder ${r.id}: status "${r.status}"`);
      return {
        reorder_id: r.id,
        sku: r.sku,
        quantity: r.quantity,
        supplier: r.supplier,
        status: r.status,
        ordered_at: r.orderedAt,
        delivered_at: r.deliveredAt ?? null,
        ordered_by: r.userId,
      };
    }),
  });

  // ---------------------------------------------------------------------------
  // Sales data: uploads, the records waiting for cleaning, the shared sales history
  // ---------------------------------------------------------------------------

  const datasetsTable = table("datasets", {
    area: "Sales data",
    about: "Uploaded sales files: validation counts, what the valid records cover, and cleaning. dataset_view adds the validation label, pending count and forecasting status.",
    used: "GET /datasets, POST /datasets, POST /datasets/{id}/clean · Sales Data page, the pipeline tracker",
    columns: [
      col("dataset_id", "TEXT", { pk: true, api: "id", id: ["DS", 4] }),
      col("file_name", "TEXT", { api: "fileName" }),
      col("uploaded_at", "TIMESTAMPTZ", { api: "uploadedAt" }),
      col("uploaded_by", "TEXT", { ref: "users", api: "`uploaderId`; `uploader` is the user's name" }),
      col("total_rows", "INTEGER", { api: "checks.total", check: "total_rows >= 0", note: "Data rows in the file" }),
      col("valid_rows", "INTEGER", { api: "checks.valid", check: "valid_rows >= 0", note: "Records kept: one per product and day" }),
      col("combined_rows", "INTEGER", { default: "0", api: "checks.combined", check: "combined_rows >= 0", note: "Valid rows added to another row's product and day (several stores, or one row per sale)" }),
      col("missing_rows", "INTEGER", { api: "checks.missing", note: "No date, product or units, or an unknown product" }),
      col("duplicate_rows", "INTEGER", { api: "checks.duplicates", note: "The same date and product again in the file" }),
      col("invalid_date_rows", "INTEGER", { api: "checks.invalidDates" }),
      col("invalid_numeric_rows", "INTEGER", { api: "checks.invalidNumeric", note: "Units not a whole number ≥ 0, or an unusable price or discount" }),
      col("error", "TEXT", { null: true, note: "Why the whole file was rejected; set only when validation failed" }),
      col("coverage_first_date", "DATE", { null: true, api: "coverage.firstDate", note: "First date among its valid records; NULL when it has none" }),
      col("coverage_last_date", "DATE", { null: true, api: "coverage.lastDate" }),
      col("coverage_products", "INTEGER", { null: true, api: "coverage.products", note: "How many products its valid records have" }),
      col("cleaning", "TEXT", { check: oneOf("cleaning", CLEANING_STATUSES), note: "Not started (rejected file), Pending (waiting to be cleaned) or Completed" }),
      col("cleaned_at", "TIMESTAMPTZ", { null: true, api: "`cleanedAt`, `cleaningSummary.cleanedAt`" }),
      col("cleaned_by", "TEXT", { null: true, ref: "users", api: "`cleaningSummary.cleanedBy` (the user's name)" }),
      col("outliers_capped", "INTEGER", { null: true, api: "cleaningSummary.outliersCapped" }),
      col("records_replaced", "INTEGER", { null: true, api: "cleaningSummary.replaced" }),
      col("records_skipped", "INTEGER", { null: true, api: "cleaningSummary.skipped" }),
      col("records_added", "INTEGER", { null: true, api: "cleaningSummary.added" }),
    ],
    checks: [
      "valid_rows + combined_rows <= total_rows",
      "(cleaning = 'Completed') = (cleaned_at IS NOT NULL)",
      "(coverage_first_date IS NULL) = (coverage_last_date IS NULL)",
    ],
    rows: db.datasets.map((d) => {
      const failed = d.validation === "Failed";
      check(failed === Boolean(d.error) && (failed || d.checks.valid > 0), `dataset ${d.id}: validation "${d.validation}" doesn't match its error and checks`);
      check(d.recordCount === (failed ? 0 : d.checks.valid), `dataset ${d.id}: recordCount ${d.recordCount} isn't its valid rows`);
      const summary = d.cleaningSummary;
      if (summary) {
        check(summary.inputRecords === d.checks.valid, `dataset ${d.id}: cleaned ${summary.inputRecords} records, validated ${d.checks.valid}`);
        check(summary.excludedAtValidation === d.checks.total - d.checks.valid - (d.checks.combined ?? 0), `dataset ${d.id}: excludedAtValidation doesn't match its checks`);
        check(summary.cleanedAt === d.cleanedAt, `dataset ${d.id}: two different cleaning times`);
      }
      return {
        dataset_id: d.id,
        file_name: d.fileName,
        uploaded_at: d.uploadedAt,
        uploaded_by: d.uploaderId,
        total_rows: d.checks.total,
        valid_rows: d.checks.valid,
        combined_rows: d.checks.combined ?? 0,
        missing_rows: d.checks.missing,
        duplicate_rows: d.checks.duplicates,
        invalid_date_rows: d.checks.invalidDates,
        invalid_numeric_rows: d.checks.invalidNumeric,
        error: d.error ?? null,
        coverage_first_date: d.coverage?.firstDate ?? null,
        coverage_last_date: d.coverage?.lastDate ?? null,
        coverage_products: d.coverage?.products ?? null,
        cleaning: d.cleaning,
        cleaned_at: d.cleanedAt ?? null,
        cleaned_by: summary ? userId(summary.cleanedBy, `dataset ${d.id} cleanedBy`) : null,
        outliers_capped: summary?.outliersCapped ?? null,
        records_replaced: summary?.replaced ?? null,
        records_skipped: summary?.skipped ?? null,
        records_added: summary?.added ?? null,
      };
    }),
  });

  const saleColumns = (idColumn) => [
    idColumn,
    col("sale_date", "DATE", { api: "date" }),
    col("sku", "TEXT", { ref: "products", note: "Category, location, region and channel come from the product" }),
    col("units", "INTEGER", { check: "units >= 0" }),
    col("unit_price", "NUMERIC(12,2)", { api: "unitPrice", check: "unit_price >= 0" }),
    col("discount_rate", "NUMERIC(6,4)", { api: "discountRate", check: "discount_rate BETWEEN 0 AND 1", note: "A fraction: 0.05 = 5%" }),
    col("net_revenue", "NUMERIC(14,2)", { api: "netRevenue", note: "units × unit_price × (1 − discount_rate), rounded to cents" }),
  ];
  const saleRow = (r) => ({
    sale_date: r.date,
    sku: r.sku,
    units: r.units,
    unit_price: r.unitPrice,
    discount_rate: r.discountRate,
    net_revenue: r.netRevenue,
  });

  const pendingRecords = table("dataset_pending_records", {
    area: "Sales data",
    about: "Validated records of uploads waiting for cleaning. Cleaning moves them into sales_records (keeping their ID and upload) and empties this list.",
    used: "POST /datasets (adds), POST /datasets/{id}/clean (moves), pendingCount, GET /forecasts/lineage and saved runs (waiting)",
    columns: [
      ...saleColumns(col("record_id", "TEXT", { pk: true, api: "id", id: ["UPL", 6], note: "Kept as the sale_id when the upload is cleaned" })),
      col("dataset_id", "TEXT", { ref: "datasets", onDelete: "CASCADE", api: "datasetId" }),
    ],
    uniques: [["dataset_id", "sale_date", "sku"]],
    rows: db.datasets.flatMap((d) =>
      (d.pendingRecords ?? []).map((r) => {
        sameAsProduct(r, `pending record of ${d.id}`);
        check(r.datasetId === d.id, `pending record ${r.id} says it came from ${r.datasetId}, not ${d.id}`);
        return { record_id: r.id, ...saleRow(r), dataset_id: d.id };
      }),
    ),
  });

  const sales = table("sales_records", {
    area: "Sales data",
    about: "The shared, cleaned sales history: one record per product per day with sales. Forecasts, dashboards and reports read it.",
    used: "GET /sales, GET /dashboard/summary, POST /forecasts (history), reports; POST /datasets/{id}/clean adds to it",
    columns: [
      ...saleColumns(col("sale_id", "TEXT", { pk: true, api: "id" })),
      col("dataset_id", "TEXT", { null: true, ref: "datasets", api: "datasetId", note: "The upload it was cleaned from (lineage); NULL = loaded without an upload" }),
    ],
    uniques: [["sale_date", "sku"]],
    indexes: [
      "CREATE INDEX sales_records_sku_date_idx ON sales_records (sku, sale_date)",
      "CREATE INDEX sales_records_dataset_idx ON sales_records (dataset_id)",
    ],
    rows: db.sales.map((r) => {
      sameAsProduct(r, "sales record");
      check(r.datasetId === null || datasets.has(r.datasetId), `sales record ${r.id}: unknown upload ${r.datasetId}`);
      return { sale_id: r.id, ...saleRow(r), dataset_id: r.datasetId ?? null };
    }),
  });

  // ---------------------------------------------------------------------------
  // Forecasting
  // ---------------------------------------------------------------------------

  const runs = table("forecast_runs", {
    area: "Forecasting",
    about: "Saved forecast runs, with their settings and accuracy. A failed run isn't saved (it goes to the activity and error logs).",
    used: "GET/POST /forecasts, GET /forecasts/{id} · Forecasting page and run history, dashboards, forecast reports",
    columns: [
      col("forecast_id", "TEXT", { pk: true, api: "id", id: ["FC", 4] }),
      col("sku", "TEXT", { ref: "products" }),
      col("model", "TEXT", { check: oneOf("model", FORECAST_MODELS) }),
      col("horizon", "INTEGER", { check: "horizon BETWEEN 1 AND 365", note: "Days forecast after end_date" }),
      col("start_date", "DATE", { api: "startDate", note: "The sales history the run used: start_date … end_date, every day counted (0 on days without sales)" }),
      col("end_date", "DATE", { api: "endDate" }),
      col("window_size", "INTEGER", { null: true, api: "configuration.windowSize", note: "Moving Average only" }),
      col("slope", "NUMERIC(14,4)", { null: true, api: "configuration.slope", note: "Linear Regression only: the fitted trend, units per day" }),
      col("arima_p", "SMALLINT", { null: true, api: "configuration.order[0]", note: "ARIMA only" }),
      col("arima_d", "SMALLINT", { null: true, api: "configuration.order[1]", note: "ARIMA only" }),
      col("arima_q", "SMALLINT", { null: true, api: "configuration.order[2]", note: "ARIMA only" }),
      col("mae", "DOUBLE PRECISION", { null: true, api: "metrics.mae" }),
      col("rmse", "DOUBLE PRECISION", { null: true, api: "metrics.rmse" }),
      col("mape", "DOUBLE PRECISION", { null: true, api: "metrics.mape", note: "NULL when a held-back day had no sales" }),
      col("holdout_days", "INTEGER", { api: "evaluation.holdoutDays", note: "Days held back to measure accuracy" }),
      col("generated_at", "TIMESTAMPTZ", { api: "generatedAt" }),
      col("generated_by", "TEXT", { ref: "users", api: "`generatedBy.id`; `generatedBy.name` from users" }),
    ],
    checks: [
      "start_date <= end_date",
      "(model = 'Moving Average') = (window_size IS NOT NULL)",
      "(model = 'Linear Regression') = (slope IS NOT NULL)",
      "(model = 'ARIMA') = (arima_p IS NOT NULL AND arima_d IS NOT NULL AND arima_q IS NOT NULL)",
    ],
    indexes: ["CREATE INDEX forecast_runs_sku_idx ON forecast_runs (sku, generated_at DESC)"],
    rows: db.forecasts.map((run) => {
      const order = run.configuration.order ?? [null, null, null];
      check(run.configuration.horizon === run.horizon, `forecast ${run.id}: two different horizons`);
      return {
        forecast_id: run.id,
        sku: run.sku,
        model: run.model,
        horizon: run.horizon,
        start_date: run.startDate,
        end_date: run.endDate,
        window_size: run.configuration.windowSize ?? null,
        slope: run.configuration.slope ?? null,
        arima_p: order[0],
        arima_d: order[1],
        arima_q: order[2],
        mae: run.mae ?? null,
        rmse: run.rmse ?? null,
        mape: run.mape ?? null,
        holdout_days: run.holdoutDays,
        generated_at: run.generatedAt,
        generated_by: run.generatedBy.id,
      };
    }),
  });

  const points = table("forecast_points", {
    area: "Forecasting",
    about: "The predicted units for each day of a run's horizon.",
    used: "GET/POST /forecasts (points) · the forecast chart, forecast reports",
    columns: [
      col("forecast_id", "TEXT", { pk: true, ref: "forecast_runs", onDelete: "CASCADE" }),
      col("period", "INTEGER", { pk: true, check: "period >= 1", note: "1 = the day after end_date" }),
      col("forecast_date", "DATE", { api: "points[].date" }),
      col("predicted", "INTEGER", { api: "points[].predicted", check: "predicted >= 0", note: "Whole units, never below 0" }),
    ],
    rows: db.forecasts.flatMap((run) =>
      run.points.map((p) => ({ forecast_id: run.id, period: p.period, forecast_date: p.date, predicted: p.forecast })),
    ),
  });

  const sources = table("forecast_sources", {
    area: "Forecasting",
    about:
      "Each run's lineage, saved when it ran: the uploads its sales records came from (used), and the uploads waiting for cleaning that had the product's sales in its range (waiting, not used). An upload's forecasting status is worked out from these rows (dataset_view).",
    used: "Saved runs' lineage (GET /forecasts), GET /datasets (forecasting, forecastedAt, lineage); GET /forecasts/lineage returns the same shape without saving",
    columns: [
      col("forecast_id", "TEXT", { pk: true, ref: "forecast_runs", onDelete: "CASCADE" }),
      col("kind", "TEXT", { pk: true, check: oneOf("kind", SOURCE_KINDS), api: "`lineage.sources` (used) or `lineage.waiting` (waiting)" }),
      col("position", "SMALLINT", { pk: true, note: "Order in its list: oldest data first" }),
      col("dataset_id", "TEXT", { null: true, ref: "datasets", api: "`datasetId`; `fileName` from datasets", note: "NULL = sales history loaded without an upload" }),
      col("records", "INTEGER", { check: "records > 0" }),
      col("first_date", "DATE", { api: "firstDate" }),
      col("last_date", "DATE", { api: "lastDate" }),
    ],
    checks: ["first_date <= last_date"],
    indexes: [
      "CREATE UNIQUE INDEX forecast_sources_dataset_key ON forecast_sources (forecast_id, kind, coalesce(dataset_id, ''))",
      "CREATE INDEX forecast_sources_dataset_idx ON forecast_sources (dataset_id)",
    ],
    rows: db.forecasts.flatMap((run) => {
      check(run.lineage, `forecast ${run.id} has no lineage`);
      const row = (kind) => (source, index) => ({
        forecast_id: run.id,
        kind,
        position: index + 1,
        dataset_id: source.datasetId,
        records: source.records,
        first_date: source.firstDate,
        last_date: source.lastDate,
      });
      const used = run.lineage.sources.map(row("used"));
      check(used.reduce((sum, s) => sum + s.records, 0) === run.lineage.records, `forecast ${run.id}: its sources don't add up to its records`);
      return [...used, ...run.lineage.waiting.map(row("waiting"))];
    }),
  });

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  const reportsTable = table("reports", {
    area: "Reports",
    about: "Generated reports. A new one is Processing until the background job finishes it (Completed) or fails (Failed).",
    used: "GET/POST /reports, GET /reports/{id}, GET /reports/{id}/file · Reports & Exports → report history",
    columns: [
      col("report_id", "TEXT", { pk: true, api: "id", id: ["RPT", 3] }),
      col("report_type", "TEXT", { ref: "report_types", api: "name" }),
      col("format", "TEXT", { check: oneOf("format", REPORT_FORMATS) }),
      col("generated_at", "TIMESTAMPTZ", { api: "generatedAt" }),
      col("user_id", "TEXT", { ref: "users", api: "`userId`; `userName` from users" }),
      col("role_id", "SMALLINT", { ref: "roles", api: "roleId", note: "The role it was generated as" }),
      col("status", "TEXT", { default: "'Processing'", check: oneOf("status", REPORT_STATUSES) }),
      col("filters", "JSONB", { null: true, note: "The filters sent: { start, end, category: [], sku: [], region: [], model: [] } (an empty or missing list = all); NULL = none (the whole history)" }),
      col("error", "TEXT", { null: true, note: "Why it failed" }),
    ],
    indexes: ["CREATE INDEX reports_user_idx ON reports (user_id, generated_at DESC)"],
    rows: db.reports.map((r) => {
      check(users.has(r.userId), `report ${r.id}: unknown user ${r.userId}`);
      return {
        report_id: r.id,
        report_type: r.name,
        format: r.format,
        generated_at: r.generatedAt,
        user_id: r.userId,
        role_id: r.roleId,
        status: r.status,
        filters: r.filters ?? null,
        error: r.error ?? null,
      };
    }),
  });

  return [
    roles,
    screens,
    roleScreens,
    permissionActions,
    rolePermissions,
    reportTypes,
    roleReportTypes,
    usersTable,
    sessions,
    activity,
    errors,
    categories,
    datasetsTable,
    productsTable,
    inventory,
    snapshots,
    snapshotItems,
    reorders,
    pendingRecords,
    sales,
    runs,
    points,
    sources,
    reportsTable,
  ];
}

/** The primary key columns of a table. */
export const primaryKey = (t) => t.columns.filter((c) => c.pk).map((c) => c.name);
