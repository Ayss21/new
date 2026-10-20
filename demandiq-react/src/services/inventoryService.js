// Stock levels, stock updates, stock alerts and month-end snapshots.
import { api } from "./api";
import { segment } from "./query";

export const inventoryService = {
  /** GET /inventory → products with stock, reorder level, safety stock, 30-day demand, status, suggestion */
  getInventory: () => api.get("/inventory"),

  /** PATCH /inventory/{sku} { stock, reason, notes } → the updated product */
  updateStock: (sku, { stock, reason, notes = "" }) => api.patch(`/inventory/${segment(sku)}`, { stock, reason, notes }),

  /** GET /inventory/alerts → products below their reorder level, most urgent first, each with a message */
  getAlerts: () => api.get("/inventory/alerts"),

  /** GET /inventory/snapshots?start=YYYY-MM&end=YYYY-MM → [{ month, asOf, items: [{ sku, stock, status }] }] */
  getSnapshots: ({ start, end } = {}) => api.get("/inventory/snapshots", { query: { start, end } }),
};
