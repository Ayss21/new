import { useId, useMemo, useState } from "react";

/** Rounds a raw step up to 1, 2, 2.5 or 5 × 10^n. */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
}

/**
 * Y-axis that hugs the data: starts just below the lowest value and ends just above the highest,
 * on rounded ticks (about `intervals` of them). Returns { min, max, ticks } (ticks from top to bottom).
 */
export function fittedAxis(values, intervals = 4) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (!values.length || !isFinite(low)) return { min: 0, max: 1, ticks: [1, 0] };
  const step = niceStep((high - low || Math.abs(high) || 1) / intervals);
  let min = Math.floor(low / step) * step;
  let max = Math.ceil(high / step) * step;
  if (min === low) min -= step;
  if (max === high) max += step;
  if (low >= 0 && min < 0) min = 0;
  const ticks = [];
  for (let v = max; v >= min - step / 2; v -= step) ticks.push(Math.round(v * 100) / 100);
  return { min, max, ticks };
}

const DAY = 86400000;
const dayNumber = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
const isoFromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const longDate = (iso) => `${shortDate(iso)}, ${iso.slice(0, 4)}`;
const axisNumber = (v) =>
  Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : Math.round(v).toLocaleString();

/**
 * Historical (solid teal + area) vs forecast (dashed) line chart, drawn in SVG on a true time axis.
 *   historical: [{ date: "YYYY-MM-DD", value }]          one point per day, oldest first
 *   forecast:   [{ date, value }] or plain numbers         numbers continue the day after the last historical day
 * The y-axis fits the data on rounded ticks unless `fitToData` is false (then it starts at 0).
 */
export function DataLineChart({ historical, forecast = [], fitToData = true, unitLabel = "Units", valueSuffix = "units" }) {
  const gradientId = useId();
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    const history = historical.filter((p) => p && p.date).map((p) => ({ day: dayNumber(p.date), date: p.date, value: p.value }));
    const lastDay = history.length ? history.at(-1).day : 0;
    const future = forecast.map((p, i) =>
      typeof p === "number"
        ? { day: lastDay + i + 1, date: isoFromDay(lastDay + i + 1), value: p }
        : { day: dayNumber(p.date), date: p.date, value: p.value },
    );
    const all = [...history, ...future];
    if (!all.length) return null;
    const first = all[0].day;
    const span = Math.max(1, all.at(-1).day - first);
    const values = all.map((p) => p.value);
    let axis;
    if (fitToData) axis = fittedAxis(values, 6);
    else {
      const top = fittedAxis([0, Math.max(...values, 1)], 5);
      axis = { min: 0, max: top.max, ticks: top.ticks };
    }
    const range = Math.max(1e-9, axis.max - axis.min);
    const x = (day) => ((day - first) / span) * 1000;
    const y = (value) => 1000 - ((value - axis.min) / range) * 1000;
    const line = (points) => points.map((p) => `${x(p.day).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
    const historyLine = line(history);
    const joined = history.length && future.length && future[0].day - history.at(-1).day === 1 ? [history.at(-1), ...future] : future;
    const forecastLine = line(joined);
    const area = history.length > 1 ? `${x(history[0].day)},1000 ${historyLine} ${x(history.at(-1).day)},1000` : "";
    const forecastStart = future.length ? x(future[0].day) / 10 : null;
    // About six evenly spaced date labels, always including the first and last day
    const labelCount = Math.min(6, all.length);
    const labelDays = Array.from({ length: labelCount }, (_, i) => Math.round(first + (span * i) / Math.max(1, labelCount - 1)));
    const byDay = new Map(all.map((p, i) => [p.day, { ...p, forecast: i >= history.length }]));
    return { history, future, axis, x, y, historyLine, forecastLine, area, forecastStart, labelDays, first, span, byDay };
  }, [historical, forecast, fitToData]);

  if (!model) return <div className="chart-empty">No data for the selected range</div>;
  const { axis, historyLine, forecastLine, area, forecastStart, labelDays, first, span, byDay } = model;
  const pct = (v) => 100 - ((v - axis.min) / Math.max(1e-9, axis.max - axis.min)) * 100;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const target = Math.round(first + ratio * span);
    let point = byDay.get(target);
    for (let d = 1; !point && d <= span; d++) point = byDay.get(target - d) || byDay.get(target + d);
    setHover(point ?? null);
  };

  const hoverLeft = hover ? ((hover.day - first) / span) * 100 : 0;
  const hoverTop = hover ? pct(hover.value) : 0;

  return (
    <div
      className="line-chart"
      role="img"
      aria-label={`Daily ${valueSuffix} from ${model.history[0]?.date ?? ""} to ${model.history.at(-1)?.date ?? ""}${
        model.future.length ? ` with a ${model.future.length}-day forecast` : ""
      }`}
    >
      <div className="lc-ytitle">{unitLabel}</div>
      <div className="lc-yaxis" aria-hidden="true">
        {axis.ticks.map((tick) => (
          <span key={tick} style={{ top: `${pct(tick)}%` }}>
            {axisNumber(tick)}
          </span>
        ))}
      </div>
      <div className="lc-plot" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {axis.ticks.map((tick) => (
          <i key={tick} className="lc-grid" style={{ top: `${pct(tick)}%` }} />
        ))}
        {forecastStart !== null && (
          <div className={`lc-forecast-zone ${forecastStart > 86 ? "narrow" : ""}`} style={{ left: `${forecastStart}%` }}>
            <span>Forecast</span>
          </div>
        )}
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {area && <polygon points={area} fill={`url(#${gradientId})`} />}
          {historyLine && <polyline className="lc-history" points={historyLine} />}
          {forecastLine && <polyline className="lc-forecast" points={forecastLine} />}
        </svg>
        {hover && (
          <>
            <i className="lc-crosshair" style={{ left: `${hoverLeft}%` }} />
            <b className={`lc-dot ${hover.forecast ? "is-forecast" : ""}`} style={{ left: `${hoverLeft}%`, top: `${hoverTop}%` }} />
            <div
              className={`lc-tip ${hoverLeft > 70 ? "flip" : ""} ${hoverTop < 25 ? "below" : ""}`}
              style={{ left: `${hoverLeft}%`, top: `${hoverTop}%` }}
            >
              <strong>{longDate(hover.date)}</strong>
              <span>
                <i className={hover.forecast ? "is-forecast" : ""} />
                {hover.forecast ? "Forecast" : "Actual"}: {Math.round(hover.value).toLocaleString()} {valueSuffix}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="lc-xaxis" aria-hidden="true">
        {labelDays.map((day, i) => (
          <span
            key={day}
            className={i === 0 ? "start" : i === labelDays.length - 1 ? "end" : ""}
            style={{ left: `${((day - first) / span) * 100}%` }}
          >
            {shortDate(isoFromDay(day))}
          </span>
        ))}
      </div>
    </div>
  );
}
