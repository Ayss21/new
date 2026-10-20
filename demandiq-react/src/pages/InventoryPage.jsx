// Inventory: stock levels, reorder level / safety stock, safe-warning-critical status and reorder status.
// Stock updates and new reorders start from a record's Review (the side drawer).
// Reorder status: Ordered (placed) → Delivered (Mark delivered: adds the quantity to stock).
// API: GET /inventory and GET /reorders (loaded by the store), PATCH /reorders/{id} (through the store).
import { useState } from "react";
import { filterInventory } from "../lib/domain";
import { formatDateTime, plural } from "../lib/format";
import { useStore } from "../store/AppStore";
import { useWorkspace } from "../store/WorkspaceContext";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  SearchBox,
  Select,
  Status,
  TableFooter,
  paginate,
  useFitRows,
} from "../components/ui";

/** When an order was delivered (shown on hover). */
const statusTime = (r) => (r.deliveredAt ? `Delivered ${formatDateTime(r.deliveredAt)}` : `Ordered ${formatDateTime(r.orderedAt)}`);

export default function InventoryPage() {
  const { inventory, appliedFilters, can, level, canExport, reorders, updateReorder, notify } = useStore();
  const { openDrawer, openExport } = useWorkspace();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("sku");
  const [page, setPage] = useState(1);
  const [reorderPage, setReorderPage] = useState(1);
  const [savingId, setSavingId] = useState(null); // reorder being marked delivered
  const canManage = can("Update inventory");
  // The Admin sees the actions switched off ("View")
  const seesActions = level("Update inventory") !== "No";

  /** PATCH /reorders/{id} { status: "Delivered" } — the server adds the quantity to stock */
  const markDelivered = async (order) => {
    setSavingId(order.id);
    const result = await updateReorder(order.id, "Delivered");
    setSavingId(null);
    if (!result.ok) return notify(result.error.message, 4500, "error");
    notify(`${order.id} delivered · ${plural(order.quantity, "unit")} added to ${order.sku}.`);
  };

  const scoped = filterInventory(inventory, appliedFilters);
  const matching = scoped.filter((r) =>
    [r.sku, r.name, r.category, r.location, r.region, r.status].some((v) =>
      v.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  const statusOrder = { Critical: 0, Warning: 1, Safe: 2 };
  const sorted = [...matching].sort((a, b) =>
    sort === "stock"
      ? a.stock - b.stock
      : sort === "status"
        ? statusOrder[a.status] - statusOrder[b.status] || a.sku.localeCompare(b.sku)
        : a.sku.localeCompare(b.sku),
  );
  const [stockTable, pageSize] = useFitRows({ min: 5, stopAt: ".reorder-status-card" });
  const pageData = paginate(sorted, page, pageSize);
  const reorderRows = paginate(reorders, reorderPage, 5);
  const open = reorders.filter((r) => r.status === "Ordered").length;

  return (
    <div className={`page-stack inventory-page ${reorders.length ? "has-reorders" : ""}`}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">INVENTORY CONTROL</span>
          <h1>Inventory</h1>
        </div>
        {canExport("Reorder Recommendation Report") && (
          <Button variant="secondary" icon="download" onClick={() => openExport("XLSX", "Reorder Recommendation Report")}>
            Export recommendations
          </Button>
        )}
      </div>
      <Card>
        <div className="inventory-table-toolbar">
          <div>
            <strong>{plural(matching.length, "inventory record")}</strong>
          </div>
          <div className="table-tools">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search SKU or product"
            />
            <Select value={sort} onChange={setSort} ariaLabel="Sort inventory">
              <option value="sku">Sort by SKU</option>
              <option value="stock">Sort by stock</option>
              <option value="status">Sort by status</option>
            </Select>
          </div>
        </div>
        <div className="table-wrap">
          <table ref={stockTable}>
            <thead>
              <tr>
                <th>SKU / Product</th>
                <th>Location</th>
                <th>Current stock</th>
                <th>Forecast demand</th>
                <th>Reorder / Safety</th>
                <th>Suggested order</th>
                <th>Days left</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageData.rows.map((r) => (
                <tr key={r.sku}>
                  <td>
                    <button className="table-link" onClick={() => openDrawer({ type: "inventory", sku: r.sku })}>
                      {r.name}
                      <small>
                        {r.sku} · {r.category}
                      </small>
                    </button>
                  </td>
                  <td>{r.location}</td>
                  <td>
                    <strong>{r.stock.toLocaleString()}</strong> {r.stock === 1 ? "unit" : "units"}
                  </td>
                  <td>{plural(r.demand, "unit")}</td>
                  <td>
                    {r.reorder} / {r.safety}
                  </td>
                  <td>
                    <strong>{r.suggested ? r.suggested.toLocaleString() : "—"}</strong>
                  </td>
                  <td>{plural(r.days, "day")}</td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td>
                    <Button variant="ghost" onClick={() => openDrawer({ type: "inventory", sku: r.sku })}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pageData.rows.length && (
            <EmptyState inline title="No inventory records found" detail="Clear the search or adjust global filters." />
          )}
        </div>
        <TableFooter
          label={`Showing ${pageData.rows.length} of ${matching.length.toLocaleString()} matching SKUs`}
          page={pageData.page}
          pageCount={pageData.pageCount}
          onPage={setPage}
        />
      </Card>
      {reorders.length > 0 && (
        <Card className="reorder-status-card">
          <CardHeader title="Reorder status" action={<Status value={open ? `${open} open` : "Completed"} />} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>SKU</th>
                  <th>Quantity</th>
                  <th>Supplier</th>
                  <th>Ordered by</th>
                  <th>Ordered</th>
                  <th>Status</th>
                  {seesActions && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {reorderRows.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.id}</strong>
                    </td>
                    <td>{r.sku}</td>
                    <td>{plural(r.quantity, "unit")}</td>
                    <td>{r.supplier}</td>
                    <td>{r.userName}</td>
                    <td>{formatDateTime(r.orderedAt)}</td>
                    <td title={statusTime(r)}>
                      <Status value={r.status} />
                    </td>
                    {seesActions && (
                      <td className="row-actions">
                        {r.status === "Delivered" ? (
                          <span className="muted">—</span>
                        ) : (
                          <Button
                            variant="ghost"
                            icon="check"
                            disabled={!canManage || savingId === r.id}
                            title={canManage ? undefined : "View only"}
                            onClick={() => markDelivered(r)}
                          >
                            {savingId === r.id ? "Saving…" : "Mark delivered"}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reorders.length > 5 && (
            <TableFooter
              label={reorderRows.label}
              page={reorderRows.page}
              pageCount={reorderRows.pageCount}
              onPage={setReorderPage}
            />
          )}
        </Card>
      )}
    </div>
  );
}
