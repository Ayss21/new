// Role IDs. Every role check in the app compares these IDs; the names are only labels.
export const ROLE = Object.freeze({
  STORE_MANAGER: 1,
  DATA_ANALYST: 2,
  INVENTORY_SUPERVISOR: 3,
  ADMIN: 4,
});

export const ROLE_NAME = Object.freeze({
  [ROLE.STORE_MANAGER]: "Store Manager",
  [ROLE.DATA_ANALYST]: "Data Analyst",
  [ROLE.INVENTORY_SUPERVISOR]: "Inventory Supervisor",
  [ROLE.ADMIN]: "Admin",
});

/** All role IDs in display order. */
export const ROLE_IDS = [ROLE.STORE_MANAGER, ROLE.DATA_ANALYST, ROLE.INVENTORY_SUPERVISOR, ROLE.ADMIN];

/** Roles people can pick when they sign up. Admin accounts are created by an Admin only. */
export const SIGN_UP_ROLE_IDS = [ROLE.STORE_MANAGER, ROLE.DATA_ANALYST, ROLE.INVENTORY_SUPERVISOR];

export function roleName(roleId) {
  return ROLE_NAME[roleId] ?? "Unknown role";
}

/** CSS class for role-specific layout tweaks, e.g. "role-inventory-supervisor". */
export function roleClass(roleId) {
  return `role-${roleName(roleId).toLowerCase().replaceAll(" ", "-")}`;
}

/** Turns a value from a <select> (always a string) back into a role ID. */
export function toRoleId(value) {
  const id = Number(value);
  return ROLE_IDS.includes(id) ? id : null;
}
