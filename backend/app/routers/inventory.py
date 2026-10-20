"""/inventory and /reorders — stock levels, stock updates, alerts, month-end snapshots and reorders
(Ordered → Delivered: delivery adds the quantity to stock)."""
from __future__ import annotations

import re
from sqlalchemy import select
from fastapi import HTTPException

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..core.deps import Principal, current_principal, require_action
from ..core.errors import fail, invalid, not_found
from ..core.ids import next_id
from ..core.timeutil import utcnow
from ..database import get_db
from ..schemas import AlertOut, InventoryOut, ReorderCreate, ReorderOut, ReorderUpdate, SnapshotOut, StockUpdate

router = APIRouter(tags=["Inventory"])
MONTH = re.compile(r"^\d{4}-\d{2}$")


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


@router.get("/inventory", response_model=list[InventoryOut], summary="Every product with its stock position")
def list_inventory(_principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return repo.load_inventory(db)


@router.get("/inventory/alerts", response_model=list[AlertOut], summary="Products below their reorder level, most urgent first")
def alerts(_principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rank = {"Critical": 0, "Warning": 1}
    items = sorted((i for i in repo.load_inventory(db) if i["status"] != "Safe"), key=lambda i: (rank[i["status"]], i["days"]))

    def message(i):
        if i["status"] == "Critical":
            return f"{i['sku']} has {i['days']} day{'' if i['days'] == 1 else 's'} of stock remaining"
        return f"{i['sku']} is below its reorder level ({i['stock']:,} of {i['reorder']:,} units)"

    return [{k: i[k] for k in ("sku", "name", "status", "stock", "reorder", "safety", "days", "suggested")} | {"message": message(i)} for i in items]


@router.get("/inventory/snapshots", response_model=list[SnapshotOut], summary="Month-end stock per product")
def snapshots(start: str | None = Query(None, description="YYYY-MM"), end: str | None = Query(None, description="YYYY-MM"), _principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    invalid({"start": start and not MONTH.match(start) and "Use a month like 2025-01.", "end": end and not MONTH.match(end) and "Use a month like 2025-06."})
    return repo.load_snapshots(db, start, end)


@router.patch("/inventory/{sku}", response_model=InventoryOut, summary="Set the stock after a count or adjustment")
def update_stock(sku: str, body: StockUpdate, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    require_action(principal, "Update inventory")
    item = db.execute(
        select(m.Inventory)
        .where(m.Inventory.sku == sku)
        .order_by(m.Inventory.snapshot_date.desc())
        .limit(1)
    ).scalar_one_or_none()
    if item is None:
        not_found(f"Product {sku} doesn't exist.")
    invalid({"stock": not (_is_int(body.stock) and body.stock >= 0) and "Enter a whole number, 0 or more.", "reason": not _text(body.reason) and "Choose an adjustment reason."})
    item.stock = body.stock
    item.updated_at = utcnow()
    db.flush()
    product = db.get(m.Product, sku)

    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    repo.sync_snapshot(
        db,
        sku,
        item.stock,
        product.reorder_level,
        product.safety_stock,
    )
    notes = _text(body.notes)
    repo.log_event(db, "Stock quantity updated", "Inventory", "Completed", f"{sku} set to {body.stock:,} units ({_text(body.reason)}){f' · {notes}' if notes else ''}", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    return repo.inventory_item(db, sku)


@router.get("/reorders", response_model=list[ReorderOut], summary="Every reorder, newest first")
def list_reorders(_principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return repo.load_reorders(db)


@router.post("/reorders", status_code=201, response_model=ReorderOut, summary="Place a reorder (status Ordered)")
def create_reorder(body: ReorderCreate, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    require_action(principal, "Update inventory")
    known = isinstance(body.sku, str) and db.get(m.Product, body.sku) is not None
    invalid(
        {
            "sku": not known and "Choose an existing product SKU.",
            "quantity": not (_is_int(body.quantity) and body.quantity > 0) and "Enter a whole number greater than 0.",
            "supplier": not _text(body.supplier) and "Choose a supplier.",
        }
    )
    order = m.Reorder(reorder_id=next_id(db, "RO"), sku=body.sku, quantity=body.quantity, supplier=_text(body.supplier)[:120], status="Ordered", ordered_at=utcnow(), delivered_at=None, ordered_by=principal.user.user_id)
    db.add(order)
    db.flush()
    repo.log_event(db, "Reorder placed", "Inventory", "Completed", f"{order.reorder_id} · {order.sku}, {order.quantity:,} units", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    db.refresh(order)
    return repo.reorder_json(order)


@router.patch("/reorders/{reorder_id}", response_model=ReorderOut, summary='Mark delivered ({"status": "Delivered"}): adds the quantity to stock')
def update_reorder(reorder_id: str, body: ReorderUpdate, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    require_action(principal, "Update inventory")
    order = db.get(m.Reorder, reorder_id)
    if order is None:
        not_found("That reorder no longer exists.")
    invalid({"status": body.status != "Delivered" and 'Use "Delivered".'})
    if order.status != "Ordered":
        fail(409, "invalid_transition", f"{order.reorder_id} has already been delivered.")
    order.status = "Delivered"
    order.delivered_at = utcnow()
    detail = f"{order.reorder_id} · {order.sku}, {order.quantity:,} units"
    item = db.get(m.Inventory, order.sku)
    if item is not None:
        item.stock += order.quantity
        item.updated_at = utcnow()
        db.flush()
        repo.sync_snapshot(db, order.sku, item.stock, item.reorder_level, item.safety_stock)
        detail += f" · stock now {item.stock:,}"
    repo.log_event(db, "Reorder delivered", "Inventory", "Completed", detail, user=principal.user, session_id=principal.session.session_id)
    db.commit()
    db.refresh(order)
    return repo.reorder_json(order)
