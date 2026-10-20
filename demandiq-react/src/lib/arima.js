// ARIMA(p, d, q) that runs in the browser.
// Estimated with the Hannan–Rissanen method: difference the series d times,
// fit a long AR model to estimate past errors, then regress each value on its
// p previous values and q previous errors. Forecasts are integrated back.

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Least squares X·b = y via the normal equations (tiny ridge for stability). */
function leastSquares(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j];
      A[i][k] += X[r][i] * y[r];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-8;
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const div = A[col][col] || 1e-12;
    for (let c = col; c <= k; c++) A[col][c] /= div;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = col; c <= k; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[k]);
}

/** Keeps coefficients in a range where forecasts stay stable. */
function shrink(coefs) {
  const total = coefs.reduce((s, c) => s + Math.abs(c), 0);
  return total >= 0.98 ? coefs.map((c) => (c * 0.98) / total) : coefs;
}

export function arimaMinimumHistory(p, d, q) {
  return 3 * (p + q + d) + 10;
}

export function validateArimaOrder(order) {
  const [p, d, q] = order;
  if (order.length !== 3 || order.some((v) => !Number.isInteger(v))) return "ARIMA order values must be whole numbers.";
  if (p < 0 || p > 5) return "p must be between 0 and 5.";
  if (d < 0 || d > 2) return "d must be between 0 and 2.";
  if (q < 0 || q > 5) return "q must be between 0 and 5.";
  return null;
}

/** Returns `horizon` forecasts for the series `y`. */
export function arimaForecast(y, horizon, p, d, q) {
  const minimum = arimaMinimumHistory(p, d, q);
  if (y.length < minimum)
    throw new Error(`ARIMA(${p},${d},${q}) needs at least ${minimum} historical periods; ${y.length} available.`);

  // 1) Differencing
  const levels = [y];
  for (let i = 0; i < d; i++) {
    const prev = levels[levels.length - 1];
    levels.push(prev.slice(1).map((v, j) => v - prev[j]));
  }
  const z = levels[d];
  const n = z.length;
  const useConstant = d <= 1;

  // 2) Long AR model to estimate the error terms (only when q > 0)
  const m = q > 0 ? Math.min(Math.max(p + q, Math.floor(n / 5)), 12) : 0;
  let eHat = new Array(n).fill(0);
  if (q > 0) {
    const X = [];
    const Y = [];
    for (let t = m; t < n; t++) {
      X.push([1, ...Array.from({ length: m }, (_, i) => z[t - 1 - i])]);
      Y.push(z[t]);
    }
    const b = leastSquares(X, Y);
    eHat = z.map((v, t) => {
      if (t < m) return 0;
      let fit = b[0];
      for (let i = 0; i < m; i++) fit += b[i + 1] * z[t - 1 - i];
      return v - fit;
    });
  }

  // 3) Regress z on its own lags and lagged errors
  let c = useConstant ? mean(z) : 0;
  let phi = [];
  let theta = [];
  if (p + q > 0) {
    const start = Math.max(p, m + q);
    const X = [];
    const Y = [];
    for (let t = start; t < n; t++) {
      const row = useConstant ? [1] : [];
      for (let i = 1; i <= p; i++) row.push(z[t - i]);
      for (let j = 1; j <= q; j++) row.push(eHat[t - j]);
      X.push(row);
      Y.push(z[t]);
    }
    const b = leastSquares(X, Y);
    const off = useConstant ? 1 : 0;
    c = useConstant ? b[0] : 0;
    phi = shrink(b.slice(off, off + p));
    theta = shrink(b.slice(off + p, off + p + q));
  }

  // Residuals of the fitted model
  const zMean = mean(z);
  const eps = new Array(n).fill(0);
  for (let t = 0; t < n; t++) {
    let fit = c;
    for (let i = 1; i <= p; i++) fit += phi[i - 1] * (t - i >= 0 ? z[t - i] : zMean);
    for (let j = 1; j <= q; j++) fit += theta[j - 1] * (t - j >= 0 ? eps[t - j] : 0);
    eps[t] = z[t] - fit;
  }

  // Forecast the differenced series (future errors = 0)
  const zExt = [...z];
  const eExt = [...eps];
  const zHat = [];
  for (let k = 0; k < horizon; k++) {
    const t = n + k;
    let f = c;
    for (let i = 1; i <= p; i++) f += phi[i - 1] * zExt[t - i];
    for (let j = 1; j <= q; j++) f += theta[j - 1] * eExt[t - j];
    zExt.push(f);
    eExt.push(0);
    zHat.push(f);
  }

  // Undo the differencing
  let fc = zHat;
  for (let lev = d - 1; lev >= 0; lev--) {
    let prev = levels[lev][levels[lev].length - 1];
    fc = fc.map((v) => (prev = prev + v));
  }
  return fc;
}
