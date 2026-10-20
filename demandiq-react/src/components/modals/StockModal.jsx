// PATCH /inventory/{sku} through the store.
import { useState } from "react";
import { plural } from "../../lib/format";
import { useStore } from "../../store/AppStore";
import { Button, Field, Icon, Modal, Select, Status } from "../ui";

export function StockModal({ sku, onClose }) {
  const { inventory, updateStock, notify } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const item = inventory.find((row) => row.sku === sku) ?? inventory[0];
  const [quantity, setQuantity] = useState(String(item?.stock ?? 0));
  const [reason, setReason] = useState("Physical stock count");
  const [notes, setNotes] = useState("");
  const value = Number(quantity);
  const invalid = quantity.trim() === "" || !Number.isInteger(value) || value < 0;
  if (!item) return null;

  return (
    <Modal title="Update stock quantity" onClose={onClose}>
      <div className="modal-body">
        <div className="product-inline">
          <strong>
            {item.sku} · {item.name}
          </strong>
          <Status value={item.status} />
        </div>
        <div className="form-grid">
          <Field label="Current stock">
            <input value={plural(item.stock, "unit")} readOnly />
          </Field>
          <Field label="New quantity" error={invalid ? "Enter a whole number, 0 or more." : null}>
            <input type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
        <Field label="Adjustment reason">
          <Select value={reason} onChange={setReason}>
            <option>Physical stock count</option>
            <option>Goods received</option>
            <option>Inventory correction</option>
            <option>Damaged or expired stock</option>
          </Select>
        </Field>
        <Field label="Notes">
          <textarea placeholder="Add supporting details..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
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
          disabled={invalid || saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const result = await updateStock(item.sku, value, reason, notes);
            setSaving(false);
            if (!result.ok) return setError(result.error);
            notify("Stock quantity updated successfully.");
            onClose();
          }}
        >
          {saving ? "Saving…" : "Confirm update"}
        </Button>
      </div>
    </Modal>
  );
}
