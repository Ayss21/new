// Fixed rules of the action permission matrix (Administration → Role Permissions). The demo backend and
// the Admin page share them; a real backend enforces the same rules.
import { PERMISSION_SCREEN } from "../data/seed";
import { ADMIN_SCREEN } from "../navigation";
import { ROLE } from "./roles";

/**
 * The Admin only looks at the Console modules (Sales Data, Inventory, Forecasting): these actions stay at a
 * view-only level for the Admin and can't be changed. Reports stay available.
 */
export const ADMIN_VIEW_ONLY = {
  "Upload sales": "Review",
  "Clean data": "View",
  "Run forecasts": "View",
  "Update inventory": "View",
};

/** Why an action permission can't be changed, or null when it can. */
export function actionLock(action, roleId) {
  if (roleId === ROLE.ADMIN && action === "Manage users") return "Locked so an admin is always available.";
  if (roleId === ROLE.ADMIN && ADMIN_VIEW_ONLY[action]) return "The Admin only views Sales Data, Inventory and Forecasting.";
  if (PERMISSION_SCREEN[action] === ADMIN_SCREEN && roleId !== ROLE.ADMIN) return "Administration (SCR-06) is only for the Admin role.";
  return null;
}
