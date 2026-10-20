// POST /reorders through the store: the order is placed (Ordered) and shows in Inventory → Reorder status.
import { useState } from "react";
import { plural } from "../../lib/format";
import { useStore } from "../../store/AppStore";
import { Button, Field, Icon, Modal, Select, Status } from "../ui";

export function ReorderModal({ sku, onClose }) {
  const { inventory, createReorder, notify } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const item = inventory.find((row) => row.sku === sku) ?? inventory[0];
  const suggested = item ? item.suggested || Math.max(1, item.reorder - item.stock + item.safety) : 1;
  const [quantity, setQuantity] = useState(String(suggested));
  const [supplier, setSupplier] = useState("Approved supplier · SUP-024");
  const value = Number(quantity);
  const invalid = quantity.trim() === "" || !Number.isInteger(value) || value <= 0;
  if (!item) return null;

  return (
    <Modal title="Place reorder" onClose={onClose}>
      <div className="modal-body">
        <div className="product-inline">
          <strong>
            {item.sku} · {item.name}
          </strong>
          <Status value={item.status} />
        </div>
        <div className="form-grid">
          <Field
            label="Quantity"
            error={invalid ? "Enter a whole number greater than 0." : null}
            helper={`Suggested: ${plural(suggested, "unit")}`}
          >
            <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Destination">
            <input value={item.location} readOnly />
          </Field>
        </div>
        <Field label="Preferred supplier">
          <Select value={supplier} onChange={setSupplier}>
            <option>Approved supplier · SUP-024</option>
            <option>Request sourcing review</option>
          </Select>
        </Field>
        <div className="risk-callout">
          <Icon name="warning" />
          <div>
            <strong>{plural(item.days, "day")} of stock remaining</strong>
            <p>The order is placed now. Mark it delivered when it arrives to add the quantity to stock.</p>
          </div>
        </div>
        {error && (
          <div className="form-error no-margin" role="alert">
            <Icon name="warning" size={16} />
            {error.message}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="yellow"
          disabled={invalid || saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const result = await createReorder(item.sku, value, supplier);
            setSaving(false);
            if (!result.ok) return setError(result.error);
            notify(`${result.data.id} ordered · ${plural(value, "unit")} of ${item.sku}.`);
            onClose();
          }}
        >
          {saving ? "Placing order…" : "Place order"}
        </Button>
      </div>
    </Modal>
  );
}
