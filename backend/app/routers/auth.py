""" /auth — sign in, current user, sign out, roles, password reset. """

from __future__ import annotations

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..config import get_settings
from ..core.deps import Principal, current_principal
from ..core.errors import fail, invalid
from ..core.ids import next_id
from ..core.security import new_token, token_hash, verify_password
from ..core.timeutil import iso, utcnow
from ..database import get_db
from ..domain import constants as c
from ..schemas import (
    LoginOut,
    LoginRequest,
    MeOut,
    MessageOut,
    PasswordResetRequest,
    RoleOut,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

REASON_CODES = {
    "credentials": "invalid_credentials",
    "pending": "account_pending",
    "inactive": "account_inactive",
    "role": "role_mismatch",
}

EMAIL = re.compile(r"^\S+@\S+\.\S+$")

# Used to reduce timing differences when the account doesn't exist.
_DUMMY_HASH = (
    "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5x3Mw7Gv7H0r3Kx5d7KZ4P1d8A0z6dS"
)


def session_payload(
    db: Session,
    user: m.User,
    session: m.SessionRow,
    remember: bool = False,
) -> dict:
    return {
        "expiresAt": iso(session.expires_at),
        "session": {
            "id": session.session_id,
            "startedAt": iso(session.login_at),
            "expiresAt": iso(session.expires_at),
            "remember": remember,
        },
        "user": repo.public_user(user),
        "permissions": repo.effective_levels(db, user.role_id),
        "screens": repo.screens_for(db, user.role_id),
    }


@router.post(
    "/login",
    response_model=LoginOut,
    summary="Sign in with the role picked on the sign-in page",
)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    login_id = body.login.strip() if isinstance(body.login, str) else ""

    role_id = (
        body.roleId
        if isinstance(body.roleId, int) and not isinstance(body.roleId, bool)
        else None
    )

    invalid(
        {
            "login": not login_id
            and "Enter your email or employee ID.",
            "password": not body.password
            and "Enter your password.",
            "roleId": role_id not in c.ROLE_IDS
            and "Select the role you're signing in as.",
        }
    )

    key = login_id.lower()

    user = db.execute(
        select(m.User).where(
            or_(
                func.lower(m.User.email) == key,
                func.lower(m.User.user_id) == key,
            )
        )
    ).scalar_one_or_none()

    reason = None
    message = ""
    known = None

    if user is None or not verify_password(
        str(body.password), user.password_hash
    ):
        if user is None:
            verify_password(str(body.password or ""), _DUMMY_HASH)

        reason = "credentials"
        message = "Invalid user ID or password. Please try again."

    else:
        known = user

        if user.status == "Pending activation":
            reason = "pending"
            message = (
                "This account is waiting for an administrator to activate it."
            )

        elif user.status != "Active":
            reason = "inactive"
            message = (
                "This account is inactive. Contact your administrator."
            )

        elif user.role_id != role_id:
            name = c.role_name(role_id)
            reason = "role"
            message = (
                f"This account isn't registered as "
                f"{c.article(name)} {name}."
            )

    if reason:
        repo.log_event(
            db,
            "Sign-in failed",
            "Authentication",
            "Failed",
            (
                f"{login_id} · signing in as "
                f"{c.role_name(role_id)} · {message.rstrip('.')}"
            ),
            user=known,
            attempted_login=login_id,
        )
        db.commit()
        fail(401 if reason == "credentials" else 403,
             REASON_CODES[reason], message)

    settings = get_settings()
    remember = bool(body.remember)

    started = utcnow()
    token = new_token()

    session = m.SessionRow(
        session_id=next_id(db, "SES"),
        user_id=user.user_id,
        login_at=started,
        logout_at=None,
        expires_at=started
        + (
            timedelta(days=settings.remember_days)
            if remember
            else timedelta(hours=settings.session_hours)
        ),
        token_hash=token_hash(token),
    )

    db.add(session)
    db.flush()

    repo.log_event(
        db,
        "User login",
        "Authentication",
        "Completed",
        "Signed in",
        user=user,
        session_id=session.session_id,
    )

    payload = {
        "accessToken": token,
        "tokenType": "bearer",
        **session_payload(db, user, session, remember=remember),
    }

    db.commit()
    return payload


@router.get(
    "/me",
    response_model=MeOut,
    summary="The signed-in user (checks a saved token after a refresh)",
)
def me(
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return session_payload(db, principal.user, principal.session)



@router.post(
    "/logout",
    status_code=204,
    response_class=Response,
    summary="End the session (the token stops working)",
)
def logout(
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    repo.log_event(
        db,
        "User logout",
        "Authentication",
        "Completed",
        "Signed out",
        user=principal.user,
        session_id=principal.session.session_id,
    )

    session = db.get(m.SessionRow, principal.session.session_id)

    if session is not None:
        session.logout_at = utcnow()
        # Do NOT set token_hash to None.
        # The database does not allow NULL in this column.
        db.commit()

    return Response(status_code=204)



@router.get(
    "/roles",
    response_model=list[RoleOut],
    summary="Each role with the screens it can open (public)",
)
def roles(db: Session = Depends(get_db)):
    screens = repo.screen_map(db)

    return [
        {
            "roleId": rid,
            "name": c.role_name(rid),
            "screens": screens.get(str(rid), []),
        }
        for rid in c.ROLE_IDS
    ]


@router.post(
    "/password-reset",
    status_code=202,
    response_model=MessageOut,
    summary="Ask for reset instructions (always 202)",
)
def password_reset(
    body: PasswordResetRequest,
    db: Session = Depends(get_db),
):
    email = body.email.strip() if isinstance(body.email, str) else ""

    invalid(
        {
            "email": not EMAIL.match(email)
            and "Enter a valid email address."
        }
    )

    user = db.execute(
        select(m.User).where(func.lower(m.User.email) == email.lower())
    ).scalar_one_or_none()

    if user:
        repo.log_event(
            db,
            "Password reset requested",
            "Authentication",
            "Completed",
            email,
            user=user,
        )
        db.commit()

    return {
        "message": (
            "If an account exists for this email, "
            "reset instructions will be sent."
        )
    }
