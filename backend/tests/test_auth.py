"""Authentication, sessions and role-based access (docs/API_CONTRACT.md, sections 2 and 4)."""
from datetime import timedelta

from app import models as m
from app.database import session_factory

from .conftest import ACCOUNTS, auth, sign_in


def test_login_returns_token_user_permissions_and_screens(client):
    res = client.post("/api/auth/login", json={"login": "ANALYST@demo.demandiq", "password": "Analyze123!", "roleId": 2, "remember": True})
    assert res.status_code == 200
    body = res.json()
    assert body["tokenType"] == "bearer" and len(body["accessToken"]) == 48
    assert body["user"] == {"id": "USR-1042", "name": "Noura Alharbi", "email": "analyst@demo.demandiq", "roleId": 2, "initials": "NA", "department": "Data & Analytics", "status": "Active"}
    assert body["permissions"] == {"Upload sales": "Review", "Clean data": "Yes", "Run forecasts": "Yes", "Update inventory": "No", "Generate reports": "Yes", "Manage users": "No", "View system logs": "No"}
    assert body["screens"] == ["SCR-01", "SCR-02", "SCR-04", "SCR-05"]
    assert body["session"]["remember"] is True and body["session"]["id"] == "SES-0013"


def test_login_by_employee_id_and_every_role(client):
    for who, (_, password, role) in ACCOUNTS.items():
        assert sign_in(client, who)
    res = client.post("/api/auth/login", json={"login": "usr-3381", "password": "Stock123!", "roleId": 3})
    assert res.status_code == 200


def test_login_refusals_in_order(client):
    def code(body):
        res = client.post("/api/auth/login", json=body)
        return res.status_code, res.json()["detail"]["code"]

    assert code({"login": "", "password": "", "roleId": None}) == (422, "validation_error")
    assert code({"login": "nobody@x.com", "password": "x", "roleId": 1}) == (401, "invalid_credentials")
    assert code({"login": "analyst@demo.demandiq", "password": "wrong", "roleId": 2}) == (401, "invalid_credentials")
    assert code({"login": "new.analyst@demo.demandiq", "password": "Welcome123!", "roleId": 2}) == (403, "account_pending")
    assert code({"login": "former.manager@demo.demandiq", "password": "Former123!", "roleId": 1}) == (403, "account_inactive")
    res = client.post("/api/auth/login", json={"login": "analyst@demo.demandiq", "password": "Analyze123!", "roleId": 4})
    assert res.status_code == 403 and res.json()["detail"] == {"code": "role_mismatch", "message": "This account isn't registered as an Admin."}


def test_refused_sign_ins_are_logged(client, as_user):
    client.post("/api/auth/login", json={"login": "ghost@x.com", "password": "x", "roleId": 1})
    events = client.get("/api/activity", headers=as_user("admin")).json()
    failed = next(e for e in events if e["action"] == "Sign-in failed")
    assert failed["userId"] is None and failed["userName"] == "ghost@x.com" and failed["status"] == "Failed"


def test_me_logout_and_session_checks(client):
    token = sign_in(client, "manager")
    assert client.get("/api/auth/me", headers=auth(token)).json()["user"]["id"] == "USR-2091"
    assert client.post("/api/auth/logout", headers=auth(token)).status_code == 204
    res = client.get("/api/auth/me", headers=auth(token))
    assert res.status_code == 401 and res.json()["detail"]["code"] == "session_ended"
    assert client.get("/api/auth/me").json()["detail"]["code"] == "not_authenticated"
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer nope"}).json()["detail"]["code"] == "session_ended"


def test_expired_deactivated_and_role_changed_sessions_end(client):
    token = sign_in(client, "manager")
    with session_factory()() as db:
        session = db.query(m.SessionRow).filter(m.SessionRow.user_id == "USR-2091", m.SessionRow.logout_at.is_(None)).one()
        session.expires_at = session.login_at - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/auth/me", headers=auth(token)).json()["detail"]["code"] == "session_expired"

    admin = auth(sign_in(client, "admin"))
    token = sign_in(client, "manager")
    client.patch("/api/users/USR-2091", headers=admin, json={"roleId": 3})
    assert client.get("/api/auth/me", headers=auth(token)).json()["detail"]["code"] == "role_changed"
    client.patch("/api/users/USR-2091", headers=admin, json={"roleId": 1})
    token = sign_in(client, "manager")
    client.patch("/api/users/USR-2091", headers=admin, json={"status": "Inactive"})
    assert client.get("/api/auth/me", headers=auth(token)).json()["detail"]["code"] == "account_inactive"


def test_password_reset_is_always_202(client):
    assert client.post("/api/auth/password-reset", json={"email": "analyst@demo.demandiq"}).status_code == 202
    assert client.post("/api/auth/password-reset", json={"email": "nobody@nowhere.io"}).status_code == 202
    assert client.post("/api/auth/password-reset", json={"email": "bad"}).status_code == 422


def test_roles_are_public(client):
    roles = client.get("/api/auth/roles").json()
    assert [r["roleId"] for r in roles] == [1, 2, 3, 4]
    assert roles[3]["screens"][-1] == "SCR-06"


def test_permissions_are_enforced_by_the_server(client, as_user):
    manager, analyst, inventory, admin = (as_user(w) for w in ("manager", "analyst", "inventory", "admin"))
    assert client.post("/api/datasets", headers=analyst, files={"file": ("a.csv", b"Date,SKU,Units\n2025-06-26,PP-4012,3\n")}).json()["detail"]["code"] == "forbidden"
    assert client.post("/api/datasets/DS-0007/clean", headers=manager, json={}).status_code == 403
    assert client.post("/api/forecasts", headers=manager, json={"sku": "PP-4012", "model": "ARIMA", "horizon": 7, "startDate": "2025-03-19", "endDate": "2025-06-18"}).status_code == 403
    assert client.patch("/api/inventory/PP-4012", headers=admin, json={"stock": 5, "reason": "x"}).json()["detail"]["message"] == "The Admin role isn't allowed to update stock or reorders."
    assert client.get("/api/users", headers=inventory).status_code == 403
    assert client.get("/api/activity", headers=analyst).status_code == 403
    assert client.post("/api/reports", headers=inventory, json={"name": "Sales Summary", "format": "PDF"}).json()["detail"]["code"] == "report_not_allowed"
    # Run forecasts = View is enough for a recommendation, but only on a screen the role can open
    assert client.post("/api/forecasts/recommendation", headers=manager, json={"skus": ["PP-4012"], "filters": {}}).status_code == 403
