"""Sales and dataset routes implemented against DemandIQ ERD v3 only."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..config import get_settings
from ..core.deps import Principal, current_principal, require_action
from ..core.errors import fail, invalid, not_found
from ..core.ids import next_id, next_ids
from ..core.timeutil import iso, utcnow
from ..database import get_db
from ..domain.cleaning import cap_outliers
from ..domain.filters import parse_filters
from ..domain.inventory import new_product_levels
from ..domain.sales_import import (
    UNREADABLE,
    WorkbookError,
    kind_of,
    read_upload,
    validation_label,
)
from ..schemas import CleanOut, CleanRequest, DatasetOut, SaleOut, UploadOut

router = APIRouter(tags=["Sales data"])

COUNT_KEYS = (
    "total",
    "valid",
    "combined",
    "missing",
    "duplicates",
    "invalidDates",
    "invalidNumeric",
)


def _empty_validation(message: str) -> dict:
    return {
        **{key: 0 for key in COUNT_KEYS},
        "errors": [message] if message else [],
        "records": [],
        "newProducts": [],
        "columns": {},
    }


def validation_summary(v: dict) -> dict:
    return {
        **{key: v.get(key, 0) for key in COUNT_KEYS},
        "errors": v.get("errors", []),
        "columns": v.get("columns", {}),
    }


def _normalise_region(value) -> str:
    return str(value or "Unknown").strip()[:50] or "Unknown"


def _record_key(record: dict) -> tuple[date, str, str]:
    raw_date = record["date"]
    sale_date = (
        raw_date
        if isinstance(raw_date, date)
        else date.fromisoformat(str(raw_date))
    )
    return (
        sale_date,
        str(record["sku"]).strip()[:20],
        _normalise_region(record.get("region")),
    )


def _existing_keys(
    db: Session, records: list[dict]
) -> set[tuple[date, str, str]]:
    """Find occupied date/SKU/region keys in sales_records."""
    if not records:
        return set()

    skus = sorted({str(r["sku"]).strip() for r in records})
    first = min(_record_key(r)[0] for r in records)
    last = max(_record_key(r)[0] for r in records)

    rows = db.execute(
        select(
            m.SalesRecord.sale_date,
            m.SalesRecord.sku,
            m.SalesRecord.region,
        ).where(
            m.SalesRecord.sku.in_(skus),
            m.SalesRecord.sale_date >= first,
            m.SalesRecord.sale_date <= last,
        )
    ).all()

    return {
        (row.sale_date, row.sku, row.region)
        for row in rows
    }


def _add_new_products(
    db: Session,
    new_products: list[dict],
    records: list[dict],
    file_name: str,
) -> list[str]:
    """Create products and families using ERD v3 columns only."""
    if not new_products:
        return []

    records_by_sku: dict[str, list[dict]] = {
        str(p["sku"]).strip()[:20]: []
        for p in new_products
        if p.get("sku")
    }

    for record in records:
        sku = str(record["sku"]).strip()[:20]
        if sku in records_by_sku:
            records_by_sku[sku].append(record)

    created = []

    for fresh in new_products:
        sku = str(fresh.get("sku") or "").strip()[:20]

        if not sku or db.get(m.Product, sku) is not None:
            continue

        product_records = records_by_sku.get(sku, [])
        family_name = str(
            fresh.get("category") or "Uncategorized"
        ).strip()[:100] or "Uncategorized"

        family = db.execute(
            select(m.ProductFamily).where(
                m.ProductFamily.family_name.ilike(family_name)
            )
        ).scalar_one_or_none()

        if family is None:
            family = m.ProductFamily(
                family_id=next_id(db, "PF"),
                family_name=family_name,
                description=f"Created from uploaded file: {file_name}"[:255],
                status="Active",
            )
            db.add(family)
            db.flush()

        levels = new_product_levels(product_records)

        unit_price = fresh.get("unitPrice")
        if unit_price is None and product_records:
            unit_price = product_records[0].get("unitPrice", 0)

        product = m.Product(
            sku=sku,
            product_name=str(fresh.get("name") or sku).strip()[:150] or sku,
            family_id=family.family_id,
            unit_price=max(0, float(unit_price or 0)),
            unit_cost=None,
            reorder_level=levels["reorder"],
            safety_stock=levels["safety"],
        )
        db.add(product)
        db.flush()

        stock = max(0, int(fresh.get("stock") or 0))
        repo.sync_snapshot(
            db,
            sku,
            stock,
            levels["reorder"],
            levels["safety"],
        )
        created.append(sku)

    return created


@router.get(
    "/sales",
    response_model=list[SaleOut],
    summary="Sales records matching the global filters",
)
def list_sales(
    request: Request,
    start: str | None = Query(None),
    end: str | None = Query(None),
    category: list[str] | None = Query(None),
    sku: list[str] | None = Query(None),
    region: list[str] | None = Query(None),
    _principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    query = {
        "start": start,
        "end": end,
        "category": category,
        "sku": sku,
        "region": region,
    }

    if not any(request.query_params.values()):
        return repo.load_sales(db)

    return repo.load_sales(
        db,
        parse_filters(query, repo.sales_bounds(db)),
    )


@router.get(
    "/datasets",
    response_model=list[DatasetOut],
    summary="Upload history, newest first",
)
def list_datasets(
    _principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return repo.load_datasets(db)


@router.post(
    "/datasets",
    status_code=201,
    response_model=UploadOut,
    summary="Upload a sales file",
)
async def upload(
    file: UploadFile = File(...),
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    require_action(principal, "Upload sales")

    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)

    if len(data) > max_bytes:
        fail(
            413,
            "file_too_large",
            f"The file exceeds the {settings.max_upload_mb} MB limit.",
        )

    kind = kind_of(data)
    if kind in UNREADABLE:
        fail(415, "unsupported_file", UNREADABLE[kind])

    file_name = (file.filename or "upload.csv")[:260]

    try:
        validation = read_upload(data, repo.catalog(db))
    except WorkbookError as error:
        validation = _empty_validation(str(error))
    except Exception:  # noqa: BLE001
        validation = _empty_validation("The file could not be read.")

    user = principal.user
    dataset = m.Dataset(
        dataset_id=next_id(db, "DS"),
        file_name=file_name,
        uploaded_at=utcnow(),
        uploaded_by=user.user_id,
        cleaning_status="Not started",
        cleaned_at=None,
        cleaned_by=None,
    )

    db.add(dataset)
    db.flush()

    if validation.get("errors") or not validation.get("valid"):
        reason = " ".join(validation.get("errors", []))
        reason = reason or "No valid records were found in the file."

        repo.log_event(
            db,
            "Dataset upload failed",
            "sales",
            "Failed",
            f"{file_name} · {reason}",
            user=user,
            session_id=principal.session.session_id,
        )
        repo.log_error(
            db, "sales", "Invalid file", "Error", reason
        )
        db.commit()

        fail(
            422,
            "invalid_file",
            reason,
            validation=validation_summary(validation),
            dataset=repo.dataset_api(db, dataset.dataset_id),
        )

    records = validation.get("records", [])
    if not records:
        reason = "No usable sales records were found in the file."

        repo.log_event(
            db,
            "Dataset upload failed",
            "sales",
            "Failed",
            f"{file_name} · {reason}",
            user=user,
            session_id=principal.session.session_id,
        )
        repo.log_error(
            db, "sales", "Invalid file", "Error", reason
        )
        db.commit()

        fail(
            422,
            "invalid_file",
            reason,
            validation=validation_summary(validation),
            dataset=repo.dataset_api(db, dataset.dataset_id),
        )

    # ERD v3 requires unique (sale_date, sku, region).
    # Reject duplicates and overlaps before staging any sales.
    keys = [_record_key(record) for record in records]
    duplicate_in_file = len(keys) != len(set(keys))
    existing = _existing_keys(db, records)
    overlaps = existing.intersection(keys)

    if duplicate_in_file or overlaps:
        if duplicate_in_file:
            reason = (
                "The upload contains repeated date, SKU and region "
                "combinations. Remove duplicates and upload again."
            )
        else:
            examples = ", ".join(
                f"{d.isoformat()} / {sku} / {region}"
                for d, sku, region in sorted(overlaps)[:5]
            )
            reason = (
                f"This upload overlaps existing sales for {len(overlaps)} "
                f"date/SKU/region key(s). Existing records were preserved. "
                f"Examples: {examples}"
            )

        repo.log_event(
            db,
            "Dataset upload rejected",
            "sales",
            "Failed",
            f"{file_name} · {reason}",
            user=user,
            session_id=principal.session.session_id,
        )
        repo.log_error(
            db, "sales", "Sales overlap", "Warning", reason
        )
        db.commit()

        fail(
            409,
            "sales_overlap",
            reason,
            validation=validation_summary(validation),
            dataset=repo.dataset_api(db, dataset.dataset_id),
        )

    # Products must exist before sales_records due to the SKU foreign key.
    added = _add_new_products(
        db,
        validation.get("newProducts", []),
        records,
        file_name,
    )

    dataset.cleaning_status = "Pending"
    ids = next_ids(db, "UPL", len(records))

    for sale_id, record in zip(ids, records):
        sale_date, sku, region = _record_key(record)

        db.add(
            m.SalesRecord(
                sale_id=sale_id,
                sale_date=sale_date,
                sku=sku,
                region=region,
                units=max(1, int(record["units"])),
                unit_price=max(
                    0, float(record.get("unitPrice") or 0)
                ),
                discount_rate=min(
                    1,
                    max(0, float(record.get("discountRate") or 0)),
                ),
                record_status="Pending",
                dataset_id=dataset.dataset_id,
            )
        )

    repo.log_event(
        db,
        "Dataset uploaded",
        "sales",
        "Completed",
        f"{file_name} · {len(records):,} valid records staged",
        user=user,
        session_id=principal.session.session_id,
    )

    if added:
        more = f" and {len(added) - 10} more" if len(added) > 10 else ""
        repo.log_event(
            db,
            "Products added",
            "sales",
            "Completed",
            f"{file_name} · {', '.join(added[:10])}{more}",
            user=user,
            session_id=principal.session.session_id,
        )

    db.commit()

    assert validation_label(validation) != "Failed"

    return {
        "dataset": repo.dataset_api(db, dataset.dataset_id),
        "validation": validation_summary(validation),
    }


@router.post(
    "/datasets/{dataset_id}/clean",
    response_model=CleanOut,
    summary="Clean a pending upload",
)
def clean(
    dataset_id: str,
    body: CleanRequest | None = None,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    require_action(principal, "Clean data")

    dataset = db.get(m.Dataset, dataset_id)
    if dataset is None:
        not_found("That dataset no longer exists.")

    pending = repo.pending_records(db, dataset_id)
    if dataset.cleaning_status != "Pending" or not pending:
        fail(
            409,
            "not_pending",
            f"{dataset.file_name} is not waiting for cleaning.",
        )

    body = body or CleanRequest()
    cap = body.capOutliers if body.capOutliers is not None else True
    overlap = body.overlap if body.overlap is not None else "replace"

    invalid({
        "capOutliers": (
            not isinstance(cap, bool) and "Use true or false."
        ),
        "overlap": (
            overlap not in ("replace", "skip")
            and 'Use "replace" or "skip".'
        ),
    })

    rows = [
        {
            "record_id": row.sale_id,
            "date": row.sale_date,
            "sku": row.sku,
            "region": row.region,
            "units": row.units,
            "unit_price": float(row.unit_price),
            "discount_rate": float(row.discount_rate),
        }
        for row in pending
    ]

    skus = sorted({row["sku"] for row in rows})
    capped = 0

    if cap and skus:
        history: dict[str, list[int]] = {sku: [] for sku in skus}

        history_rows = db.execute(
            select(m.SalesRecord.sku, m.SalesRecord.units).where(
                m.SalesRecord.sku.in_(skus),
                m.SalesRecord.record_status == "Cleaned",
            )
        ).all()

        for sku, units in history_rows:
            history[sku].append(units)

        capped = cap_outliers(rows, history)

        rows_by_id = {
            row["record_id"]: row
            for row in rows
        }
        for pending_row in pending:
            changed = rows_by_id.get(pending_row.sale_id)
            if changed is not None:
                pending_row.units = max(1, int(changed["units"]))

    # Check for rows inserted after upload.
    pending_ids = {row.sale_id for row in pending}
    keys = {
        (row.sale_date, row.sku, row.region): row
        for row in pending
    }

    if keys:
        key_skus = sorted({key[1] for key in keys})
        first = min(key[0] for key in keys)
        last = max(key[0] for key in keys)

        existing_rows = db.execute(
            select(m.SalesRecord).where(
                m.SalesRecord.sku.in_(key_skus),
                m.SalesRecord.sale_date >= first,
                m.SalesRecord.sale_date <= last,
            )
        ).scalars().all()
    else:
        existing_rows = []

    existing_by_key = {}
    for row in existing_rows:
        key = (row.sale_date, row.sku, row.region)
        if row.sale_id not in pending_ids:
            existing_by_key[key] = row

    replaced = skipped = added = 0

    for key, pending_row in keys.items():
        existing_row = existing_by_key.get(key)

        if existing_row is not None:
            if overlap == "replace":
                # Delete the existing row before promoting the pending row.
                db.delete(existing_row)
                pending_row.record_status = "Cleaned"
                replaced += 1
            else:
                db.delete(pending_row)
                skipped += 1
        else:
            pending_row.record_status = "Cleaned"
            added += 1

    now = utcnow()
    dataset.cleaning_status = "Completed"
    dataset.cleaned_at = now
    dataset.cleaned_by = principal.user.user_id

    db.flush()

    merged = added + replaced
    repo.log_event(
        db,
        "Data cleaned",
        "sales",
        "Completed",
        f"{dataset.file_name} · {merged:,} records merged; "
        f"{skipped:,} skipped; {capped:,} outliers capped",
        user=principal.user,
        session_id=principal.session.session_id,
    )

    db.commit()

    api = repo.dataset_api(db, dataset_id)
    summary = {
        "inputRecords": len(rows),
        "excludedAtValidation": 0,
        "outliersCapped": capped,
        "replaced": replaced,
        "skipped": skipped,
        "added": added,
        "cleanedBy": principal.user.full_name,
        "cleanedAt": iso(now),
    }
    api["cleaningSummary"] = summary

    start, end = repo.sales_bounds(db)

    return {
        "dataset": api,
        "summary": summary,
        "salesRange": {"start": start, "end": end},
    }