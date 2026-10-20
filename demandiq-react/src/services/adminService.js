// Administration: user accounts, product categories, action permissions and screen access.
import { api } from "./api";
import { segment } from "./query";

export const adminService = {
  // Users (passwords are sent, never returned)
  /** GET /users */
  getUsers: () => api.get("/users"),
  /** POST /users { id, name, email, department, roleId, status, password } → 201 user */
  createUser: (user) => api.post("/users", user),
  /** PATCH /users/{id} { name?, email?, department?, roleId?, status?, password? } → user */
  updateUser: (id, changes) => api.patch(`/users/${segment(id)}`, changes),

  // Product categories
  /** GET /categories */
  getCategories: () => api.get("/categories"),
  /** POST /categories { id?, name, description } → 201 category */
  createCategory: (category) => api.post("/categories", category),
  /** PATCH /categories/{id} { name?, description?, status? } → category */
  updateCategory: (id, changes) => api.patch(`/categories/${segment(id)}`, changes),

  // Action permissions: { [action]: { [roleId]: "Yes" | "View" | "Review" | "No" } }
  /** GET /roles/permissions */
  getPermissions: () => api.get("/roles/permissions"),
  /** PATCH /roles/permissions { action, roleId, value } → the whole matrix */
  updatePermission: ({ action, roleId, value }) => api.patch("/roles/permissions", { action, roleId, value }),

  // Screen access: { [roleId]: [screen IDs] }
  /** GET /roles/screens */
  getScreenAccess: () => api.get("/roles/screens"),
  /** PUT /roles/{roleId}/screens { screens } → the whole map */
  updateScreenAccess: (roleId, screens) => api.put(`/roles/${segment(roleId)}/screens`, { screens }),

  /** POST /roles/restore-defaults → { permissions, screens } */
  restoreDefaults: () => api.post("/roles/restore-defaults"),
};
