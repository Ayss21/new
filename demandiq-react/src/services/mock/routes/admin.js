// /users, /categories and /roles — accounts, product categories, action permissions and screen access (demo backend).
import { PERMISSION_ACTIONS, PERMISSION_OPTIONS, initialPermissions } from "../../../data/seed";
import { EMPLOYEE_ID_PATTERN, initialsOf } from "../../../lib/domain";
import { actionLock } from "../../../lib/permissions";
import { ROLE, ROLE_IDS, roleName } from "../../../lib/roles";
import { ROLE_SCREEN_ACCESS, SCREENS, accessLock, screenById, screenIdsFor } from "../../../navigation";
import { created, fail, invalid, logEvent, ok, requireAction, text } from "../http";
import { publicUser } from "./auth";

const USER_STATUSES = ["Active", "Pending activation", "Inactive"];
const EMAIL = /^\S+@\S+\.\S+$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** GET /users */
export function users(req) {
  requireAction(req, "Manage users");
  return ok(req.db.users.map(publicUser));
}

/** The next employee ID: USR- and one more than the highest number in use (USR-3381 → USR-3382). */
function nextEmployeeId(users) {
  const highest = Math.max(1000, ...users.map((u) => Number(/^USR-(\d+)$/i.exec(u.id)?.[1] ?? 0)));
  return `USR-${highest + 1}`;
}

/**
 * A work email from the name: first.last@<the signed-in admin's domain> (sara.ali@demo.demandiq), with a
 * number added when it's taken (sara.ali2@…). Names without Latin letters use the employee ID.
 */
function workEmailFor(users, name, id, domain) {
  const words = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);
  const local = (words.length > 1 ? `${words[0]}.${words.at(-1)}` : words[0]) || id.toLowerCase();
  const taken = new Set(users.map((u) => u.email.toLowerCase()));
  let email = `${local}@${domain}`;
  for (let n = 2; taken.has(email); n += 1) email = `${local}${n}@${domain}`;
  return email;
}

/**
 * POST /users { name, department, roleId, status, password } → 201 with the new user.
 * The server gives the account its employee ID and work email; `id` and `email` may still be sent (for an import).
 */
export function createUser(req) {
  requireAction(req, "Manage users");
  const body = req.body ?? {};
  const name = text(body.name);
  const requestedId = text(body.id).toUpperCase();
  const requestedEmail = text(body.email);
  invalid({
    name: !name && "Enter the user's full name.",
    id: requestedId && !EMPLOYEE_ID_PATTERN.test(requestedId) && "Use the format USR-2044, or leave it out.",
    email: requestedEmail && !EMAIL.test(requestedEmail) && "Enter a valid work email, or leave it out.",
    department: !text(body.department) && "Select a department.",
    roleId: !ROLE_IDS.includes(body.roleId) && "Select a role.",
    status: !["Active", "Pending activation"].includes(body.status ?? "Active") && "New accounts are Active or Pending activation.",
    password: String(body.password ?? "").length < 8 && "At least 8 characters.",
  });
  if (requestedEmail && req.db.users.some((u) => u.email.toLowerCase() === requestedEmail.toLowerCase()))
    fail(409, "email_taken", "A user with this email already exists.", { fields: { email: "A user with this email already exists." } });
  if (requestedId && req.db.users.some((u) => u.id.toLowerCase() === requestedId.toLowerCase()))
    fail(409, "id_taken", "This employee ID is already in use.", { fields: { id: "This employee ID is already in use." } });
  const id = requestedId || nextEmployeeId(req.db.users);
  const domain = req.user.email.split("@")[1] || "demandiq.com";
  const user = {
    id,
    name,
    email: requestedEmail || workEmailFor(req.db.users, name, id, domain),
    password: String(body.password),
    roleId: body.roleId,
    initials: initialsOf(name),
    department: text(body.department),
    status: body.status ?? "Active",
  };
  req.db.users.push(user);
  logEvent(req, "User created", "Admin Panel", "Completed", `${user.id} · ${user.name} (${roleName(user.roleId)})`);
  return created(publicUser(user));
}

/** PATCH /users/{id} { name?, email?, department?, roleId?, status?, password? } */
export function updateUser(req) {
  requireAction(req, "Manage users");
  const target = req.db.users.find((u) => u.id === req.params.id);
  if (!target) fail(404, "not_found", "User not found.");
  const patch = req.body ?? {};
  invalid({
    name: patch.name !== undefined && !text(patch.name) && "Enter the user's full name.",
    email: patch.email !== undefined && !EMAIL.test(text(patch.email)) && "Enter a valid work email.",
    department: patch.department !== undefined && !text(patch.department) && "Select a department.",
    roleId: patch.roleId !== undefined && !ROLE_IDS.includes(patch.roleId) && "Select a role.",
    status: patch.status !== undefined && !USER_STATUSES.includes(patch.status) && `Use one of: ${USER_STATUSES.join(", ")}.`,
    password: patch.password !== undefined && String(patch.password).length < 8 && "At least 8 characters.",
  });
  if (patch.email && req.db.users.some((u) => u.id !== target.id && u.email.toLowerCase() === text(patch.email).toLowerCase()))
    fail(409, "email_taken", "A user with this email already exists.", { fields: { email: "A user with this email already exists." } });
  const activeAdmins = req.db.users.filter((u) => u.roleId === ROLE.ADMIN && u.status === "Active");
  const losesAdmin =
    target.roleId === ROLE.ADMIN && ((patch.roleId && patch.roleId !== ROLE.ADMIN) || (patch.status && patch.status !== "Active"));
  if (losesAdmin && activeAdmins.length <= 1) fail(409, "last_admin", "At least one active Admin is required.");
  if (target.id === req.user.id && patch.status && patch.status !== "Active") fail(409, "own_account", "You can't deactivate your own account.");
  if (target.id === req.user.id && patch.roleId && patch.roleId !== target.roleId) fail(409, "own_role", "You can't change your own role while signed in.");

  const activated = target.status !== "Active" && patch.status === "Active";
  for (const key of ["name", "email", "department"]) if (patch[key] !== undefined) target[key] = text(patch[key]);
  if (patch.roleId !== undefined) target.roleId = patch.roleId;
  if (patch.status !== undefined) target.status = patch.status;
  if (patch.password) target.password = String(patch.password);
  if (patch.name) target.initials = initialsOf(target.name);
  logEvent(req, activated ? "User account activated" : "User updated", "Admin Panel", "Completed", `${target.id} · ${target.name} (${roleName(target.roleId)})`);
  return ok(publicUser(target));
}

// ---------------------------------------------------------------------------
// Product categories
// ---------------------------------------------------------------------------

/** A category as the API returns it: with how many products it has (counted, not stored). */
function withProductCount(db, category) {
  return { ...category, products: db.inventory.filter((item) => item.category === category.name).length };
}

/** GET /categories (every signed-in user: the global filters list them) */
export function categories(req) {
  return ok(req.db.categories.map((category) => withProductCount(req.db, category)));
}

/** POST /categories { id?, name, description? } */
export function createCategory(req) {
  requireAction(req, "Manage users");
  const body = req.body ?? {};
  const name = text(body.name);
  const requested = text(body.id).toUpperCase();
  invalid({
    name: !name && "Enter a category name.",
    id: requested && !/^CAT-\d{3}$/.test(requested) && "Category ID must look like CAT-006, or leave it blank.",
  });
  if (req.db.categories.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    fail(409, "name_taken", "This category already exists.", { fields: { name: "This category already exists." } });
  const id = requested || `CAT-${String(req.db.categories.length + 1).padStart(3, "0")}`;
  if (req.db.categories.some((c) => c.id === id)) fail(409, "id_taken", "This category ID is already in use.", { fields: { id: "This category ID is already in use." } });
  const category = { id, name, description: text(body.description), status: "Active" };
  req.db.categories.push(category);
  logEvent(req, "Category created", "Admin Panel", "Completed", `${id} ${name}`);
  return created(withProductCount(req.db, category));
}

/** PATCH /categories/{id} { name?, description?, status? } */
export function updateCategory(req) {
  requireAction(req, "Manage users");
  const category = req.db.categories.find((c) => c.id === req.params.id);
  if (!category) fail(404, "not_found", "That category no longer exists.");
  const patch = req.body ?? {};
  invalid({
    name: patch.name !== undefined && !text(patch.name) && "Enter a category name.",
    status: patch.status !== undefined && !["Active", "Inactive"].includes(patch.status) && "Use Active or Inactive.",
  });
  if (patch.name && req.db.categories.some((c) => c.id !== category.id && c.name.toLowerCase() === text(patch.name).toLowerCase()))
    fail(409, "name_taken", "This category already exists.", { fields: { name: "This category already exists." } });
  if (patch.name !== undefined && text(patch.name) !== category.name) {
    // Products, their sales and uploads waiting for cleaning follow the rename (a foreign key in a database)
    const before = category.name;
    const after = text(patch.name);
    const rename = (row) => (row.category === before ? { ...row, category: after } : row);
    req.db.inventory = req.db.inventory.map(rename);
    req.db.sales = req.db.sales.map(rename);
    for (const d of req.db.datasets) d.pendingRecords = (d.pendingRecords ?? []).map(rename);
    category.name = after;
  }
  if (patch.description !== undefined) category.description = text(patch.description);
  if (patch.status !== undefined) category.status = patch.status;
  logEvent(req, "Product category updated", "Admin Panel", "Completed", `${category.id} ${category.name}`);
  return ok(withProductCount(req.db, category));
}

// ---------------------------------------------------------------------------
// Action permissions: permissions[action][roleId] = "Yes" | "View" | "Review" | "No"
// ---------------------------------------------------------------------------

/** GET /roles/permissions */
export function permissions(req) {
  requireAction(req, "Manage users");
  return ok(req.db.permissions);
}

/** PATCH /roles/permissions { action, roleId, value } — one cell of the matrix */
export function updatePermission(req) {
  requireAction(req, "Manage users");
  const { action, roleId, value } = req.body ?? {};
  invalid({
    action: !PERMISSION_ACTIONS.includes(action) && `Use one of: ${PERMISSION_ACTIONS.join(", ")}.`,
    roleId: !ROLE_IDS.includes(roleId) && "Use a role ID from 1 to 4.",
  });
  invalid({ value: !PERMISSION_OPTIONS[action].includes(value) && `Use one of: ${PERMISSION_OPTIONS[action].join(", ")}.` });
  const lock = actionLock(action, roleId);
  if (lock) fail(409, "locked", lock);
  req.db.permissions[action][roleId] = value;
  logEvent(req, "Role modified", "Admin Panel", "Completed", `${roleName(roleId)} · ${action} → ${value === "No" ? "No access" : value}`);
  return ok(req.db.permissions);
}

// ---------------------------------------------------------------------------
// Screen access: role ID → screen IDs
// ---------------------------------------------------------------------------

/** GET /roles/screens */
export function screens(req) {
  requireAction(req, "Manage users");
  return ok(req.db.screenAccess);
}

/** PUT /roles/{roleId}/screens { screens: ["SCR-01", …] } */
export function updateScreens(req) {
  requireAction(req, "Manage users");
  const roleId = Number(req.params.roleId);
  if (!ROLE_IDS.includes(roleId)) fail(404, "not_found", "Unknown role ID.");
  const requested = req.body?.screens;
  invalid({
    screens:
      (!Array.isArray(requested) && "Send screens as a list of screen IDs.") ||
      (requested.some((id) => !screenById(id)) && `Use screen IDs from ${SCREENS[0].id} to ${SCREENS.at(-1).id}.`),
  });
  const before = screenIdsFor(req.db.screenAccess, roleId);
  const after = SCREENS.map((s) => s.id).filter((id) => requested.includes(id));
  const changed = SCREENS.map((s) => s.id).filter((id) => before.includes(id) !== after.includes(id));
  for (const id of changed) {
    const lock = accessLock(roleId, id);
    if (lock) fail(409, "locked", lock);
  }
  req.db.screenAccess = { ...req.db.screenAccess, [roleId]: after };
  for (const id of changed)
    logEvent(
      req,
      "Screen access changed",
      "Admin Panel",
      "Completed",
      `${roleName(roleId)} (role ID ${roleId}) · ${id} ${screenById(id).label} → ${after.includes(id) ? "Allowed" : "No access"}`,
    );
  return ok(req.db.screenAccess);
}

/** POST /roles/restore-defaults — action permissions and screen access back to their defaults */
export function restoreDefaults(req) {
  requireAction(req, "Manage users");
  req.db.permissions = clone(initialPermissions);
  req.db.screenAccess = clone(ROLE_SCREEN_ACCESS);
  logEvent(req, "Role permissions restored", "Admin Panel", "Completed", "Action permissions and screen access set to their defaults");
  return ok({ permissions: req.db.permissions, screens: req.db.screenAccess });
}
