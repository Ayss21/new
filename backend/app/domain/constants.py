"""Roles, screens, permissions and report types: the defaults (the database holds the live settings)."""
from __future__ import annotations

STORE_MANAGER, DATA_ANALYST, INVENTORY_SUPERVISOR, ADMIN = 1, 2, 3, 4
ROLE_IDS = [STORE_MANAGER, DATA_ANALYST, INVENTORY_SUPERVISOR, ADMIN]
ROLE_NAMES = {STORE_MANAGER: "Store Manager", DATA_ANALYST: "Data Analyst", INVENTORY_SUPERVISOR: "Inventory Supervisor", ADMIN: "Admin"}


def role_name(role_id: int | None) -> str:
    return ROLE_NAMES.get(role_id, "Unknown role")


def article(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


SCREENS = [
    ("SCR-01", "Dashboard", "dashboard"),
    ("SCR-02", "Sales Data", "sales-data"),
    ("SCR-03", "Inventory", "inventory"),
    ("SCR-04", "Reports & Exports", "reports"),
    ("SCR-05", "Forecasting", "forecasting"),
    ("SCR-06", "Administration", "administration"),
]
SCREEN_IDS = [s[0] for s in SCREENS]
SCREEN_LABEL = {s[0]: s[1] for s in SCREENS}
LANDING_SCREEN = "SCR-01"
ADMIN_SCREEN = "SCR-06"

DEFAULT_ROLE_SCREENS = {
    STORE_MANAGER: ["SCR-01", "SCR-02", "SCR-04"],
    DATA_ANALYST: ["SCR-01", "SCR-02", "SCR-04", "SCR-05"],
    INVENTORY_SUPERVISOR: ["SCR-01", "SCR-03", "SCR-04"],
    ADMIN: ["SCR-01", "SCR-02", "SCR-03", "SCR-04", "SCR-05", "SCR-06"],
}

PERMISSION_ACTIONS = ["Upload sales", "Clean data", "Run forecasts", "Update inventory", "Generate reports", "Manage users", "View system logs"]
PERMISSION_SCREEN = {
    "Upload sales": "SCR-02",
    "Clean data": "SCR-02",
    "Run forecasts": "SCR-05",
    "Update inventory": "SCR-03",
    "Generate reports": "SCR-04",
    "Manage users": "SCR-06",
    "View system logs": "SCR-06",
}
PERMISSION_OPTIONS = {
    "Upload sales": ["Yes", "Review", "No"],
    "Clean data": ["Yes", "View", "No"],
    "Run forecasts": ["Yes", "View", "No"],
    "Update inventory": ["Yes", "View", "No"],
    "Generate reports": ["Yes", "No"],
    "Manage users": ["Yes", "No"],
    "View system logs": ["Yes", "No"],
}


def _perms(sm: str, da: str, inv: str, admin: str) -> dict[int, str]:
    return {STORE_MANAGER: sm, DATA_ANALYST: da, INVENTORY_SUPERVISOR: inv, ADMIN: admin}


DEFAULT_PERMISSIONS = {
    "Upload sales": _perms("Yes", "Review", "No", "Review"),
    "Clean data": _perms("No", "Yes", "No", "View"),
    "Run forecasts": _perms("View", "Yes", "View", "View"),
    "Update inventory": _perms("No", "No", "Yes", "View"),
    "Generate reports": _perms("Yes", "Yes", "Yes", "Yes"),
    "Manage users": _perms("No", "No", "No", "Yes"),
    "View system logs": _perms("No", "No", "No", "Yes"),
}

# The Admin only views the Console modules: these levels are locked for role 4
ADMIN_VIEW_ONLY = {"Upload sales": "Review", "Clean data": "View", "Run forecasts": "View", "Update inventory": "View"}

ACTION_TEXT = {
    "Upload sales": "upload sales data",
    "Clean data": "clean datasets",
    "Run forecasts": "run forecasts",
    "Update inventory": "update stock or reorders",
    "Generate reports": "generate reports",
    "Manage users": "manage users, categories and permissions",
    "View system logs": "view system logs",
}


def action_lock(action: str, role_id: int) -> str | None:
    if role_id == ADMIN and action == "Manage users":
        return "Locked so an admin is always available."
    if role_id == ADMIN and action in ADMIN_VIEW_ONLY:
        return "The Admin only views Sales Data, Inventory and Forecasting."
    if PERMISSION_SCREEN.get(action) == ADMIN_SCREEN and role_id != ADMIN:
        return "Administration (SCR-06) is only for the Admin role."
    return None


def access_lock(role_id: int, screen_id: str) -> str | None:
    if screen_id == LANDING_SCREEN:
        return "Every role starts on its Dashboard after sign-in, so it can't be removed."
    if screen_id == ADMIN_SCREEN:
        return "The Admin always keeps Administration, so access settings can't be locked out." if role_id == ADMIN else "Administration is only for the Admin role."
    return None


REPORT_TYPES = [
    ("Sales Summary", "Revenue, volume and product performance", "trend"),
    ("Demand Forecast Report", "Forecasts by product, model and horizon", "trend"),
    ("Forecast Accuracy Report", "MAE, RMSE and MAPE evaluation", "check"),
    ("Sales by Region", "Regional revenue and volume performance", "trend"),
    ("Product Performance Report", "Product ranking and contribution", "box"),
    ("Inventory Status Report", "Stock position, risk and coverage", "box"),
    ("Reorder Recommendation Report", "Suggested replenishment actions", "warning"),
    ("Data Quality Report", "Validation and cleaning outcomes", "shield"),
    ("User Activity Report", "Platform actions and audit events", "log"),
    ("System Error Report", "Technical exceptions and resolution", "warning"),
]
DEFAULT_REPORTS_BY_ROLE = {
    STORE_MANAGER: ["Sales Summary", "Demand Forecast Report", "Forecast Accuracy Report", "Sales by Region", "Product Performance Report"],
    DATA_ANALYST: ["Sales Summary", "Demand Forecast Report", "Forecast Accuracy Report", "Data Quality Report"],
    INVENTORY_SUPERVISOR: ["Inventory Status Report", "Reorder Recommendation Report"],
    ADMIN: [r[0] for r in REPORT_TYPES],
}
REPORT_FORMATS = ["PDF", "XLSX", "CSV"]

MODULES = ["Authentication", "Sales Upload", "Data Quality", "Forecasting", "Inventory", "Reports & Exports", "Admin Panel"]

FORECAST_MODELS = ["Moving Average", "Linear Regression", "ARIMA"]
LIST_FILTERS = ["category", "sku", "region", "model", "status"]
USER_STATUSES = ["Active", "Pending activation", "Inactive"]
ERROR_STATUSES = ["Open", "Investigating", "Resolved"]


def initials_of(name: str) -> str:
    return "".join(part[0] for part in name.split() if part)[:2].upper()
