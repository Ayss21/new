// Global filters panel on the left: date range, product category, SKU, region and forecasting model.
// Category, SKU, region and model take several values; nothing picked means all.
import { DATE_PRESETS, FORECAST_MODELS, presetRange } from "../../lib/domain";
import { daysInRange, formatRange } from "../../lib/format";
import { useStore } from "../../store/AppStore";
import { Button, Field, Icon, MultiSelect, Select } from "../ui";

const LISTS = ["category", "sku", "region", "model"];

export function FilterSidebar() {
  const { draftFilters, setDraftFilters, appliedFilters, applyFilters, clearFilters, inventory, categories, bounds } = useStore();
  const draft = draftFilters;
  const pending = JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters);
  const badRange = !draft.startDate || !draft.endDate || draft.startDate > draft.endDate;
  const rangeDays = badRange ? 0 : daysInRange(draft.startDate, draft.endDate);
  const activeCount = LISTS.filter((key) => appliedFilters[key]?.length).length;
  const set = (key, value) => setDraftFilters({ ...draft, [key]: value });
  const usePreset = (preset) => {
    const range = presetRange(preset, bounds.end, bounds.start) ?? [draft.startDate, draft.endDate];
    setDraftFilters({ ...draft, datePreset: preset, startDate: range[0], endDate: range[1] });
  };
  const categoryNames = Array.from(new Set([...categories.filter((c) => c.status === "Active").map((c) => c.name), ...inventory.map((i) => i.category)]));
  const regions = Array.from(new Set(inventory.map((item) => item.region)));

  return (
    <aside className="filters" aria-label="Global filters">
      <div className="filter-title">
        <div>
          <Icon name="filter" />
          <strong>Global filters</strong>
        </div>
        {activeCount > 0 && <span>{activeCount} active</span>}
      </div>
      <Field label="Date range">
        <Select value={draft.datePreset} onChange={usePreset} ariaLabel="Date range">
          {DATE_PRESETS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </Field>
      {draft.datePreset === "Custom Range" ? (
        <div className="date-custom">
          <label>
            <span>From</span>
            <input
              type="date"
              min={bounds.start}
              max={draft.endDate || bounds.end}
              value={draft.startDate}
              onChange={(e) => setDraftFilters({ ...draft, datePreset: "Custom Range", startDate: e.target.value })}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              min={draft.startDate || bounds.start}
              max={bounds.end}
              value={draft.endDate}
              onChange={(e) => setDraftFilters({ ...draft, datePreset: "Custom Range", endDate: e.target.value })}
            />
          </label>
        </div>
      ) : null}
      <div className={`date-summary ${badRange ? "invalid" : ""}`}>
        <Icon name="calendar" size={14} />
        {badRange ? (
          <span>The start date must be on or before the end date</span>
        ) : (
          <span>
            <b>{formatRange(draft.startDate, draft.endDate)}</b>
            <small>{rangeDays.toLocaleString()} days</small>
          </span>
        )}
      </div>
      <Field label="Product category" as="div">
        <MultiSelect
          ariaLabel="Product category"
          allLabel="All categories"
          options={categoryNames}
          value={draft.category}
          summary={(n) => `${n} categories`}
          onChange={(v) => set("category", v)}
        />
      </Field>
      <Field label="Product / SKU" as="div">
        <MultiSelect
          ariaLabel="Product / SKU"
          allLabel="All products"
          options={inventory.map((x) => ({ value: x.sku, label: `${x.sku} — ${x.name}` }))}
          value={draft.sku}
          summary={(n) => `${n} products`}
          onChange={(v) => set("sku", v)}
        />
      </Field>
      <Field label="Region" as="div">
        <MultiSelect ariaLabel="Region" allLabel="All regions" options={regions} value={draft.region} summary={(n) => `${n} regions`} onChange={(v) => set("region", v)} />
      </Field>
      <Field label="Forecasting model" as="div">
        <MultiSelect
          ariaLabel="Forecasting model"
          allLabel="All models"
          options={FORECAST_MODELS}
          value={draft.model}
          summary={(n) => `${n} models`}
          onChange={(v) => set("model", v)}
        />
      </Field>
      {pending && <p className="filters-pending">Apply to update the page.</p>}
      <div className="filter-actions">
        <Button variant="ghost" onClick={clearFilters}>
          Clear all
        </Button>
        <Button onClick={applyFilters} disabled={badRange}>
          Apply filters
        </Button>
      </div>
    </aside>
  );
}
