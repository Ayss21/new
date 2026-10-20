// /demo — only the demo backend has these (the sign-in page's "Demonstration accounts" dialog).
// FastAPI does not implement them: a real server never sends passwords to the browser.
import { DEMO_ACCOUNT_IDS } from "../../../data/seed";
import { resetDatabase } from "../db";
import { noContent, ok } from "../http";

/** GET /demo/accounts — the demonstration accounts with their passwords, roles and current status */
export function accounts(req) {
  return ok(
    DEMO_ACCOUNT_IDS.map((id) => req.db.users.find((user) => user.id === id))
      .filter(Boolean)
      .map(({ id, name, email, password, roleId, status }) => ({ id, name, email, password, roleId, status })),
  );
}

/** POST /demo/reset — every record back to the seed data */
export function reset() {
  resetDatabase();
  return noContent();
}
