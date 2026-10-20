// Sign in, current user, sign out and the roles list.
import { api } from "./api";

/** Agreed session lengths (the server enforces them): remembered sessions 7 days, others 8 hours. */
export const SESSION_RULES = { rememberDays: 7, sessionHours: 8 };

export const authService = {
  /**
   * POST /auth/login { login, password, roleId, remember }
   * → { accessToken, tokenType, expiresAt, session, user, permissions, screens }
   * login is the email or employee ID; roleId is the role picked on the sign-in page (must be the account's role).
   */
  login: ({ login, password, roleId, remember = false }) => api.post("/auth/login", { login, password, roleId, remember }),

  /** GET /auth/me → { expiresAt, session, user, permissions, screens } — checks a saved token after a refresh. */
  getCurrentUser: () => api.get("/auth/me"),

  /** POST /auth/logout → 204 */
  logout: () => api.post("/auth/logout"),

  /** GET /auth/roles (no sign-in needed) → [{ roleId, name, screens }] — for the sign-in page. */
  getRoles: () => api.get("/auth/roles"),

  /**
   * POST /auth/password-reset { email } → 202 { message } (no sign-in needed).
   * Always answers 202, so nobody can find out which emails have accounts.
   */
  requestPasswordReset: (email) => api.post("/auth/password-reset", { email }),
};
