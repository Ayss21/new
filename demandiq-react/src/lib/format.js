// Date and number formatting matching the Figma prototype ("18 Jun 2025, 09:48").

/** "14 Oct 2026, 10:42" (or "14 Oct 2026, 10:42:18" with seconds). */
export function formatDateTime(iso, withSeconds = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}), hour12: false });
  return `${date}, ${time}`;
}

/** "18 Jun, 10:42" — the short form used in activity logs. */
export function shortStamp(date = new Date()) {
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

export function money(value) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-03-19" → "19 Mar 2025" */
export function formatDay(iso) {
  return iso ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : "—";
}

/** "2025-03-19" → "19 Mar" */
export function formatShortDay(iso) {
  return iso ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}` : "—";
}

/** "2025-03-19", "2025-06-18" → "19 Mar – 18 Jun 2025" (the year is written once when both dates share it). */
export function formatRange(start, end) {
  if (!start || !end) return "—";
  if (start.slice(0, 4) === end.slice(0, 4)) return `${+start.slice(8, 10)} ${MONTHS[+start.slice(5, 7) - 1]} – ${formatDay(end)}`;
  return `${formatDay(start)} – ${formatDay(end)}`;
}

/** Number of calendar days from start to end, both included. */
export function daysInRange(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}

/** 1 → "1 category", 5 → "5 categories" (pass the plural when it isn't word + "s"). */
export function plural(count, word, many = `${word}s`) {
  return `${count.toLocaleString()} ${count === 1 ? word : many}`;
}
