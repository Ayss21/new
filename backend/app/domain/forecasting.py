"""Forecasting: Moving Average, Linear Regression and ARIMA(p, d, q), accuracy on held-out days, model
comparison and recommendation. A line-by-line port of runForecast / compareModelsForProducts in
src/lib/domain.js and of src/lib/arima.js, so the API gives the same numbers as the demo backend.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta

from .constants import FORECAST_MODELS
from .inventory import js_round

MIN_HISTORY = 21
MIN_TEST_DAYS = 7
COMPARISON_SETTINGS = {"horizon": 30, "windowSize": 7, "order": [2, 1, 2]}


class ForecastError(ValueError):
    """The model can't run on this history (422 forecast_failed)."""


# ------------------------------------------------------------------------------------------------
# History
# ------------------------------------------------------------------------------------------------


def dates_between(first: str, last: str) -> list[str]:
    start, end = date.fromisoformat(first), date.fromisoformat(last)
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def demand_series(records: list[dict], sku: str, start: str | None, end: str | None) -> list[dict]:
    """Daily units for one SKU, every day of the range present (0 on days without sales)."""
    grouped: dict[str, int] = defaultdict(int)
    first, last = start, end
    for row in records:
        if not start and (not first or row["date"] < first):
            first = row["date"]
        if not end and (not last or row["date"] > last):
            last = row["date"]
        if row["sku"] == sku:
            grouped[row["date"]] += row["units"]
    if not first or not last or first > last:
        return []
    return [{"date": d, "units": grouped.get(d, 0)} for d in dates_between(first, last)]


# ------------------------------------------------------------------------------------------------
# ARIMA (Hannan–Rissanen), as in src/lib/arima.js
# ------------------------------------------------------------------------------------------------


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _least_squares(X: list[list[float]], y: list[float]) -> list[float]:
    k = len(X[0])
    A = [[0.0] * (k + 1) for _ in range(k)]
    for r, row in enumerate(X):
        for i in range(k):
            xi = row[i]
            Ai = A[i]
            for j in range(k):
                Ai[j] += xi * row[j]
            Ai[k] += xi * y[r]
    for i in range(k):
        A[i][i] += 1e-8
    for col in range(k):
        pivot = col
        for r in range(col + 1, k):
            if abs(A[r][col]) > abs(A[pivot][col]):
                pivot = r
        A[col], A[pivot] = A[pivot], A[col]
        div = A[col][col] or 1e-12
        for c in range(col, k + 1):
            A[col][c] /= div
        for r in range(k):
            if r == col:
                continue
            f = A[r][col]
            if f:
                for c in range(col, k + 1):
                    A[r][c] -= f * A[col][c]
    return [row[k] for row in A]


def _shrink(coefs: list[float]) -> list[float]:
    total = sum(abs(c) for c in coefs)
    return [c * 0.98 / total for c in coefs] if total >= 0.98 else coefs


def arima_minimum_history(p: int, d: int, q: int) -> int:
    return 3 * (p + q + d) + 10


def validate_arima_order(order) -> str | None:
    if not isinstance(order, (list, tuple)) or len(order) != 3 or any(not isinstance(v, int) or isinstance(v, bool) for v in order):
        return "ARIMA order values must be whole numbers."
    p, d, q = order
    if p < 0 or p > 5:
        return "p must be between 0 and 5."
    if d < 0 or d > 2:
        return "d must be between 0 and 2."
    if q < 0 or q > 5:
        return "q must be between 0 and 5."
    return None


def arima_forecast(y: list[float], horizon: int, p: int, d: int, q: int) -> list[float]:
    minimum = arima_minimum_history(p, d, q)
    if len(y) < minimum:
        raise ForecastError(f"ARIMA({p},{d},{q}) needs at least {minimum} historical periods; {len(y)} available.")
    levels = [list(map(float, y))]
    for _ in range(d):
        prev = levels[-1]
        levels.append([prev[j + 1] - prev[j] for j in range(len(prev) - 1)])
    z = levels[d]
    n = len(z)
    use_constant = d <= 1

    m = min(max(p + q, n // 5), 12) if q > 0 else 0
    e_hat = [0.0] * n
    if q > 0:
        X, Y = [], []
        for t in range(m, n):
            X.append([1.0] + [z[t - 1 - i] for i in range(m)])
            Y.append(z[t])
        b = _least_squares(X, Y)
        e_hat = []
        for t, v in enumerate(z):
            if t < m:
                e_hat.append(0.0)
                continue
            fit = b[0]
            for i in range(m):
                fit += b[i + 1] * z[t - 1 - i]
            e_hat.append(v - fit)

    c = _mean(z) if use_constant else 0.0
    phi: list[float] = []
    theta: list[float] = []
    if p + q > 0:
        start = max(p, m + q)
        X, Y = [], []
        for t in range(start, n):
            row = [1.0] if use_constant else []
            row += [z[t - i] for i in range(1, p + 1)]
            row += [e_hat[t - j] for j in range(1, q + 1)]
            X.append(row)
            Y.append(z[t])
        b = _least_squares(X, Y)
        off = 1 if use_constant else 0
        c = b[0] if use_constant else 0.0
        phi = _shrink(b[off : off + p])
        theta = _shrink(b[off + p : off + p + q])

    z_mean = _mean(z)
    eps = [0.0] * n
    for t in range(n):
        fit = c
        for i in range(1, p + 1):
            fit += phi[i - 1] * (z[t - i] if t - i >= 0 else z_mean)
        for j in range(1, q + 1):
            fit += theta[j - 1] * (eps[t - j] if t - j >= 0 else 0.0)
        eps[t] = z[t] - fit

    z_ext = list(z)
    e_ext = list(eps)
    z_hat = []
    for k in range(horizon):
        t = n + k
        f = c
        for i in range(1, p + 1):
            f += phi[i - 1] * z_ext[t - i]
        for j in range(1, q + 1):
            f += theta[j - 1] * e_ext[t - j]
        z_ext.append(f)
        e_ext.append(0.0)
        z_hat.append(f)

    fc = z_hat
    for lev in range(d - 1, -1, -1):
        prev = levels[lev][-1]
        out = []
        for v in fc:
            prev = prev + v
            out.append(prev)
        fc = out
    return fc


# ------------------------------------------------------------------------------------------------
# Runs
# ------------------------------------------------------------------------------------------------


def evaluate(actual: list[float], predicted: list[float]) -> dict:
    if not actual or len(actual) != len(predicted):
        return {"mae": None, "rmse": None, "mape": None}
    errors = [a - p for a, p in zip(actual, predicted)]
    mape = None
    if not any(a == 0 for a in actual):
        mape = sum(abs((a - p) / a) for a, p in zip(actual, predicted)) / len(actual) * 100
    return {
        "mae": sum(abs(e) for e in errors) / len(errors),
        "rmse": math.sqrt(sum(e * e for e in errors) / len(errors)),
        "mape": mape,
    }


def linear_fit(values: list[float]) -> tuple[float, float]:
    n = len(values)
    sum_x = (n - 1) * n / 2
    sum_y = sum(values)
    sum_xy = sum(i * v for i, v in enumerate(values))
    sum_xx = sum(i * i for i in range(n))
    denominator = n * sum_xx - sum_x * sum_x or 1
    slope = (n * sum_xy - sum_x * sum_y) / denominator
    return slope, (sum_y - slope * sum_x) / n


def _moving_average(history: list[float], steps: int, window: int) -> list[float]:
    evolving = list(history)
    out = []
    for _ in range(steps):
        prediction = sum(evolving[-window:]) / window
        evolving.append(prediction)
        out.append(prediction)
    return out


def run_forecast(records: list[dict], sku: str, model: str, horizon: int, start: str | None = None, end: str | None = None, window_size: int = 7, order=(2, 1, 2)) -> dict:
    """→ { model, sku, horizon, points: [{period, date, forecast}], mae, rmse, mape, holdoutDays, configuration }"""
    series = demand_series(records, sku, start, end)
    if len(series) < MIN_HISTORY:
        raise ForecastError("At least 21 historical periods are required to run this forecast.")
    values = [float(point["units"]) for point in series]
    evaluation_size = min(14, len(values) // 4)
    train = values[:-evaluation_size]
    evaluation_actual = values[-evaluation_size:]
    configuration: dict = {"horizon": horizon}

    if model == "Moving Average":
        window = max(2, min(window_size or 7, len(train)))
        configuration["windowSize"] = window
        evaluation_predicted = _moving_average(train, len(evaluation_actual), window)
        future = _moving_average(values, horizon, window)
    elif model == "Linear Regression":
        slope_e, intercept_e = linear_fit(train)
        evaluation_predicted = [intercept_e + slope_e * (len(train) + i) for i in range(len(evaluation_actual))]
        slope, intercept = linear_fit(values)
        configuration["slope"] = round(slope, 4)
        future = [intercept + slope * (len(values) + i) for i in range(horizon)]
    elif model == "ARIMA":
        problem = validate_arima_order(list(order))
        if problem:
            raise ForecastError(problem)
        p, d, q = order
        configuration["order"] = [p, d, q]
        evaluation_predicted = arima_forecast(train, evaluation_size, p, d, q)
        future = arima_forecast(values, horizon, p, d, q)
    else:
        raise ForecastError(f"Use one of: {', '.join(FORECAST_MODELS)}.")

    metrics = evaluate(evaluation_actual, [max(0.0, v) for v in evaluation_predicted])
    last = date.fromisoformat(series[-1]["date"])
    points = [
        {"period": i + 1, "date": (last + timedelta(days=i + 1)).isoformat(), "forecast": max(0, js_round(value))}
        for i, value in enumerate(future)
    ]
    return {
        "model": model,
        "sku": sku,
        "horizon": horizon,
        "points": points,
        "mae": metrics["mae"],
        "rmse": metrics["rmse"],
        "mape": metrics["mape"],
        "holdoutDays": evaluation_size,
        "configuration": configuration,
    }


def compare_models_for_products(sales: list[dict], skus: list[str], start: str, end: str, settings: dict = COMPARISON_SETTINGS) -> dict:
    """The three models on the same products and held-out days; the recommended one and why (or why not)."""
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1 if start and end else 0
    test_days = min(14, days // 4)
    groups: dict[str, list[dict]] = {sku: [] for sku in skus}
    for row in sales:
        if row["sku"] in groups:
            groups[row["sku"]].append(row)

    models = []
    for model in FORECAST_MODELS:
        products = []
        for sku in skus:
            try:
                run = run_forecast(groups.get(sku, []), sku, model, settings["horizon"], start, end, settings["windowSize"], settings["order"])
                products.append({"sku": sku, "mae": run["mae"], "rmse": run["rmse"], "mape": run["mape"]})
            except ForecastError as error:
                products.append({"sku": sku, "error": str(error)})
        tested = [p for p in products if "error" not in p]

        def average(key: str):
            if tested and all(p[key] is not None for p in tested):
                return sum(p[key] for p in tested) / len(tested)
            return None

        models.append(
            {
                "model": model,
                "products": products,
                "tested": len(tested),
                "eligible": bool(skus) and len(tested) == len(skus),
                "error": next((p["error"] for p in products if "error" in p), None),
                "mae": average("mae"),
                "rmse": average("rmse"),
                "mape": average("mape"),
                "wins": 0,
            }
        )

    eligible = [m for m in models if m["eligible"]]
    metric = "mape" if eligible and all(m["mape"] is not None for m in eligible) else "mae"
    for index in range(len(skus)):
        candidates = [(m, m["products"][index].get(metric)) for m in eligible]
        candidates = [c for c in candidates if c[1] is not None]
        if candidates:
            best = min(candidates, key=lambda c: c[1])  # first of equal values, as a stable sort would
            best[0]["wins"] += 1
    ranked = sorted(eligible, key=lambda m: (m[metric], m["rmse"] or 0))

    reason = None
    if not skus:
        reason = "There are no products of this demand type in the current filters."
    elif test_days < MIN_TEST_DAYS:
        reason = (
            f"The selected date range has {days} days, so only {test_days} days could be held back to test the models; "
            f"at least {MIN_TEST_DAYS} are needed. Choose a longer date range."
        )
    elif len(eligible) < 2:
        failed = [m for m in models if not m["eligible"]]
        if len(eligible) == 1:
            details = " ".join(f"{m['model']}: {m['error']}" for m in failed)
            reason = f"Only {eligible[0]['model']} could be tested on these products, so there is nothing to compare it with ({details})"
        else:
            reason = f"None of the models could be tested on these products ({models[0]['error']})"

    recommended = None if reason else ranked[0]
    runner_up = None if reason else ranked[1]
    margin = None
    if recommended and runner_up and runner_up[metric] > 0:
        margin = (runner_up[metric] - recommended[metric]) / runner_up[metric]
    return {
        "models": models,
        "ranked": [m["model"] for m in ranked],
        "metric": metric,
        "recommended": recommended["model"] if recommended else None,
        "reason": reason,
        "days": days,
        "testDays": test_days,
        "margin": margin,
        "close": margin is not None and margin < 0.03,
    }
