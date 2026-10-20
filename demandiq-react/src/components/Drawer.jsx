// Side drawer: inventory product detail, or details of an activity / error log entry.
import { useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { formatDateTime, plural } from "../lib/format";
import { formatSessionDuration } from "../lib/activity";
import { roleName } from "../lib/roles";
import { useWorkspace } from "../store/WorkspaceContext";
import { Button, CardHeader, Field, Icon, Status } from "./ui";

const TROUBLESHOOTING = {
  Forecasting: [
    "Check that the SKU has at least 21 days of history in the selected date range.",
    "For ARIMA, lower p, d or q, or widen the date range so there is enough history.",
    "Compare with Moving Average or Linear Regression from the Forecasting page.",
  ],
  "Sales Upload": [
    "Use a CSV, TSV or Excel (.xlsx) file with the columns Date, Product_ID and Units_Sold.",
    "Dates must use YYYY-MM-DD and Product_ID must be an existing SKU.",
  ],
  "Reports & Exports": ["Retry the export with a narrower filter.", "Use CSV or XLSX for very large datasets."],
};

function weeklyTrend(units) {
  const weeks = [];
  for (let end = units.length; end > 0 && weeks.length < 8; end -= 7) {
    weeks.unshift(units.slice(Math.max(0, end - 7), end).reduce((sum, row) => sum + row.units, 0));
  }
  const max = Math.max(...weeks, 1);
  return weeks.map((value) => ({ value, height: Math.max(8, Math.round((value / max) * 100)) }));
}

export function Drawer({ target, onClose }) {
  const { inventory, sales, activity, sessions, errors, can, level, setErrorStatus, notify } = useStore();
  const { selectInventoryAction } = useWorkspace();
  const [saving, setSaving] = useState(null); // the error status being saved

  const product = target.type === "inventory" ? inventory.find((x) => x.sku === target.sku) : undefined;
  const event = target.type === "activity" ? activity.find((row) => row.id === target.id) : undefined;
  const session = event?.sessionId ? sessions.find((s) => s.id === event.sessionId) : null;
  const error = target.type === "error" ? errors.find((e) => e.id === target.errorId) : undefined;
  const [notes, setNotes] = useState(error?.notes ?? ""); // the notes saved with the error, if any

  /** PATCH /errors/{id} { status, notes } */
  const markError = async (status) => {
    setSaving(status);
    const result = await setErrorStatus(error.id, status, notes);
    setSaving(null);
    if (!result.ok) return notify(result.error.message, 4500, "error");
    notify(`Error marked as ${status.toLowerCase()}.`);
    if (status === "Resolved") onClose();
  };

  const trend = useMemo(() => {
    if (!product) return [];
    const daily = new Map();
    sales
      .filter((row) => row.sku === product.sku)
      .forEach((row) => daily.set(row.date, (daily.get(row.date) ?? 0) + row.units));
    return weeklyTrend(
      Array.from(daily, ([date, units]) => ({ date, units })).sort((a, b) => a.date.localeCompare(b.date)),
    );
  }, [product, sales]);

  const eyebrow = product ? "INVENTORY DETAIL" : error ? "SYSTEM ERROR" : "AUDIT EVENT";
  const title = product ? product.name : error ? "Error details" : "Activity details";

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {product && (
          <>
            <div className="drawer-body">
              <div className="product-head">
                <div>
                  <span>{product.sku}</span>
                  <small>
                    {product.category} · {product.location}
                  </small>
                </div>
                <Status value={product.status} />
              </div>
              <div className="detail-kpis">
                <div>
                  <span>Current stock</span>
                  <strong>{product.stock.toLocaleString()}</strong>
                  <small>units available</small>
                </div>
                <div>
                  <span>Days remaining</span>
                  <strong>{product.days}</strong>
                  <small>at current demand</small>
                </div>
              </div>
              {product.status === "Safe" ? (
                <div className="info-callout no-margin drawer-callout">
                  <Icon name="check" />
                  <p>
                    Stock is above the reorder level of {plural(product.reorder, "unit")}, so no reorder is suggested. Forecast
                    demand of {plural(product.demand, "unit")} is covered for about {plural(product.days, "day")}.
                  </p>
                </div>
              ) : (
                <div className="risk-callout">
                  <Icon name="warning" />
                  <div>
                    <strong>Why this item was flagged</strong>
                    <p>
                      {product.status === "Critical"
                        ? `Current stock is at or near the safety stock of ${plural(product.safety, "unit")}.`
                        : `Current stock is below the reorder level of ${plural(product.reorder, "unit")}.`}{" "}
                      Forecast demand of {plural(product.demand, "unit")} may exceed available stock within{" "}
                      {plural(product.days, "day")}.
                    </p>
                  </div>
                </div>
              )}
              <CardHeader
                title="Recommendation breakdown"
                subtitle="30-day demand + safety stock − current inventory"
              />
              <div className="calculation">
                {[
                  ["30-day demand", product.demand],
                  ["Safety stock", product.safety],
                  ["Current inventory", `− ${product.stock.toLocaleString()}`],
                  ["Suggested reorder", product.suggested || "No order"],
                ].map((x, i) => (
                  <div className={i === 3 ? "total" : ""} key={x[0]}>
                    <span>{x[0]}</span>
                    <strong>
                      {typeof x[1] === "number" ? x[1].toLocaleString() : x[1]} {i < 3 && "units"}
                    </strong>
                  </div>
                ))}
              </div>
              <CardHeader title="Recent demand trend" subtitle={`Units sold in the last ${trend.length} weeks`} />
              <div
                className="mini-bars"
                role="img"
                aria-label={`Weekly units: ${trend.map((t) => t.value).join(", ")}`}
              >
                {trend.map((t, i) => (
                  <i key={i} style={{ height: `${t.height}%` }} title={`${t.value.toLocaleString()} units`} />
                ))}
              </div>
            </div>
            {level("Update inventory") !== "No" && (
              <div className="drawer-actions">
                <Button
                  variant="secondary"
                  disabled={!can("Update inventory")}
                  title={can("Update inventory") ? undefined : "View only"}
                  onClick={() => selectInventoryAction(product.sku, "stock")}
                >
                  Update stock
                </Button>
                <Button
                  variant="yellow"
                  disabled={!can("Update inventory")}
                  title={can("Update inventory") ? undefined : "View only"}
                  onClick={() => selectInventoryAction(product.sku, "reorder")}
                >
                  Place reorder
                </Button>
              </div>
            )}
          </>
        )}

        {event && (
          <div className="drawer-body">
            <div className="event-summary">
              <Status value={event.status} />
              <span>{event.id}</span>
            </div>
            <div className="detail-list">
              {[
                ["Event time", formatDateTime(event.at, true)],
                ["Action", event.action],
                ["Module", event.module],
                ["Details", event.details || "—"],
                ["User", event.userId ? `${event.userName} (${event.userId})` : event.userName],
                ["Role", event.roleId ? roleName(event.roleId) : "—"],
                ["Session", session ? session.id : "No session (signed out)"],
                ["Login", session ? formatDateTime(session.loginAt) : "—"],
                ["Logout time", session?.logoutAt ? formatDateTime(session.logoutAt) : "—"],
                ["Session time", session ? formatSessionDuration(session.loginAt, session.logoutAt) : "—"],
              ].map((x) => (
                <div key={x[0]}>
                  <span>{x[0]}</span>
                  <strong>{x[1]}</strong>
                </div>
              ))}
            </div>
            <div className="info-callout no-margin drawer-callout">
              <Icon name="shield" />
              <p>No sensitive credentials or authentication tokens are included in this audit event.</p>
            </div>
          </div>
        )}

        {error && (
          <>
            <div className="drawer-body">
              <div className="event-summary">
                <Status value={error.severity} />
                <span>{error.id}</span>
              </div>
              <div className="detail-list">
                {[
                  ["Module", error.module],
                  ["Error type", error.type],
                  ["Reported", formatDateTime(error.at)],
                  ["Resolution", error.status],
                ].map((x) => (
                  <div key={x[0]}>
                    <span>{x[0]}</span>
                    <strong>{x[1]}</strong>
                  </div>
                ))}
              </div>
              <div className="risk-callout">
                <Icon name="warning" />
                <div>
                  <strong>{error.type}</strong>
                  <p>{error.message}</p>
                </div>
              </div>
              <CardHeader title="Suggested troubleshooting" />
              <ol className="steps">
                {(
                  TROUBLESHOOTING[error.module] ?? [
                    "Review the related records.",
                    "Retry the action.",
                    "Contact support if the problem continues.",
                  ]
                ).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <Field label="Resolution notes">
                <textarea
                  placeholder={error.status === "Resolved" ? "No notes were added." : "Add notes for the audit record..."}
                  value={notes}
                  readOnly={error.status === "Resolved"}
                  maxLength={1000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </div>
            {error.status !== "Resolved" && (
              <div className="drawer-actions">
                <Button variant="secondary" disabled={error.status === "Investigating" || Boolean(saving)} onClick={() => markError("Investigating")}>
                  {saving === "Investigating" ? "Saving…" : "Mark investigating"}
                </Button>
                <Button disabled={Boolean(saving)} onClick={() => markError("Resolved")}>
                  {saving === "Resolved" ? "Saving…" : "Mark resolved"}
                </Button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
