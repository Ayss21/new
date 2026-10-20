
"""Forecasts — run, list and compare forecasts; dataset lineage and model recommendations."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..core.deps import (
    Principal,
    current_principal,
    require_action,
    require_view,
)
from ..core.errors import fail, invalid, not_found
from ..core.ids import next_id
from ..core.timeutil import days_between, utcnow
from ..database import get_db
from ..domain.constants import FORECAST_MODELS
from ..domain.filters import parse_filters, valid_date
from ..domain.forecasting import (
    ForecastError,
    compare_models_for_products,
    run_forecast,
)
from ..domain.inventory import demand_from_forecast
from ..schemas import (
    CompareOut,
    ForecastOut,
    ForecastRequest,
    LineageOut,
    RecommendationOut,
    RecommendationRequest,
)

router = APIRouter(prefix="/forecasts", tags=["Forecasting"])


def _is_int(value) -> bool:
    """Reject booleans, which Python otherwise treats as integers."""
    return isinstance(value, int) and not isinstance(value, bool)


def read_request(
    db: Session,
    body: ForecastRequest,
    needs_model: bool = True,
) -> dict:
    """Validate the public request and supply internal model defaults."""
    window = 7
    order = [2, 1, 2]

    known = (
        isinstance(body.sku, str)
        and db.get(m.Product, body.sku) is not None
    )

    invalid(
        {
            "sku": (
                not known
                and "Choose an existing product SKU."
            ),
            "model": (
                needs_model
                and body.model not in FORECAST_MODELS
                and f"Use one of: {', '.join(FORECAST_MODELS)}."
            ),
            "horizon": (
                not (
                    _is_int(body.horizon)
                    and 1 <= body.horizon <= 365
                )
                and "Use a whole number of days from 1 to 365."
            ),
            "startDate": (
                not valid_date(body.startDate)
                and "Use a date like 2025-03-19."
            ),
            "endDate": (
                not valid_date(body.endDate)
                and "Use a date like 2025-06-18."
            ),
        }
    )

    # invalid() raises when validation fails, so both dates are valid here.
    if body.startDate > body.endDate:
        invalid(
            {
                "startDate": (
                    "The start date must be on or before the end date."
                )
            }
        )

    return {
        "sku": body.sku,
        "model": body.model,
        "horizon": body.horizon,
        "start": body.startDate,
        "end": body.endDate,
        "window": window,
        "order": order,
    }


@router.get(
    "",
    response_model=list[ForecastOut],
    summary="Saved runs, newest first",
)
def list_forecasts(
    _principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return repo.load_forecasts(db)


@router.get(
    "/lineage",
    response_model=LineageOut,
    summary="Which uploads a forecast with these settings would use",
)
def lineage(
    sku: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    _principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    invalid(
        {
            "sku": (
                not (sku and db.get(m.Product, sku))
                and "Choose an existing product SKU."
            ),
            "start": (
                not valid_date(start)
                and "Use a date like 2025-03-19."
            ),
            "end": (
                not valid_date(end)
                and "Use a date like 2025-06-18."
            ),
        }
    )

    if start > end:
        invalid(
            {
                "start": (
                    "The start date must be on or before the end date."
                )
            }
        )

    return {
        "sku": sku,
        "startDate": start,
        "endDate": end,
        "days": days_between(start, end),
        **repo.forecast_lineage(db, sku, start, end),
    }


@router.get(
    "/{forecast_id}",
    response_model=ForecastOut,
    summary="One saved run",
)
def get_forecast(
    forecast_id: str,
    _principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    found = repo.load_forecasts(db, forecast_id)

    if not found:
        not_found("That forecast run no longer exists.")

    return found[0]


@router.post(
    "",
    status_code=201,
    response_model=ForecastOut,
    summary="Run a model for one product and save the run",
)
def run(
    body: ForecastRequest,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    require_action(principal, "Run forecasts")

    options = read_request(db, body)
    history = repo.sales_for_sku(
        db,
        options["sku"],
        options["start"],
        options["end"],
    )

    user = principal.user
    session_id = principal.session.session_id

    # Run the actual forecasting algorithm.
    try:
        result = run_forecast(
            history,
            options["sku"],
            options["model"],
            options["horizon"],
            options["start"],
            options["end"],
            options["window"],
            options["order"],
        )
    except ForecastError as error:
        message = str(error)

        repo.log_error(
            db,
            "Forecasting",
            "Execution failure",
            "Error",
            f'{options["sku"]} · {message}',
        )
        repo.log_event(
            db,
            f'{options["model"]} forecast failed',
            "Forecasting",
            "Failed",
            f'{options["sku"]} · {message}',
            user=user,
            session_id=session_id,
        )
        db.commit()

        fail(422, "forecast_failed", message)

    # Calculate which cleaned and pending sales datasets relate to this run.
    lineage_now = repo.forecast_lineage(
        db,
        options["sku"],
        options["start"],
        options["end"],
    )

    run_id = next_id(db, "FC")
    generated_at = utcnow()

    # The Forecast ORM table stores one row per future forecast date.
    # Do not insert ForecastPoint or ForecastSource: those ORM models
    # do not exist in the models.py provided for this project.
    forecast_rows = []

    for point in result["points"]:
        forecast_date = date.fromisoformat(point["date"])

        # Every predicted date must be later than the history end date.
        if forecast_date <= date.fromisoformat(options["end"]):
            fail(
                500,
                "invalid_forecast_dates",
                "The forecasting model returned a date within the history period.",
            )

        forecast_rows.append(
            m.Forecast(
                forecast_id=run_id,
                forecast_date=forecast_date,
                sku=options["sku"],
                model=options["model"],
                horizon_days=options["horizon"],
                history_start=date.fromisoformat(options["start"]),
                history_end=date.fromisoformat(options["end"]),
                predicted_units=max(0, int(point["forecast"])),
                mae=result["mae"],
                rmse=result["rmse"],
                mape=result["mape"],
                generated_at=generated_at,
                generated_by=user.user_id,
            )
        )

    if not forecast_rows:
        fail(
            422,
            "forecast_failed",
            "The forecasting model did not produce any forecast points.",
        )

    db.add_all(forecast_rows)
    db.flush()

    # Update the latest inventory snapshot for this SKU, if one exists.
    # Inventory has a composite key (sku, snapshot_date), not a single SKU key.
    demand = demand_from_forecast(
        [point["forecast"] for point in result["points"]]
    )

    inventory = db.execute(
        select(m.Inventory)
        .where(m.Inventory.sku == options["sku"])
        .order_by(m.Inventory.snapshot_date.desc())
        .limit(1)
    ).scalar_one_or_none()

    if inventory is not None and demand is not None:
        inventory.demand_30d = demand

    uploads = [
        source["datasetId"]
        for source in lineage_now["sources"]
        if source.get("datasetId")
    ]

    repo.log_event(
        db,
        f'{options["model"]} forecast executed',
        "Forecasting",
        "Completed",
        (
            f'{options["sku"]} · {options["horizon"]}-day horizon · '
            f'data from {", ".join(uploads) if uploads else "no uploads"}'
        ),
        user=user,
        session_id=session_id,
    )

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    # The repository groups the daily forecast rows into one API response.
    saved = repo.load_forecasts(db, run_id)

    if not saved:
        not_found("The forecast was saved, but could not be retrieved.")

    return saved[0]


@router.post(
    "/compare",
    response_model=CompareOut,
    summary="All three models on the same settings (nothing saved)",
)
def compare(
    body: ForecastRequest,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    require_action(principal, "Run forecasts")

    options = read_request(db, body, needs_model=False)

    history = repo.sales_for_sku(
        db,
        options["sku"],
        options["start"],
        options["end"],
    )

    results = []

    for model in FORECAST_MODELS:
        try:
            result = run_forecast(
                history,
                options["sku"],
                model,
                options["horizon"],
                options["start"],
                options["end"],
                options["window"],
                options["order"],
            )

            results.append(
                {
                    "model": model,
                    "status": "Completed",
                    "metrics": {
                        "mae": result["mae"],
                        "rmse": result["rmse"],
                        "mape": result["mape"],
                    },
                    "totalPredicted": sum(
                        point["forecast"] for point in result["points"]
                    ),
                    "error": None,
                }
            )
        except ForecastError as error:
            results.append(
                {
                    "model": model,
                    "status": "Failed",
                    "metrics": None,
                    "totalPredicted": None,
                    "error": str(error),
                }
            )

    return {
        "sku": options["sku"],
        "horizon": options["horizon"],
        "startDate": options["start"],
        "endDate": options["end"],
        "results": results,
    }


@router.post(
    "/recommendation",
    response_model=RecommendationOut,
    summary="Most accurate model for a group of products",
)
def recommendation(
    body: RecommendationRequest,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    require_view(principal, "Run forecasts")

    skus = body.skus

    invalid(
        {
            "skus": (
                not (
                    isinstance(skus, list)
                    and len(skus) <= 500
                    and all(isinstance(sku, str) for sku in skus)
                )
                and "Send skus as a list of up to 500 product SKUs."
            )
        }
    )

    filters = parse_filters(
        body.filters if isinstance(body.filters, dict) else {},
        repo.sales_bounds(db),
    )

    catalog = set(
        db.execute(select(m.Product.sku)).scalars()
    )
    known_skus = [sku for sku in skus if sku in catalog]

    sales = repo.load_sales(db, filters) if known_skus else []

    result = compare_models_for_products(
        sales,
        known_skus,
        filters.start,
        filters.end,
    )

    return {
        "skus": known_skus,
        "startDate": filters.start,
        "endDate": filters.end,
        **result,
    }
