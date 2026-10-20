// /auth — sign in, current user, sign out, roles (demo backend).
import { PERMISSION_ACTIONS } from "../../../data/seed";
import { authenticateUser } from "../../../lib/domain";
import { ROLE_IDS, roleName } from "../../../lib/roles";
import { screenIdsFor } from "../../../navigation";
import { SESSION_RULES } from "../../authService";
import { nextId } from "../db";
import { accepted, effectiveLevel, fail, invalid, logEvent, noContent, now, ok, text } from "../http";

/** Session length without "Remember me" (hours) and with it (days) — the values agreed in the contract. */
const SESSION_HOURS = SESSION_RULES.sessionHours;
const REMEMBER_DAYS = SESSION_RULES.rememberDays;

const REASON_CODES = { credentials: "invalid_credentials", pending: "account_pending", inactive: "account_inactive", role: "role_mismatch" };

/** A user as the API returns it — never with the password. */
export function publicUser({ id, name, email, roleId, initials, department, status }) {
  return { id, name, email, roleId, initials, department, status };
}

function newToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What /auth/login and /auth/me return about the signed-in user. */
function sessionPayload(db, user, session) {
  return {
    expiresAt: session.expiresAt,
    session: { id: session.id, startedAt: session.loginAt, expiresAt: session.expiresAt, remember: session.remember },
    user: publicUser(user),
    // What the user may do now: the role's matrix value, or "No" when the role can't open the action's screen
    permissions: Object.fromEntries(PERMISSION_ACTIONS.map((action) => [action, effectiveLevel(db, user.roleId, action)])),
    screens: screenIdsFor(db.screenAccess, user.roleId),
  };
}

/**
 * Checks the Bearer token of a request. Returns { user, session } or fails with 401 and the reason, the
 * same checks a refresh used to make: the session must exist and not be ended or expired, and the account
 * must still exist, be Active and have the role it signed in with.
 */
export function authenticate(req) {
  const header = req.headers?.Authorization ?? req.headers?.authorization ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (!token) fail(401, "not_authenticated", "Sign in to continue.");
  const session = req.db.sessions.find((s) => s.token === token);
  if (!session || session.logoutAt) fail(401, "session_ended", "Your session has ended. Please sign in again.");
  const end = (reason) => {
    session.logoutAt = now();
    session.token = null;
    req.changed = true;
    fail(401, reason.code, reason.message);
  };
  if (Date.parse(session.expiresAt) <= Date.now()) end({ code: "session_expired", message: "Your session expired. Please sign in again." });
  const user = req.db.users.find((u) => u.id === session.userId);
  if (!user) end({ code: "account_missing", message: "Your account is no longer available. Please sign in again." });
  if (user.status === "Pending activation")
    end({ code: "account_pending", message: "Your account is waiting for an administrator to activate it." });
  if (user.status !== "Active") end({ code: "account_inactive", message: "Your account has been deactivated. Contact your administrator." });
  if (user.roleId !== session.roleId)
    end({ code: "role_changed", message: `Your role was changed to ${roleName(user.roleId)}. Please sign in again with your new role.` });
  return { user, session };
}

/** POST /auth/login { login, password, roleId, remember } */
export function login(req) {
  const body = req.body ?? {};
  const loginId = text(body.login);
  invalid({
    login: !loginId && "Enter your email or employee ID.",
    password: !body.password && "Enter your password.",
    roleId: !ROLE_IDS.includes(body.roleId) && "Select the role you're signing in as.",
  });
  const result = authenticateUser(req.db.users, loginId, String(body.password), body.roleId);
  if (result.error) {
    logEvent(
      req,
      "Sign-in failed",
      "Authentication",
      "Failed",
      `${loginId} · signing in as ${roleName(body.roleId)} · ${result.error.replace(/\.$/, "")}`,
      result.user ?? { id: null, name: loginId, roleId: null },
    );
    fail(result.reason === "credentials" ? 401 : 403, REASON_CODES[result.reason], result.error);
  }
  const user = result.user;
  const remember = Boolean(body.remember);
  const started = new Date();
  const session = {
    id: nextId("SES"),
    userId: user.id,
    roleId: user.roleId,
    token: newToken(),
    loginAt: started.toISOString(),
    logoutAt: null,
    expiresAt: new Date(started.getTime() + (remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 3600000).toISOString(),
    remember,
  };
  req.db.sessions.unshift(session);
  logEvent({ ...req, session }, "User login", "Authentication", "Completed", "Signed in", user);
  return ok({ accessToken: session.token, tokenType: "bearer", ...sessionPayload(req.db, user, session) });
}

/** GET /auth/me */
export function me(req) {
  return ok(sessionPayload(req.db, req.user, req.session));
}

/** POST /auth/logout */
export function logout(req) {
  logEvent(req, "User logout", "Authentication", "Completed", "Signed out");
  req.session.logoutAt = now();
  req.session.token = null;
  return noContent();
}

/** GET /auth/roles (no sign-in needed): each role with the screen IDs it can open. */
export function roles(req) {
  return ok(ROLE_IDS.map((roleId) => ({ roleId, name: roleName(roleId), screens: screenIdsFor(req.db.screenAccess, roleId) })));
}

/** POST /auth/password-reset { email } — always 202, whether or not the email has an account */
export function passwordReset(req) {
  const email = text(req.body?.email);
  invalid({ email: !/^\S+@\S+\.\S+$/.test(email) && "Enter a valid email address." });
  const user = req.db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (user) logEvent(req, "Password reset requested", "Authentication", "Completed", email, user);
  return accepted({ message: "If an account exists for this email, reset instructions will be sent." });
}
