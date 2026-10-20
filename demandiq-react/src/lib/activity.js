// Calculations over the activity log (Admin dashboard and Activity log).
// Every figure is derived from the log rows; nothing is hard-coded.
import { ROLE_IDS, roleName } from "./roles";

/** Modules shown in the Module activity summary, in display order. */
export const SUMMARY_MODULES = ["Authentication", "Forecasting", "Inventory", "Sales Upload", "Reports & Exports"];

/**
 * Per module: total events, successful (Completed), failed (Failed) and success rate (Successful ÷ Total).
 * successRate is null when a module has no events.
 */
export function moduleActivitySummary(activity, modules = SUMMARY_MODULES) {
  return modules.map((module) => {
    const rows = activity.filter((row) => row.module === module);
    const successful = rows.filter((row) => row.status === "Completed").length;
    const failed = rows.filter((row) => row.status === "Failed").length;
    return { module, total: rows.length, successful, failed, successRate: rows.length ? successful / rows.length : null };
  });
}

/** Number of activity rows per role (rows without a known role are left out). */
export function activityByRole(activity) {
  return ROLE_IDS.map((roleId) => ({
    roleId,
    label: roleName(roleId),
    count: activity.filter((row) => row.roleId === roleId).length,
  }));
}

/**
 * Every user with their number of activities, most active first (ties by name): the accounts in `users`
 * (0 when they have none) and anyone else the log mentions.
 */
export function activityByUser(activity, users = []) {
  const byUser = new Map(users.map((u) => [u.id, { userId: u.id, userName: u.name, roleId: u.roleId, total: 0 }]));
  for (const row of activity) {
    if (!row.userId) continue;
    const current = byUser.get(row.userId) ?? { userId: row.userId, userName: row.userName, roleId: row.roleId, total: 0 };
    current.total += 1;
    byUser.set(row.userId, current);
  }
  return [...byUser.values()].sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName));
}

/**
 * Session length in words: "Less than 1 min", "40 min", "1 hr", "1 hr 25 min", "2 hr 5 min".
 * Returns "Ongoing" when the session has not ended.
 */
export function formatSessionDuration(loginAt, logoutAt) {
  if (!logoutAt) return "Ongoing";
  const minutes = Math.max(0, Math.round((new Date(logoutAt).getTime() - new Date(loginAt).getTime()) / 60000));
  if (minutes < 1) return "Less than 1 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
