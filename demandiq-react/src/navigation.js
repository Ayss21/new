// Screens, which role ID can open which screen ID, page addresses and the top navigation.
//
// Access model (a frontend demonstration — a real backend must enforce the same rules):
//   1. Every screen has a fixed screen ID (SCREENS: SCR-01 … SCR-06).
//   2. ROLE_SCREEN_ACCESS maps each role ID to the screen IDs that role can open.
//   3. The top navigation, the Admin's module menu, in-page links and the address bar only ever open a
//      screen that the signed-in user's role ID is mapped to (see App.jsx).
//   4. The Admin can change the map in Administration → Role Permissions. Two rules are fixed:
//      every role keeps its Dashboard, and only the Admin role has Administration.
// What a role can do on a screen it can open (upload, clean, run forecasts …) is a separate matrix:
// initialPermissions in data/seed.js.

import { ROLE, ROLE_IDS } from "./lib/roles";

/** Page keys used throughout the app. */
export const PAGE = {
  DASHBOARD: "Dashboard",
  SALES: "Sales Upload",
  INVENTORY: "Inventory Suggestions",
  REPORTS: "Reports & Exports",
  FORECASTING: "Forecasting",
  ADMIN: "Admin Panel",
};

/** Every screen: its ID, the page it shows, its name, its address (#/path) and its icon. */
export const SCREENS = [
  { id: "SCR-01", page: PAGE.DASHBOARD, label: "Dashboard", path: "dashboard", icon: "grid" },
  { id: "SCR-02", page: PAGE.SALES, label: "Sales Data", path: "sales-data", icon: "upload" },
  { id: "SCR-03", page: PAGE.INVENTORY, label: "Inventory", path: "inventory", icon: "box" },
  { id: "SCR-04", page: PAGE.REPORTS, label: "Reports & Exports", path: "reports", icon: "report" },
  { id: "SCR-05", page: PAGE.FORECASTING, label: "Forecasting", path: "forecasting", icon: "trend" },
  { id: "SCR-06", page: PAGE.ADMIN, label: "Administration", path: "administration", icon: "shield" },
];

const SCREEN_IDS = SCREENS.map((screen) => screen.id);

export const PAGE_LABEL = Object.fromEntries(SCREENS.map((screen) => [screen.page, screen.label]));
export const PAGE_ICON = Object.fromEntries(SCREENS.map((screen) => [screen.page, screen.icon]));

export function screenById(screenId) {
  return SCREENS.find((screen) => screen.id === screenId) ?? null;
}

export function screenForPage(page) {
  return SCREENS.find((screen) => screen.page === page) ?? null;
}

// ---------------------------------------------------------------------------
// Role ID → screen IDs
// ---------------------------------------------------------------------------

/**
 * Default screen access: role ID → the screen IDs that role can open. These defaults follow the
 * role requirements; the Admin edits a live copy (Administration → Role Permissions), which the
 * store keeps as `screenAccess`. Never change this object at run time — always make a new map
 * (withScreenAccess does).
 */
export const ROLE_SCREEN_ACCESS = {
  [ROLE.STORE_MANAGER]: ["SCR-01", "SCR-02", "SCR-04"], // role ID 1
  [ROLE.DATA_ANALYST]: ["SCR-01", "SCR-02", "SCR-04", "SCR-05"], // role ID 2
  [ROLE.INVENTORY_SUPERVISOR]: ["SCR-01", "SCR-03", "SCR-04"], // role ID 3
  [ROLE.ADMIN]: ["SCR-01", "SCR-02", "SCR-03", "SCR-04", "SCR-05", "SCR-06"], // role ID 4
};

/** Every role starts on its Dashboard after sign-in, so no role can lose it. */
export const LANDING_SCREEN = "SCR-01";
/** Administration holds the access settings; only the Admin role has it, so access can't be locked out. */
export const ADMIN_SCREEN = "SCR-06";

/** Why the Admin can't change this role's access to this screen, or null when it can be changed. */
export function accessLock(roleId, screenId) {
  if (screenId === LANDING_SCREEN) return "Every role starts on its Dashboard after sign-in, so it can't be removed.";
  if (screenId === ADMIN_SCREEN)
    return roleId === ROLE.ADMIN
      ? "The Admin always keeps Administration, so access settings can't be locked out."
      : "Administration is only for the Admin role.";
  return null;
}

/** The screen IDs a role can open, in screen order. Unknown IDs are ignored. */
export function screenIdsFor(access, roleId) {
  const allowed = access?.[roleId] ?? [];
  return SCREEN_IDS.filter((id) => allowed.includes(id));
}

/** The screens a role can open (screen objects, in screen order). */
export function screensFor(access, roleId) {
  return screenIdsFor(access, roleId).map(screenById);
}

export function canOpenScreen(access, roleId, screenId) {
  return screenIdsFor(access, roleId).includes(screenId);
}

/** Can this role open this page? A page with no screen ID can never be opened. */
export function canOpenPage(access, roleId, page) {
  const screen = screenForPage(page);
  return screen !== null && canOpenScreen(access, roleId, screen.id);
}

/** The page a role lands on after sign-in: its first screen, the Dashboard. */
export function landingPageFor(access, roleId) {
  return screensFor(access, roleId)[0]?.page ?? PAGE.DASHBOARD;
}

/** A copy of the access map with one role's access to one screen turned on or off. Locked cells don't change. */
export function withScreenAccess(access, roleId, screenId, allowed) {
  if (!SCREEN_IDS.includes(screenId) || accessLock(roleId, screenId)) return access;
  const current = screenIdsFor(access, roleId);
  const next = allowed ? [...current, screenId] : current.filter((id) => id !== screenId);
  return { ...access, [roleId]: SCREEN_IDS.filter((id) => next.includes(id)) };
}

/** Any access map made valid: every role ID present, known screen IDs only, the two fixed rules applied. */
export function normalizeScreenAccess(access) {
  return Object.fromEntries(
    ROLE_IDS.map((roleId) => {
      const ids = new Set(Array.isArray(access?.[roleId]) ? access[roleId] : []);
      ids.add(LANDING_SCREEN);
      if (roleId === ROLE.ADMIN) ids.add(ADMIN_SCREEN);
      else ids.delete(ADMIN_SCREEN);
      return [roleId, SCREEN_IDS.filter((id) => ids.has(id))];
    }),
  );
}

// ---------------------------------------------------------------------------
// Page addresses: each screen has its own address, e.g. http://localhost:5173/#/forecasting,
// so a refresh reopens the same screen and the browser's Back and Forward buttons work.
// ---------------------------------------------------------------------------

/** The address of a page, e.g. "#/forecasting". */
export function hashFor(page) {
  const screen = screenForPage(page);
  return screen ? `#/${screen.path}` : "#/";
}

/** Reads an address: { path, page } — page is null when the address is empty or isn't a screen. */
export function parseHash(hash) {
  const path = (hash ?? "").replace(/^#\/?/, "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  return { path, page: SCREENS.find((screen) => screen.path === path)?.page ?? null };
}

// ---------------------------------------------------------------------------
// Navigation
// Admin sees: Dashboard | <module dropdown: Sales Data, Inventory, Reports & Exports, Forecasting> | Administration.
// Other roles see their screens as individual top-nav items, Forecasting right after Sales Data.
// ---------------------------------------------------------------------------

/** Modules in the Admin's module dropdown, in menu order (Forecasting last). */
export const CONSOLE_PAGES = [PAGE.SALES, PAGE.INVENTORY, PAGE.REPORTS, PAGE.FORECASTING];
/** The dropdown's key in the top navigation (it shows a module's name, never this word). */
export const CONSOLE = "Console";
/** Module order in the other roles' navigation: Forecasting right after Sales Data. */
export const MODULE_NAV_ORDER = [PAGE.SALES, PAGE.FORECASTING, PAGE.INVENTORY, PAGE.REPORTS];

export function isConsolePage(page) {
  return CONSOLE_PAGES.includes(page);
}

/** Modules of the Admin's menu that a role can open, in menu order. */
export function consolePagesFor(access, roleId) {
  return CONSOLE_PAGES.filter((page) => canOpenPage(access, roleId, page));
}

/**
 * Top navigation items for a role: only screens its role ID can open.
 * Admin (role 4): Dashboard | <module dropdown> | Administration — one dropdown for the four modules.
 * Other roles: Dashboard | <each module they can open, Forecasting after Sales Data>.
 */
export function topNavFor(access, roleId) {
  const item = (page) => ({ key: page, label: PAGE_LABEL[page], icon: PAGE_ICON[page] });
  const items = canOpenPage(access, roleId, PAGE.DASHBOARD) ? [item(PAGE.DASHBOARD)] : [];
  if (roleId === ROLE.ADMIN) {
    if (consolePagesFor(access, roleId).length) items.push({ key: CONSOLE, label: CONSOLE, icon: "layers" });
  } else {
    items.push(...MODULE_NAV_ORDER.filter((page) => canOpenPage(access, roleId, page)).map(item));
  }
  if (canOpenPage(access, roleId, PAGE.ADMIN)) items.push(item(PAGE.ADMIN));
  return items;
}

/** Breadcrumb parts after "Workspace": the screen's name ("Workspace / Forecasting") for every role. */
export function breadcrumbFor(page) {
  return [PAGE_LABEL[page]];
}
