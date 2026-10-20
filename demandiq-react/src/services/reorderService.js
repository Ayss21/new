// Reorders: Ordered (placed by the Inventory Supervisor) → Delivered (Mark delivered: adds the quantity to stock).
import { api } from "./api";
import { segment } from "./query";

export const reorderService = {
  /** GET /reorders → orders, newest first: { id, sku, quantity, supplier, status, orderedAt, deliveredAt, userId, userName } */
  getReorders: () => api.get("/reorders"),

  /** POST /reorders { sku, quantity, supplier } → 201 order (status Ordered) */
  createReorder: ({ sku, quantity, supplier }) => api.post("/reorders", { sku, quantity, supplier }),

  /** PATCH /reorders/{id} { status: "Delivered" } → the order. Adds the quantity to the product's stock. */
  updateReorderStatus: (id, status) => api.patch(`/reorders/${segment(id)}`, { status }),
};
