import { useState } from "react";
import { stockByCategory } from "../../lib/domain";
import { plural } from "../../lib/format";
import { Card, CardHeader, ColumnChart, EmptyState, Status, TableFooter, paginate, useFitRows } from "../../components/ui";
import { useWorkspace } from "../../store/WorkspaceContext";
import { MonthlyInventoryTrends } from "./MonthlyInventoryTrends";

const STATUSES = ["Safe", "Warning", "Critical"];
const COLOR = { Safe: "var(--green)", Warning: "var(--yellow)", Critical: "var(--red)" };

/** The donut's colours: the share of each shown status, in order. */
function donutStyle(counts, shown) {
  const total = shown.reduce((sum, status) => sum + counts[status], 0);
  if (!total) return { background: "var(--track)" };
  let start = 0;
  const stops = shown.map((status) => {
    const end = start + (counts[status] / total) * 100;
    const stop = `${COLOR[status]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return { background: `conic-gradient(${stops.join(", ")})` };
}

export function InventoryDashboard({ filters, records }) {
  const { openDrawer } = useWorkspace();
  const [focus, setFocus] = useState([]); // statuses picked in the legend ([] = all)
  const [page, setPage] = useState(1);
  const counts = Object.fromEntries(STATUSES.map((status) => [status, records.filter((r) => r.status === status).length]));
  const shown = focus.length ? STATUSES.filter((status) => focus.includes(status)) : STATUSES;
  const focusCount = shown.reduce((sum, status) => sum + counts[status], 0);
  const toggle = (status) => {
    setFocus(focus.includes(status) ? focus.filter((s) => s !== status) : [...focus, status]);
    setPage(1);
  };
  const reorderRecords = records.filter((record) => record.stock < record.reorder && (!focus.length || focus.includes(record.status)));
  const [reorderTable, pageSize] = useFitRows({ min: 5 });
  const pageData = paginate(reorderRecords, page, pageSize);
  const byCategory = stockByCategory(records);
  const totalStock = byCategory.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="dashboard-grid role-grid">
      <Card className="status-donut-card">
        <CardHeader title="Inventory status distribution" subtitle="Select statuses to focus" />
        <div className="donut-wrap">
          <button
            className="donut interactive-donut"
            title={`${counts.Safe} safe, ${counts.Warning} warning, ${counts.Critical} critical`}
            style={donutStyle(counts, shown)}
            onClick={() => {
              setFocus([]);
              setPage(1);
            }}
            aria-label="Show all statuses"
          >
            <div>
              <strong>{focusCount}</strong>
              <span>{focus.length === 1 ? focus[0] : "SKUs"}</span>
            </div>
          </button>
          <div className="donut-legend interactive-legend">
            {STATUSES.map((status) => (
              <button className={focus.includes(status) ? "active" : ""} key={status} onClick={() => toggle(status)} aria-pressed={focus.includes(status)}>
                <span>
                  <i className={status === "Safe" ? "safe" : status === "Warning" ? "warn" : "crit"} />
                  {status}
                </span>
                <strong>
                  {counts[status]}{" "}
                  <small>{records.length ? `${((counts[status] / records.length) * 100).toFixed(0)}%` : "0%"}</small>
                </strong>
              </button>
            ))}
          </div>
        </div>
      </Card>
      <Card className="stock-category-card">
        <CardHeader
          title="Stock levels by category"
          subtitle={`${plural(totalStock, "unit")} in stock · ${plural(records.length, "product")} in ${plural(byCategory.length, "category", "categories")}`}
        />
        {byCategory.length ? (
          <ColumnChart
            unitLabel="Units"
            ariaLabel="Units in stock by category"
            data={byCategory.map((item) => ({
              label: item.label,
              value: item.value,
              note: `${item.products.length.toLocaleString()} product${item.products.length === 1 ? "" : "s"}`,
              tip: item.products.join(", "),
            }))}
          />
        ) : (
          <EmptyState inline title="No products match the filters" detail="Clear or adjust the global filters." />
        )}
      </Card>
      <div className="span-2">
        <MonthlyInventoryTrends filters={filters} />
      </div>
      <Card className="span-2">
        <CardHeader
          title="Reorder recommendations"
          subtitle={focus.length ? `${shown.join(", ")} products below reorder level` : "Products below reorder level"}
        />
        <div className="table-wrap">
          <table ref={reorderTable}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Stock</th>
                <th>Reorder level</th>
                <th>Suggested quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageData.rows.map((record) => (
                <tr key={record.sku}>
                  <td>
                    <button className="table-link" onClick={() => openDrawer({ type: "inventory", sku: record.sku })}>
                      <strong>{record.sku}</strong>
                    </button>
                  </td>
                  <td>{record.name}</td>
                  <td>{record.stock}</td>
                  <td>{record.reorder}</td>
                  <td>{record.suggested}</td>
                  <td>
                    <Status value={record.status} />
                  </td>
                </tr>
              ))}
              {!pageData.rows.length && (
                <tr>
                  <td colSpan={6}>No products below their reorder level.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TableFooter
          label={plural(reorderRecords.length, "recommendation")}
          page={pageData.page}
          pageCount={pageData.pageCount}
          onPage={setPage}
        />
      </Card>
    </div>
  );
}
