"""/users, /categories and /roles — accounts, product categories, action permissions and screen access."""
from __future__ import annotations

import re
import unicodedata

from fastapi import APIRouter, Depends
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..core.deps import Principal, current_principal, needs
from ..core.errors import fail, invalid, not_found
from ..core.ids import next_category_id, next_user_id
from ..core.security import hash_password
from ..core.timeutil import utcnow
from ..database import get_db
from ..domain import constants as c
from ..schemas import CategoryCreate, CategoryOut, CategoryUpdate, PermissionUpdate, RestoreOut, ScreensUpdate, UserCreate, UserOut, UserUpdate

router = APIRouter(tags=["Administration"])
EMAIL = re.compile(r"^\S+@\S+\.\S+$")
EMPLOYEE_ID = re.compile(r"^[A-Za-z]{2,4}-\d{3,6}$")
manage_users = needs("Manage users")


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _role(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value in c.ROLE_IDS else None


# ------------------------------------------------------------------------------------------------
# Users
# ------------------------------------------------------------------------------------------------



@router.get("/users", response_model=list[UserOut])
def list_users(
    _p: Principal = Depends(manage_users),
    db: Session = Depends(get_db),
):
    users = db.execute(
        select(m.User).order_by(m.User.user_id)
    ).scalars()

    return [repo.public_user(user) for user in users]



def work_email(db: Session, name: str, user_id: str, domain: str) -> str:
    """first.last@<domain> (accents dropped), with 2, 3 … when taken; the employee ID for non-Latin names."""
    plain = unicodedata.normalize("NFKD", name)
    plain = "".join(ch for ch in plain if not unicodedata.combining(ch)).lower()
    words = [re.sub(r"[^a-z0-9-]", "", w) for w in plain.split()]
    words = [w for w in words if w]
    local = (f"{words[0]}.{words[-1]}" if len(words) > 1 else (words[0] if words else "")) or user_id.lower()
    taken = {e.lower() for e in db.execute(select(m.User.email)).scalars()}
    email = f"{local}@{domain}"
    n = 2
    while email in taken:
        email = f"{local}{n}@{domain}"
        n += 1
    return email


@router.post("/users", status_code=201, response_model=UserOut, summary="Create an account (the server gives the employee ID and work email)")
def create_user(body: UserCreate, principal: Principal = Depends(manage_users), db: Session = Depends(get_db)):
    name = _text(body.name)
    requested_id = _text(body.id).upper()
    requested_email = _text(body.email)
    status = body.status if body.status is not None else "Active"
    invalid(
        {
            "name": not name and "Enter the user's full name.",
            "id": requested_id and not EMPLOYEE_ID.match(requested_id) and "Use the format USR-2044, or leave it out.",
            "email": requested_email and not EMAIL.match(requested_email) and "Enter a valid work email, or leave it out.",
            "department": not _text(body.department) and "Select a department.",
            "roleId": _role(body.roleId) is None and "Select a role.",
            "status": status not in ("Active", "Pending activation") and "New accounts are Active or Pending activation.",
            "password": len(str(body.password or "")) < 8 and "At least 8 characters.",
        }
    )
    if requested_email and db.execute(select(m.User).where(func.lower(m.User.email) == requested_email.lower())).first():
        fail(409, "email_taken", "A user with this email already exists.", fields={"email": "A user with this email already exists."})
    if requested_id and db.execute(select(m.User).where(func.lower(m.User.user_id) == requested_id.lower())).first():
        fail(409, "id_taken", "This employee ID is already in use.", fields={"id": "This employee ID is already in use."})
    user_id = requested_id or next_user_id(db)
    domain = principal.user.email.split("@")[1] if "@" in principal.user.email else "demandiq.com"
    
    user = m.User(
        user_id=user_id,
        full_name=name,
        email=requested_email or work_email(db, name, user_id, domain),
        password_hash=hash_password(str(body.password)),
        role_id=body.roleId,
        department=_text(body.department),
        status=status,
    )

    db.add(user)
    db.flush()
    repo.log_event(db, "User created", "Admin Panel", "Completed", f"{user.user_id} · {user.full_name} ({c.role_name(user.role_id)})", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    return repo.public_user(user)


@router.patch("/users/{user_id}", response_model=UserOut, summary="Change a user's name, email, department, role, status or password")
def update_user(user_id: str, body: UserUpdate, principal: Principal = Depends(manage_users), db: Session = Depends(get_db)):
    target = db.get(m.User, user_id)
    if target is None:
        not_found("User not found.")
    patch = body.model_dump(exclude_unset=True)
    invalid(
        {
            "name": "name" in patch and not _text(patch["name"]) and "Enter the user's full name.",
            "email": "email" in patch and not EMAIL.match(_text(patch["email"])) and "Enter a valid work email.",
            "department": "department" in patch and not _text(patch["department"]) and "Select a department.",
            "roleId": "roleId" in patch and _role(patch["roleId"]) is None and "Select a role.",
            "status": "status" in patch and patch["status"] not in c.USER_STATUSES and f"Use one of: {', '.join(c.USER_STATUSES)}.",
            "password": "password" in patch and len(str(patch["password"] or "")) < 8 and "At least 8 characters.",
        }
    )
    if patch.get("email") and db.execute(select(m.User).where(m.User.user_id != target.user_id, func.lower(m.User.email) == _text(patch["email"]).lower())).first():
        fail(409, "email_taken", "A user with this email already exists.", fields={"email": "A user with this email already exists."})
    active_admins = db.execute(select(func.count()).select_from(m.User).where(m.User.role_id == c.ADMIN, m.User.status == "Active")).scalar_one()
    loses_admin = target.role_id == c.ADMIN and ((patch.get("roleId") and patch["roleId"] != c.ADMIN) or (patch.get("status") and patch["status"] != "Active"))
    if loses_admin and active_admins <= 1:
        fail(409, "last_admin", "At least one active Admin is required.")
    if target.user_id == principal.user.user_id and patch.get("status") and patch["status"] != "Active":
        fail(409, "own_account", "You can't deactivate your own account.")
    if target.user_id == principal.user.user_id and patch.get("roleId") and patch["roleId"] != target.role_id:
        fail(409, "own_role", "You can't change your own role while signed in.")

    activated = target.status != "Active" and patch.get("status") == "Active"
    for key in ("name", "email", "department"):
        if key in patch:
            setattr(target, key, _text(patch[key]))
    if "roleId" in patch:
        target.role_id = patch["roleId"]
    if "status" in patch:
        target.status = patch["status"]
    if patch.get("password"):
        target.password_hash = hash_password(str(patch["password"]))
    db.flush()
    repo.log_event(db, "User account activated" if activated else "User updated", "Admin Panel", "Completed", f"{target.user_id} · {target.name} ({c.role_name(target.role_id)})", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    return repo.public_user(target)


# ------------------------------------------------------------------------------------------------
# Categories
# ------------------------------------------------------------------------------------------------


@router.get("/categories", response_model=list[CategoryOut], summary="Product categories with their product counts", tags=["Catalog"])
def list_categories(_p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return repo.load_categories(db)



@router.post(
    "/categories",
    status_code=201,
    response_model=CategoryOut,
    summary="Create a category",
    tags=["Catalog"],
)
def create_category(
    body: CategoryCreate,
    principal: Principal = Depends(manage_users),
    db: Session = Depends(get_db),
):
    name = _text(body.name)
    requested = _text(body.id).upper()

    invalid({
        "name": not name and "Enter a category name.",
        "id": (
            requested
            and not re.match(r"^CAT-\d{3}$", requested)
            and "Category ID must look like CAT-006, or leave it blank."
        ),
    })

    # Categories are stored as product families in this database.
    if db.execute(
        select(m.ProductFamily).where(
            func.lower(m.ProductFamily.family_name) == name.lower()
        )
    ).first():
        fail(
            409,
            "name_taken",
            "This category already exists.",
            fields={"name": "This category already exists."},
        )

    category_id = requested or next_category_id(db)

    if db.get(m.ProductFamily, category_id):
        fail(
            409,
            "id_taken",
            "This category ID is already in use.",
            fields={"id": "This category ID is already in use."},
        )

    category = m.ProductFamily(
        family_id=category_id,
        family_name=name,
        description=_text(body.description)[:255],
        status="Active",
    )

    db.add(category)
    db.flush()

    repo.log_event(
        db,
        "Category created",
        "Admin Panel",
        "Completed",
        f"{category_id} {name}",
        user=principal.user,
        session_id=principal.session.session_id,
    )

    db.commit()
    return repo.category_json(db, category)




@router.patch(
    "/categories/{category_id}",
    response_model=CategoryOut,
    summary="Rename, describe or (de)activate a category",
    tags=["Catalog"],
)
def update_category(
    category_id: str,
    body: CategoryUpdate,
    principal: Principal = Depends(manage_users),
    db: Session = Depends(get_db),
):
    category = db.get(m.ProductFamily, category_id)

    if category is None:
        not_found("That category no longer exists.")

    patch = body.model_dump(exclude_unset=True)

    invalid({
        "name": (
            "name" in patch
            and not _text(patch["name"])
            and "Enter a category name."
        ),
        "status": (
            "status" in patch
            and patch["status"] not in ("Active", "Inactive")
            and "Use Active or Inactive."
        ),
    })

    if patch.get("name") and db.execute(
        select(m.ProductFamily).where(
            m.ProductFamily.family_id != category_id,
            func.lower(m.ProductFamily.family_name)
            == _text(patch["name"]).lower(),
        )
    ).first():
        fail(
            409,
            "name_taken",
            "This category already exists.",
            fields={"name": "This category already exists."},
        )

    if "name" in patch:
        category.family_name = _text(patch["name"])

    if "description" in patch:
        category.description = _text(patch["description"])[:255]

    if "status" in patch:
        category.status = patch["status"]

    db.flush()

    repo.log_event(
        db,
        "Product category updated",
        "Admin Panel",
        "Completed",
        f"{category.family_id} {category.family_name}",
        user=principal.user,
        session_id=principal.session.session_id,
    )

    db.commit()
    return repo.category_json(db, category)



# ------------------------------------------------------------------------------------------------
# Action permissions and screen access
# ------------------------------------------------------------------------------------------------


@router.get("/roles/permissions", response_model=dict[str, dict[str, str]], summary="The action permission matrix as the Admin set it")
def permissions(_p: Principal = Depends(manage_users), db: Session = Depends(get_db)):
    return repo.permission_matrix(db)


@router.patch("/roles/permissions", response_model=dict[str, dict[str, str]], summary="Change one cell of the matrix")
def update_permission(body: PermissionUpdate, principal: Principal = Depends(manage_users), db: Session = Depends(get_db)):
    action, role_id, value = body.action, _role(body.roleId), body.value
    invalid({"action": action not in c.PERMISSION_ACTIONS and f"Use one of: {', '.join(c.PERMISSION_ACTIONS)}.", "roleId": role_id is None and "Use a role ID from 1 to 4."})
    options = c.PERMISSION_OPTIONS[action]
    invalid({"value": value not in options and f"Use one of: {', '.join(options)}."})
    lock = c.action_lock(action, role_id)
    if lock:
        fail(409, "locked", lock)
    row = db.get(m.RolePermission, (role_id, action))
    if row is None:
        db.add(m.RolePermission(action=action, role_id=role_id, level=value))
    else:
        row.level = value
    db.flush()
    repo.log_event(db, "Role modified", "Admin Panel", "Completed", f"{c.role_name(role_id)} · {action} → {'No access' if value == 'No' else value}", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    return repo.permission_matrix(db)


@router.get("/roles/screens", response_model=dict[str, list[str]], summary="Role ID → the screen IDs it can open")
def screens(_p: Principal = Depends(manage_users), db: Session = Depends(get_db)):
    return repo.screen_map(db)


@router.put("/roles/{role_id}/screens", response_model=dict[str, list[str]], summary="Replace one role's screens")
def update_screens(role_id: int, body: ScreensUpdate, principal: Principal = Depends(manage_users), db: Session = Depends(get_db)):
    if role_id not in c.ROLE_IDS:
        not_found("Unknown role ID.")
    requested = body.screens
    invalid({"screens": (not isinstance(requested, list) and "Send screens as a list of screen IDs.") or (any(s not in c.SCREEN_IDS for s in requested) and f"Use screen IDs from {c.SCREEN_IDS[0]} to {c.SCREEN_IDS[-1]}.")})
    before = repo.screens_for(db, role_id)
    after = [s for s in c.SCREEN_IDS if s in requested]
    changed = [s for s in c.SCREEN_IDS if (s in before) != (s in after)]
    for screen_id in changed:
        lock = c.access_lock(role_id, screen_id)
        if lock:
            fail(409, "locked", lock)
    db.execute(delete(m.RoleScreen).where(m.RoleScreen.role_id == role_id))
    for screen_id in after:
        db.add(m.RoleScreen(role_id=role_id, screen_id=screen_id))
    db.flush()
    for screen_id in changed:
        state = "Allowed" if screen_id in after else "No access"
        repo.log_event(db, "Screen access changed", "Admin Panel", "Completed", f"{c.role_name(role_id)} (role ID {role_id}) · {screen_id} {c.SCREEN_LABEL[screen_id]} → {state}", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    return repo.screen_map(db)



@router.post(
    "/roles/restore-defaults",
    response_model=RestoreOut,
    summary="Action permissions and screen access back to the defaults",
)
def restore_defaults(
    principal: Principal = Depends(manage_users),
    db: Session = Depends(get_db),
):
    # Clear existing permissions and role-screen assignments
    db.execute(delete(m.RolePermission))
    db.execute(delete(m.RoleScreen))

    # Restore default action permissions, including required screen_id
    for action, levels in c.DEFAULT_PERMISSIONS.items():
        screen_id = c.PERMISSION_SCREEN[action]

        for role_id, level in levels.items():
            db.add(
                m.RolePermission(
                    action=action,
                    role_id=role_id,
                    screen_id=screen_id,
                    access_level=level,
                )
            )

    # Restore default screen access for each role
    for role_id, ids in c.DEFAULT_ROLE_SCREENS.items():
        for screen_id in ids:
            db.add(
                m.RoleScreen(
                    role_id=role_id,
                    screen_id=screen_id,
                )
            )

    # Flush and commit the restored defaults
    db.flush()

    repo.log_event(
        db,
        "Role permissions restored",
        "Admin Panel",
        "Completed",
        "Action permissions and screen access set to their defaults",
        user=principal.user,
        session_id=principal.session.session_id,
    )

    db.commit()

    return {
        "permissions": repo.permission_matrix(db),
        "screens": repo.screen_map(db),
    }
