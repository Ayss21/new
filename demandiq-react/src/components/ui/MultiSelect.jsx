// Dropdown with checkboxes: pick any number of options. Nothing picked means all (shown as `allLabel`).
// The list opens below the button (above it when there's no room) and closes on Escape or a click outside.
// A long list (a catalog after a big upload) gets a search box and shows the first 200 matches.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const toOption = (option) => (typeof option === "object" ? option : { value: option, label: option });
const SEARCH_FROM = 12; // options before the list gets a search box
const SHOW_AT_MOST = 200;

/**
 * options: values, or { value, label, disabled? }. value: the picked values ([] = all).
 * summary: optional text for the button when several are picked (default "3 selected").
 */
export function MultiSelect({ options, value = [], onChange, allLabel = "All", ariaLabel, disabled = false, summary, className = "" }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null); // { top, left, width, maxHeight }
  const [query, setQuery] = useState("");
  const button = useRef(null);
  const panel = useRef(null);
  const id = useId();
  const items = options.map(toOption);
  const picked = value.filter((v) => items.some((item) => item.value === v));
  const labelOf = (v) => items.find((item) => item.value === v)?.label ?? v;
  const text = !picked.length ? allLabel : picked.length === 1 ? labelOf(picked[0]) : (summary?.(picked.length) ?? `${picked.length} selected`);

  const searchable = items.length > SEARCH_FROM;
  const words = query.trim().toLowerCase();
  const matching = words ? items.filter((item) => String(item.label).toLowerCase().includes(words)) : items;
  const shown = matching.slice(0, SHOW_AT_MOST);

  const toggle = (v) => onChange(picked.includes(v) ? picked.filter((x) => x !== v) : items.filter((item) => item.value === v || picked.includes(item.value)).map((item) => item.value));

  // Position the list under (or over) the button, inside the window
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const rect = button.current.getBoundingClientRect();
      const width = Math.max(rect.width, 190);
      const below = window.innerHeight - rect.bottom - 10;
      const above = rect.top - 10;
      const up = below < 180 && above > below;
      const maxHeight = Math.min(300, up ? above : below);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPlace(up ? { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight } : { top: rect.bottom + 4, left, width, maxHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // Close on a click outside or Escape (focus goes back to the button)
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!panel.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`multi-select ${className}`}>
      <button
        ref={button}
        type="button"
        className={`ms-trigger ${picked.length ? "has-value" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${text}` : undefined}
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        <span>{text}</span>
        {picked.length > 1 && <b className="ms-count">{picked.length}</b>}
        <Icon name="chevron" size={15} />
      </button>
      {open && place && (
        <div ref={panel} id={id} className="ms-panel" role="group" aria-label={ariaLabel} style={{ ...place, position: "fixed" }}>
          {searchable && (
            <input
              className="ms-search"
              type="search"
              placeholder="Search"
              aria-label={`Search ${ariaLabel ?? "options"}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          <label className={`ms-option ms-all ${picked.length ? "" : "is-checked"}`}>
            <input type="checkbox" checked={!picked.length} onChange={() => onChange([])} />
            <span>{allLabel}</span>
          </label>
          {shown.map((item) => (
            <label key={item.value} className={`ms-option ${picked.includes(item.value) ? "is-checked" : ""} ${item.disabled ? "is-disabled" : ""}`}>
              <input type="checkbox" checked={picked.includes(item.value)} disabled={item.disabled} onChange={() => toggle(item.value)} />
              <span>{item.label}</span>
            </label>
          ))}
          {matching.length > shown.length && <p className="ms-note">{(matching.length - shown.length).toLocaleString()} more · type to narrow</p>}
          {!matching.length && <p className="ms-note">No matches</p>}
        </div>
      )}
    </div>
  );
}
