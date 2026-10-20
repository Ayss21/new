// Demo backend only — FastAPI does not implement these (a real server never sends passwords).
// Used by the sign-in page's "Demonstration accounts" dialog when VITE_API_MODE is not "live".
import { api } from "./api";

export const demoService = {
  /** GET /demo/accounts → [{ id, name, email, password, roleId, status }] */
  getAccounts: () => api.get("/demo/accounts"),
  /** POST /demo/reset → 204: every record back to the seed data */
  reset: () => api.post("/demo/reset"),
};
