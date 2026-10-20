// Pie chart drawn in SVG: one slice per item, a 2px surface gap between slices, percentage labels on
// slices that have room, a hover / keyboard-focus tooltip, and an optional click handler per slice.
import { useState } from "react";

const TAU = Math.PI * 2;
const point = (radius, angle) => [radius * Math.sin(angle), -radius * Math.cos(angle)];

/** Slice geometry for items with value > 0, clockwise from 12 o'clock. Exported for tests. */
export function pieSlices(items, radius = 100) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  let start = 0;
  return items
    .filter((item) => item.value > 0)
    .map((item) => {
      const sweep = (item.value / total) * TAU;
      const end = start + sweep;
      const mid = start + sweep / 2;
      const [x0, y0] = point(radius, start);
      const [x1, y1] = point(radius, end);
      const path =
        sweep >= TAU - 1e-9
          ? null // a single item fills the circle
          : `M 0 0 L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
      const slice = { ...item, share: item.value / total, start, end, mid, sweep, path };
      start = end;
      return slice;
    });
}

const percent = (share) => `${Math.round(share * 100)}%`;

/**
 * items: [{ key, label, value, color, labelColor, detail? }]
 *   color      slice fill (a CSS colour or var())
 *   labelColor colour of the percentage printed on the slice
 *   detail     extra tooltip line
 * onSelect(key) makes slices clickable (Enter / Space too). `active` lifts the matching slice.
 * tip(slice) replaces the tooltip's content (e.g. only the recommended model).
 */
export function PieChart({ items, unit = "items", onSelect, active, ariaLabel, size = 156, tip }) {
  const [hover, setHover] = useState(null); // { key, x, y } — x / y in % of the chart box
  const slices = pieSlices(items);
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (!total) return null;
  const lifted = hover?.key ?? active ?? null;
  const shown = slices.find((s) => s.key === hover?.key);

  const placeAt = (slice, event) => {
    if (event?.clientX != null) {
      const box = event.currentTarget.ownerSVGElement.getBoundingClientRect();
      return { key: slice.key, x: ((event.clientX - box.left) / box.width) * 100, y: ((event.clientY - box.top) / box.height) * 100 };
    }
    const [x, y] = point(62, slice.mid); // keyboard focus: tooltip at the slice centre
    return { key: slice.key, x: 50 + x / 2.2, y: 50 + y / 2.2 };
  };

  return (
    <div className="pie-chart" style={{ width: size, height: size }}>
      <svg viewBox="-110 -110 220 220" role="group" aria-label={ariaLabel}>
        {slices.map((slice) => {
          const [dx, dy] = slice.key === lifted && slices.length > 1 ? point(6, slice.mid) : [0, 0];
          const label = `${slice.label}: ${slice.value.toLocaleString()} ${unit} (${(slice.share * 100).toFixed(1)}%)`;
          const shared = {
            className: `pie-slice ${onSelect ? "is-clickable" : ""} ${slice.key === lifted ? "is-lifted" : ""}`,
            style: { fill: slice.color },
            transform: `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`,
            tabIndex: onSelect ? 0 : -1,
            role: onSelect ? "button" : "img",
            "aria-label": onSelect ? `${label}. ${slice.detail ?? "Select for details"}` : label,
            onMouseMove: (e) => setHover(placeAt(slice, e)),
            onMouseLeave: () => setHover(null),
            onFocus: () => setHover(placeAt(slice)),
            onBlur: () => setHover(null),
            onClick: onSelect ? () => onSelect(slice.key) : undefined,
            onKeyDown: onSelect
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(slice.key);
                  }
                }
              : undefined,
          };
          return slice.path ? <path key={slice.key} d={slice.path} {...shared} /> : <circle key={slice.key} r="100" {...shared} />;
        })}
        {slices
          .filter((slice) => slice.sweep >= 0.42) // about 24°, enough room for "18%"
          .map((slice) => {
            const [dx, dy] = slice.key === lifted && slices.length > 1 ? point(6, slice.mid) : [0, 0];
            const [x, y] = slices.length > 1 ? point(62, slice.mid) : [0, 0];
            return (
              <text key={slice.key} className="pie-label" x={(x + dx).toFixed(2)} y={(y + dy).toFixed(2)} style={{ fill: slice.labelColor }} aria-hidden="true">
                {percent(slice.share)}
              </text>
            );
          })}
      </svg>
      {shown && (
        <div className="pie-tip" style={{ left: `${hover.x}%`, top: `${hover.y}%` }} role="tooltip">
          {tip ? (
            tip(shown)
          ) : (
            <>
              <strong>
                {shown.value.toLocaleString()} {unit} · {(shown.share * 100).toFixed(1)}%
              </strong>
              <span>
                <i style={{ background: shown.color }} />
                {shown.label}
              </span>
              {shown.detail && <small>{shown.detail}</small>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
