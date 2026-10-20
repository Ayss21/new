"""/activity, /sessions and /errors — the audit log, sign-in sessions and the error log."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..core.deps import Principal, current_principal, needs
from ..core.errors import invalid, not_found
from ..database import get_db
from ..domain.constants import ERROR_STATUSES
from ..schemas import ActivityCreate, ActivityOut, ErrorOut, ErrorUpdate, SessionOut

router = APIRouter(tags=["Logs"])
view_logs = needs("View system logs")
CLIENT_EVENTS = {"Screen access denied": "Authentication"}  # events only the browser sees


@router.get(
    "/activity",
    response_model=list[ActivityOut],
    summary="The audit log, newest first",
)
def activity(
    _p: Principal = Depends(view_logs),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(m.ActivityLog, m.User.full_name)
        .outerjoin(
            m.User,
            m.ActivityLog.user_id == m.User.user_id,
        )
        .order_by(
            m.ActivityLog.timestamp.desc(),
            m.ActivityLog.activity_id.desc(),
        )
    ).all()

    return [
        repo.activity_json(row, user_name)
        for row, user_name in rows
    ]


@router.post("/activity", status_code=201, response_model=ActivityOut, summary="Record an event only the browser sees (Screen access denied)")
def record(body: ActivityCreate, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    invalid({"action": body.action not in CLIENT_EVENTS and f"Only these events can be sent: {', '.join(CLIENT_EVENTS)}."})
    details = body.details.strip()[:200] if isinstance(body.details, str) else ""
    row = repo.log_event(db, body.action, CLIENT_EVENTS[body.action], "Failed", details, user=principal.user, session_id=principal.session.session_id)
    db.commit()
    db.refresh(row)
    return repo.activity_json(row, principal.user.full_name)


@router.get("/sessions", response_model=list[SessionOut], summary="Sign-in sessions, newest first")
def sessions(_p: Principal = Depends(view_logs), db: Session = Depends(get_db)):
    rows = db.execute(select(m.SessionRow).order_by(m.SessionRow.login_at.desc(), m.SessionRow.session_id.desc())).scalars()
    return [repo.session_json(r) for r in rows]


@router.get("/errors", response_model=list[ErrorOut], summary="The error log, newest first")
def errors(_p: Principal = Depends(view_logs), db: Session = Depends(get_db)):
    rows = db.execute(
        select(m.ErrorLog).order_by(
            m.ErrorLog.timestamp.desc(),
            m.ErrorLog.error_id.desc(),
        )
    ).scalars()
    return [repo.error_json(r) for r in rows]


@router.patch("/errors/{error_id}", response_model=ErrorOut, summary="Mark an error Open, Investigating or Resolved, with notes")
def update_error(error_id: str, body: ErrorUpdate, principal: Principal = Depends(view_logs), db: Session = Depends(get_db)):
    row = db.get(m.ErrorLog, error_id)
    if row is None:
        not_found("That error no longer exists.")
    invalid({"status": body.status not in ERROR_STATUSES and f"Use one of: {', '.join(ERROR_STATUSES)}."})
    row.status = body.status
    notes = body.notes.strip() if isinstance(body.notes, str) else ""
    if notes:
        row.notes = notes[:1000]
    repo.log_event(db, "Error status updated", "Admin Panel", "Completed", f"{row.error_id} marked {body.status.lower()}", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    return repo.error_json(row)
