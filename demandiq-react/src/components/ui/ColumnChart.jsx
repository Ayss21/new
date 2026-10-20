// Vertical column chart drawn with CSS: units axis, gridlines, value labels and hover/focus tooltips.
// Columns grow to the height of their card, so the chart fills its panel instead of leaving gaps.

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
}

/** Axis from 0 to a rounded maximum, about four intervals. Ticks from top to bottom. */
export function columnAxis(values) {
  const high = Math.max(0, ...values);
  const step = niceStep((high || 1) / 4);
  const max = Math.max(step, Math.ceil(high / step) * step);
  const ticks = [];
  for (let v = max; v >= 0; v -= step) ticks.push(Math.round(v * 100) / 100);
  return { max, ticks };
}

/** 28,012 → "28.0K", 1,240,000 → "1.2M", 840 → "840". */
export const compactNumber = (n) =>
  n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n));

/** Axis ticks without a trailing ".0": 30000 → "30K", 2500 → "2.5K". */
export const axisNumber = (n) => compactNumber(n).replace(/\.0(?=[KM]$)/, "");

/**
 * data: [{ label, value, note?, tip? }] — note is shown under the label (e.g. a share),
 * tip is extra text for the tooltip. `highlight` is the index drawn in the darker palette colour.
 * minColumnWidth: each column is at least this wide and the chart scrolls sideways when they don't fit
 * (the units axis stays in view).
 */
export function ColumnChart({ data, unitLabel = "Units", format = compactNumber, axisFormat = axisNumber, valueSuffix = "units", highlight = 0, ariaLabel, minColumnWidth }) {
  const { max, ticks } = columnAxis(data.map((d) => d.value));
  const pct = (v) => (v / max) * 100;
  const yAxis = (
    <div className="cc-yaxis" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} style={{ top: `${100 - pct(t)}%` }}>
          {axisFormat(t)}
        </span>
      ))}
    </div>
  );
  const plot = (
    <div className="cc-plot">
      {ticks.map((t) => (
        <i key={t} className="cc-grid" style={{ top: `${100 - pct(t)}%` }} />
      ))}
      <div className="cc-columns">
        {data.map((d, i) => (
          <div className="cc-col" key={d.label}>
            <div
              className={`cc-bar ${i === highlight ? "is-top" : ""}`}
              style={{ height: `${Math.max(pct(d.value), 0.6)}%` }}
              tabIndex={0}
              aria-label={`${d.label}: ${Math.round(d.value).toLocaleString()} ${valueSuffix}${d.note ? `, ${d.note}` : ""}`}
            >
              <b>{format(d.value)}</b>
              <span className="cc-tip" role="tooltip">
                <strong>{d.label}</strong>
                {Math.round(d.value).toLocaleString()} {valueSuffix}
                {d.note && <> · {d.note}</>}
                {d.tip && (
                  <>
                    <br />
                    {d.tip}
                  </>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  const xAxis = (
    <div className="cc-xaxis" aria-hidden="true">
      {data.map((d) => (
        <span key={d.label}>
          {d.label}
          {d.note && <small>{d.note}</small>}
        </span>
      ))}
    </div>
  );
  const label = ariaLabel ?? `${unitLabel} by ${data.length} groups`;
  if (minColumnWidth)
    return (
      <div className="column-chart is-scrollable" role="group" aria-label={label}>
        <div className="cc-ytitle">{unitLabel}</div>
        <div className="cc-scroll" tabIndex={0} aria-label={`${label}, scrolls sideways`}>
          <div className="cc-scroll-inner" style={{ minWidth: `${46 + data.length * minColumnWidth}px` }}>
            {yAxis}
            {plot}
            {xAxis}
          </div>
        </div>
      </div>
    );
  return (
    <div className="column-chart" role="group" aria-label={label}>
      <div className="cc-ytitle">{unitLabel}</div>
      {yAxis}
      {plot}
      {xAxis}
    </div>
  );
}
