// The audit log, sign-in sessions and the error log.
import { api } from "./api";
import { segment } from "./query";

export const activityService = {
  /** GET /activity → events, newest first: { id, at, sessionId, userId, userName, roleId, action, module, details, status } */
  getActivity: () => api.get("/activity"),

  /** POST /activity { action, details } → 201 event. Only for events the server can't see, e.g. "Screen access denied". */
  logEvent: ({ action, details = "" }) => api.post("/activity", { action, details }),

  /** GET /sessions → [{ id, userId, loginAt, logoutAt }] */
  getSessions: () => api.get("/sessions"),

  /** GET /errors → [{ id, at, module, type, severity, message, status, notes }] */
  getErrors: () => api.get("/errors"),

  /** PATCH /errors/{id} { status: "Open" | "Investigating" | "Resolved", notes? } → the error */
  updateErrorStatus: (id, status, notes = "") => api.patch(`/errors/${segment(id)}`, { status, notes }),
};
