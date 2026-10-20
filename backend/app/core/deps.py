"""Authentication and authorization dependencies (docs/API_CONTRACT.md, sections 2 and 4).

Every signed-in request is checked: the bearer token's session must exist,
not be signed out or expired, and its account must still exist and be Active.

Permissions are read from the database on every request, so an Admin's
change applies at once.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timezone

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..database import get_db
from ..domain import constants as c
from .errors import fail
from .security import token_hash
from .timeutil import utcnow


@dataclass
class Principal:
    user: m.User
    session: m.SessionRow
    levels: dict[str, str]

    @property
    def role_id(self) -> int:
        return self.user.role_id

    def level(self, action: str) -> str:
        return self.levels.get(action, "No")


def _as_utc(value):
    """Treat naive database datetimes as UTC and normalize aware ones."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _end(
    db: Session,
    session: m.SessionRow,
    code: str,
    message: str,
):
    session.logout_at = utcnow()
    session.token_hash = None
    db.commit()
    fail(401, code, message)


def current_principal(
    request: Request,
    db: Session = Depends(get_db),
) -> Principal:
    from ..repository import effective_levels

    header = request.headers.get("Authorization", "")
    parts = header.split(None, 1)

    if (
        len(parts) != 2
        or parts[0].lower() != "bearer"
        or not parts[1].strip()
    ):
        fail(401, "not_authenticated", "Sign in to continue.")

    supplied_token = parts[1].strip()

    session = db.execute(
        select(m.SessionRow).where(
            m.SessionRow.token_hash == token_hash(supplied_token)
        )
    ).scalar_one_or_none()

    if session is None or session.logout_at is not None:
        fail(
            401,
            "session_ended",
            "Your session has ended. Please sign in again.",
        )

    # SQL Server may return a naive datetime even when the column is
    # datetimeoffset. Normalize both values to UTC before comparing.
    expires_at = _as_utc(session.expires_at)
    current_time = _as_utc(utcnow())

    if expires_at <= current_time:
        _end(
            db,
            session,
            "session_expired",
            "Your session expired. Please sign in again.",
        )

    user = db.get(m.User, session.user_id)

    if user is None:
        _end(
            db,
            session,
            "account_missing",
            "Your account is no longer available. Please sign in again.",
        )

    if user.status == "Pending activation":
        _end(
            db,
            session,
            "account_pending",
            "Your account is waiting for an administrator to activate it.",
        )

    if user.status != "Active":
        _end(
            db,
            session,
            "account_inactive",
            "Your account has been deactivated. Contact your administrator.",
        )

    # SessionRow has no role_id column in your current database/model.
    # Therefore, validate the user's current role without referencing
    # session.role_id.
    return Principal(
        user=user,
        session=session,
        levels=effective_levels(db, user.role_id),
    )


def require_action(principal: Principal, action: str) -> None:
    """403 unless the role's effective level for the action is Yes."""
    if principal.level(action) != "Yes":
        fail(
            403,
            "forbidden",
            (
                f"The {c.role_name(principal.role_id)} role isn't allowed "
                f"to {c.ACTION_TEXT.get(action, action.lower())}."
            ),
        )


def require_view(principal: Principal, action: str) -> None:
    """403 when the role has no access at all (View or Review is enough)."""
    if principal.level(action) == "No":
        fail(
            403,
            "forbidden",
            (
                f"The {c.role_name(principal.role_id)} role has no access "
                f"to {action.lower()}."
            ),
        )


def needs(action: str):
    """Dependency factory: refuse unless the action level is Yes."""

    def dependency(
        principal: Principal = Depends(current_principal),
    ) -> Principal:
        require_action(principal, action)
        return principal

    return dependency