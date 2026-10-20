import { describe, expect, it } from "vitest";
import { ROLE, ROLE_IDS, ROLE_NAME, SIGN_UP_ROLE_IDS, roleClass, roleName, toRoleId } from "./roles";
import { authenticateUser, validateSignUp } from "./domain";
import { initialPermissions, initialUsers } from "../data/seed";
import {
  PAGE,
  ROLE_SCREEN_ACCESS,
  SCREENS,
  accessLock,
  canOpenPage,
  consolePagesFor,
  hashFor,
  landingPageFor,
  normalizeScreenAccess,
  parseHash,
  screenIdsFor,
  topNavFor,
  withScreenAccess,
} from "../navigation";

describe("role IDs", () => {
  it("defines the four roles once, with fixed IDs", () => {
    expect(ROLE).toEqual({ STORE_MANAGER: 1, DATA_ANALYST: 2, INVENTORY_SUPERVISOR: 3, ADMIN: 4 });
    expect(ROLE_IDS.map(roleName)).toEqual(["Store Manager", "Data Analyst", "Inventory Supervisor", "Admin"]);
    expect(ROLE_NAME[4]).toBe("Admin");
    expect(roleName(99)).toBe("Unknown role");
    expect(roleClass(3)).toBe("role-inventory-supervisor");
  });

  it("converts select values back to IDs", () => {
    expect(toRoleId("2")).toBe(2);
    expect(toRoleId(4)).toBe(4);
    expect(toRoleId("Admin")).toBeNull();
    expect(toRoleId("")).toBeNull();
  });

  it("does not offer Admin at sign-up", () => {
    expect(SIGN_UP_ROLE_IDS).toEqual([1, 2, 3]);
  });

  it("stores role IDs on users and keys the permission matrix by role ID", () => {
    expect(initialUsers.every((user) => ROLE_IDS.includes(user.roleId) && !("role" in user))).toBe(true);
    for (const row of Object.values(initialPermissions)) expect(Object.keys(row).map(Number)).toEqual(ROLE_IDS);
  });

  it("keeps each role's page access", () => {
    const pages = (roleId) => consolePagesFor(ROLE_SCREEN_ACCESS, roleId);
    expect(pages(ROLE.STORE_MANAGER)).toEqual([PAGE.SALES, PAGE.REPORTS]);
    expect(pages(ROLE.DATA_ANALYST)).toEqual([PAGE.SALES, PAGE.REPORTS, PAGE.FORECASTING]);
    expect(pages(ROLE.INVENTORY_SUPERVISOR)).toEqual([PAGE.INVENTORY, PAGE.REPORTS]);
    expect(pages(ROLE.ADMIN)).toEqual([PAGE.SALES, PAGE.INVENTORY, PAGE.REPORTS, PAGE.FORECASTING]);
    expect(ROLE_IDS.filter((id) => canOpenPage(ROLE_SCREEN_ACCESS, id, PAGE.ADMIN))).toEqual([ROLE.ADMIN]);
    const nav = (roleId) => topNavFor(ROLE_SCREEN_ACCESS, roleId).map((item) => item.label);
    // Admin gets the module dropdown (its navigation key is "Console"; the menu shows a module's name)
    expect(nav(ROLE.ADMIN)).toEqual(["Dashboard", "Console", "Administration"]);
    // Other roles get individual module tabs, Forecasting right after Sales Data
    expect(nav(ROLE.STORE_MANAGER)).toEqual(["Dashboard", "Sales Data", "Reports & Exports"]);
    expect(nav(ROLE.DATA_ANALYST)).toEqual(["Dashboard", "Sales Data", "Forecasting", "Reports & Exports"]);
    expect(nav(ROLE.INVENTORY_SUPERVISOR)).toEqual(["Dashboard", "Inventory", "Reports & Exports"]);
  });
});

describe("role ID → screen IDs (ROLE_SCREEN_ACCESS)", () => {
  it("gives every screen a unique ID and address", () => {
    expect(new Set(SCREENS.map((screen) => screen.id)).size).toBe(SCREENS.length);
    expect(new Set(SCREENS.map((screen) => screen.path)).size).toBe(SCREENS.length);
  });

  it("maps every role ID to its screen IDs explicitly", () => {
    expect(ROLE_SCREEN_ACCESS).toEqual({
      1: ["SCR-01", "SCR-02", "SCR-04"],
      2: ["SCR-01", "SCR-02", "SCR-04", "SCR-05"],
      3: ["SCR-01", "SCR-03", "SCR-04"],
      4: ["SCR-01", "SCR-02", "SCR-03", "SCR-04", "SCR-05", "SCR-06"],
    });
    expect(screenIdsFor(ROLE_SCREEN_ACCESS, 99)).toEqual([]);
  });

  it("opens only mapped screens, and starts every role on its dashboard", () => {
    expect(canOpenPage(ROLE_SCREEN_ACCESS, ROLE.STORE_MANAGER, PAGE.FORECASTING)).toBe(false);
    expect(canOpenPage(ROLE_SCREEN_ACCESS, ROLE.DATA_ANALYST, PAGE.FORECASTING)).toBe(true);
    expect(canOpenPage(ROLE_SCREEN_ACCESS, ROLE.INVENTORY_SUPERVISOR, PAGE.SALES)).toBe(false);
    expect(canOpenPage(ROLE_SCREEN_ACCESS, ROLE.ADMIN, "Not a page")).toBe(false);
    for (const roleId of ROLE_IDS) expect(landingPageFor(ROLE_SCREEN_ACCESS, roleId)).toBe(PAGE.DASHBOARD);
  });

  it("follows screen access changes made by the Admin, without touching the defaults", () => {
    const granted = withScreenAccess(ROLE_SCREEN_ACCESS, ROLE.STORE_MANAGER, "SCR-05", true);
    expect(screenIdsFor(granted, ROLE.STORE_MANAGER)).toEqual(["SCR-01", "SCR-02", "SCR-04", "SCR-05"]);
    expect(topNavFor(granted, ROLE.STORE_MANAGER).map((item) => item.label)).toContain("Forecasting");
    const removed = withScreenAccess(ROLE_SCREEN_ACCESS, ROLE.DATA_ANALYST, "SCR-05", false);
    expect(canOpenPage(removed, ROLE.DATA_ANALYST, PAGE.FORECASTING)).toBe(false);
    expect(ROLE_SCREEN_ACCESS[ROLE.DATA_ANALYST]).toContain("SCR-05");
  });

  it("locks the Dashboard for every role and Administration to the Admin", () => {
    for (const roleId of ROLE_IDS) expect(accessLock(roleId, "SCR-01")).toBeTruthy();
    expect(accessLock(ROLE.ADMIN, "SCR-06")).toBeTruthy();
    expect(accessLock(ROLE.STORE_MANAGER, "SCR-06")).toMatch(/only for the Admin/);
    expect(accessLock(ROLE.STORE_MANAGER, "SCR-05")).toBeNull();
    expect(withScreenAccess(ROLE_SCREEN_ACCESS, ROLE.DATA_ANALYST, "SCR-01", false)).toBe(ROLE_SCREEN_ACCESS);
    expect(withScreenAccess(ROLE_SCREEN_ACCESS, ROLE.STORE_MANAGER, "SCR-06", true)).toBe(ROLE_SCREEN_ACCESS);
    expect(withScreenAccess(ROLE_SCREEN_ACCESS, ROLE.ADMIN, "SCR-06", false)).toBe(ROLE_SCREEN_ACCESS);
  });

  it("repairs a damaged access map", () => {
    expect(normalizeScreenAccess({ 1: ["SCR-04", "SCR-06", "SCR-99"], 2: "nonsense" })).toEqual({
      1: ["SCR-01", "SCR-04"],
      2: ["SCR-01"],
      3: ["SCR-01"],
      4: ["SCR-01", "SCR-06"],
    });
  });

  it("gives each screen its own address", () => {
    expect(hashFor(PAGE.FORECASTING)).toBe("#/forecasting");
    expect(parseHash("#/forecasting")).toEqual({ path: "forecasting", page: PAGE.FORECASTING });
    expect(parseHash("#/Sales-Data/")).toEqual({ path: "sales-data", page: PAGE.SALES });
    expect(parseHash("#/nowhere")).toEqual({ path: "nowhere", page: null });
    expect(parseHash("")).toEqual({ path: "", page: null });
    for (const screen of SCREENS) expect(parseHash(hashFor(screen.page)).page).toBe(screen.page);
  });
});

describe("sign in with a role", () => {
  const users = [
    { id: "USR-1042", name: "Noura Alharbi", email: "analyst@demo.demandiq", password: "Analyze123!", roleId: 2, status: "Active" },
    { id: "USR-5000", name: "New Person", email: "new@demandiq.test", password: "Welcome123", roleId: 1, status: "Pending activation" },
    { id: "USR-5001", name: "Old Person", email: "old@demandiq.test", password: "Welcome123", roleId: 3, status: "Inactive" },
  ];

  it("accepts email or employee ID with the matching role", () => {
    expect(authenticateUser(users, "analyst@demo.demandiq", "Analyze123!", 2).user.id).toBe("USR-1042");
    expect(authenticateUser(users, "usr-1042", "Analyze123!", 2).user.id).toBe("USR-1042");
  });

  it("rejects a wrong password or unknown account without saying which was wrong", () => {
    const wrongPassword = authenticateUser(users, "analyst@demo.demandiq", "nope", 2);
    const unknown = authenticateUser(users, "nobody@x.com", "Analyze123!", 2);
    expect(wrongPassword).toEqual({ error: "Invalid user ID or password. Please try again.", reason: "credentials", field: "credentials" });
    expect(unknown).toEqual(wrongPassword);
  });

  it("rejects a role that doesn't match the account", () => {
    expect(authenticateUser(users, "USR-1042", "Analyze123!", 4).error).toBe("This account isn't registered as an Admin.");
    expect(authenticateUser(users, "USR-1042", "Analyze123!", 1)).toMatchObject({
      error: "This account isn't registered as a Store Manager.",
      reason: "role",
      field: "role",
    });
  });

  it("blocks accounts that are pending activation or inactive, whatever role is picked", () => {
    expect(authenticateUser(users, "new@demandiq.test", "Welcome123", 1)).toMatchObject({ reason: "pending", field: null });
    expect(authenticateUser(users, "new@demandiq.test", "Welcome123", 1).error).toMatch(/administrator to activate/);
    expect(authenticateUser(users, "old@demandiq.test", "Welcome123", 3).error).toMatch(/inactive/);
    expect(authenticateUser(users, "old@demandiq.test", "Welcome123", 1).reason).toBe("inactive");
    const activated = users.map((u) => (u.id === "USR-5000" ? { ...u, status: "Active" } : u));
    expect(authenticateUser(activated, "new@demandiq.test", "Welcome123", 1).user.name).toBe("New Person");
  });

  it("ships demo accounts that show each outcome", () => {
    const account = (email) => initialUsers.find((user) => user.email === email);
    for (const user of initialUsers.filter((u) => u.status === "Active"))
      expect(authenticateUser(initialUsers, user.email, user.password, user.roleId).user.id).toBe(user.id);
    const inactive = account("former.manager@demo.demandiq");
    const pending = account("new.analyst@demo.demandiq");
    expect(authenticateUser(initialUsers, inactive.email, inactive.password, inactive.roleId).reason).toBe("inactive");
    expect(authenticateUser(initialUsers, pending.email, pending.password, pending.roleId).reason).toBe("pending");
    expect(new Set(initialUsers.map((user) => user.id)).size).toBe(initialUsers.length);
  });
});

describe("sign-up validation", () => {
  const users = [{ id: "USR-1042", email: "analyst@demo.demandiq" }];
  const valid = {
    name: "Sara Khan",
    email: "sara.khan@demandiq.test",
    id: "USR-2044",
    password: "Forecast1",
    confirmPassword: "Forecast1",
    roleId: 2,
  };

  it("accepts a complete, valid form", () => {
    expect(validateSignUp(users, valid)).toEqual({});
  });

  it("requires every field", () => {
    expect(Object.keys(validateSignUp(users, {})).sort()).toEqual(["confirmPassword", "email", "id", "name", "password", "roleId"]);
  });

  it("checks email format and uniqueness of email and employee ID", () => {
    expect(validateSignUp(users, { ...valid, email: "not-an-email" }).email).toMatch(/valid email/);
    expect(validateSignUp(users, { ...valid, email: "ANALYST@demo.demandiq" }).email).toMatch(/already exists/);
    expect(validateSignUp(users, { ...valid, id: "usr-1042" }).id).toMatch(/already registered/);
  });

  it("requires 8+ characters with a letter and a number, and matching passwords", () => {
    expect(validateSignUp(users, { ...valid, password: "abc123", confirmPassword: "abc123" }).password).toBeDefined();
    expect(validateSignUp(users, { ...valid, password: "abcdefgh", confirmPassword: "abcdefgh" }).password).toBeDefined();
    expect(validateSignUp(users, { ...valid, password: "12345678", confirmPassword: "12345678" }).password).toBeDefined();
    expect(validateSignUp(users, { ...valid, confirmPassword: "Forecast2" }).confirmPassword).toMatch(/don't match/);
  });

  it("does not allow signing up as Admin", () => {
    expect(validateSignUp(users, { ...valid, roleId: 4 }).roleId).toBeDefined();
  });
});
