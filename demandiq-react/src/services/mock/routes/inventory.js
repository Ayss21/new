// /inventory and /reorders — stock levels, stock updates, alerts, month-end snapshots, reorders (demo backend).
import { CURRENT_SNAPSHOT_MONTH } from "../../../data/seed";
import { dateBounds, updateInventoryRecord, updateSnapshot } from "../../../lib/domain";
import { nextId } from "../db";
import { created, fail, invalid, logEvent, now, ok, requireAction, text } from "../http";

const MONTH = /^\d{4}-\d{2}$/;

/** Keeps the current month's snapshot in step with live stock. */
function syncSnapshot(db, item, stock) {
  db.snapshots = updateSnapshot(db.snapshots, CURRENT_SNAPSHOT_MONTH, dateBounds(db.sales).end, { sku: item.sku, stock }, item);
}

/** GET /inventory */
export function list(req) {
  return ok(req.db.inventory);
}

/** PATCH /inventory/{sku} { stock, reason, notes? } */
export function update(req) {
  requireAction(req, "Update inventory");
  const item = req.db.inventory.find((row) => row.sku === req.params.sku);
  if (!item) fail(404, "not_found", `Product ${req.params.sku} doesn't exist.`);
  const { stock, reason, notes = "" } = req.body ?? {};
  invalid({
    stock: !(Number.isInteger(stock) && stock >= 0) && "Enter a whole number, 0 or more.",
    reason: !text(reason) && "Choose an adjustment reason.",
  });
  req.db.inventory = updateInventoryRecord(req.db.inventory, item.sku, stock);
  syncSnapshot(req.db, item, stock);
  logEvent(req, "Stock quantity updated", "Inventory", "Completed", `${item.sku} set to ${stock.toLocaleString()} units (${text(reason)})${text(notes) ? ` · ${text(notes)}` : ""}`);
  return ok(req.db.inventory.find((row) => row.sku === item.sku));
}

/** GET /inventory/alerts — products below their reorder level, most urgent first */
export function alerts(req) {
  const rank = { Critical: 0, Warning: 1 };
  return ok(
    req.db.inventory
      .filter((item) => item.status !== "Safe")
      .sort((a, b) => rank[a.status] - rank[b.status] || a.days - b.days)
      .map((item) => ({
        sku: item.sku,
        name: item.name,
        status: item.status,
        stock: item.stock,
        reorder: item.reorder,
        safety: item.safety,
        days: item.days,
        suggested: item.suggested,
        message:
          item.status === "Critical"
            ? `${item.sku} has ${item.days} day${item.days === 1 ? "" : "s"} of stock remaining`
            : `${item.sku} is below its reorder level (${item.stock.toLocaleString()} of ${item.reorder.toLocaleString()} units)`,
      })),
  );
}

/** GET /inventory/snapshots?start=YYYY-MM&end=YYYY-MM — month-end stock per product */
export function snapshots(req) {
  const { start, end } = req.query;
  invalid({
    start: start && !MONTH.test(start) && "Use a month like 2025-01.",
    end: end && !MONTH.test(end) && "Use a month like 2025-06.",
  });
  return ok(req.db.snapshots.filter((s) => (!start || s.month >= start) && (!end || s.month <= end)));
}

// ---------------------------------------------------------------------------
// Reorders: Ordered (placed by the Inventory Supervisor) → Delivered (Mark delivered: adds the quantity to stock)
// ---------------------------------------------------------------------------

/** GET /reorders — newest first */
export function reorders(req) {
  return ok(req.db.reorders);
}

/** POST /reorders { sku, quantity, supplier } → 201, status Ordered */
export function createReorder(req) {
  requireAction(req, "Update inventory");
  const { sku, quantity, supplier } = req.body ?? {};
  invalid({
    sku: !req.db.inventory.some((item) => item.sku === sku) && "Choose an existing product SKU.",
    quantity: !(Number.isInteger(quantity) && quantity > 0) && "Enter a whole number greater than 0.",
    supplier: !text(supplier) && "Choose a supplier.",
  });
  const order = {
    id: nextId("RO"),
    sku,
    quantity,
    supplier: text(supplier),
    status: "Ordered",
    orderedAt: now(),
    deliveredAt: null,
    userId: req.user.id,
    userName: req.user.name,
  };
  req.db.reorders.unshift(order);
  logEvent(req, "Reorder placed", "Inventory", "Completed", `${order.id} · ${sku}, ${quantity.toLocaleString()} units`);
  return created(order);
}

/** PATCH /reorders/{id} { status: "Delivered" } — adds the quantity to the product's stock */
export function updateReorder(req) {
  requireAction(req, "Update inventory");
  const order = req.db.reorders.find((r) => r.id === req.params.id);
  if (!order) fail(404, "not_found", "That reorder no longer exists.");
  const { status } = req.body ?? {};
  invalid({ status: status !== "Delivered" && 'Use "Delivered".' });
  if (order.status !== "Ordered") fail(409, "invalid_transition", `${order.id} has already been delivered.`);
  Object.assign(order, { status: "Delivered", deliveredAt: now() });
  let detail = `${order.id} · ${order.sku}, ${order.quantity.toLocaleString()} units`;
  const item = req.db.inventory.find((row) => row.sku === order.sku);
  if (item) {
    const stock = item.stock + order.quantity;
    req.db.inventory = updateInventoryRecord(req.db.inventory, order.sku, stock);
    syncSnapshot(req.db, item, stock);
    detail += ` · stock now ${stock.toLocaleString()}`;
  }
  logEvent(req, "Reorder delivered", "Inventory", "Completed", detail);
  return ok(order);
}
