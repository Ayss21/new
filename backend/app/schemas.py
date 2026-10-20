"""Request and response schemas (Pydantic v2), camelCase on the wire as in docs/API_CONTRACT.md.

Request bodies accept loosely typed values on purpose: the routes check them and answer with the contract's
field messages ({"detail": {"code": "validation_error", "fields": {...}}}) instead of Pydantic's defaults.
Response models describe exactly what the frontend reads; they also drive the Swagger UI at /docs.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Loose(BaseModel):
    """A request body: unknown fields are ignored, values are checked by the route."""

    model_config = ConfigDict(extra="ignore")


Level = Literal["Yes", "View", "Review", "No"]

# ================================================================================================
# Requests
# ================================================================================================


class LoginRequest(Loose):
    login: Any = Field(None, description="Email or employee ID (case-insensitive)", examples=["analyst@demo.demandiq"])
    password: Any = Field(None, examples=["Analyze123!"])
    roleId: Any = Field(None, description="1 Store Manager, 2 Data Analyst, 3 Inventory Supervisor, 4 Admin", examples=[2])
    remember: Any = Field(False, description="true → 7-day session, otherwise 8 hours")


class PasswordResetRequest(Loose):
    email: Any = Field(None, examples=["analyst@demo.demandiq"])


class CleanRequest(Loose):
    capOutliers: Any = Field(True, description="Cap extreme values per product")
    overlap: Any = Field("replace", description='"replace" or "skip" a record whose date and product exist')


class ForecastRequest(Loose):
    sku: Any = Field(None, examples=["PP-4012"])
    model: Any = Field(
        None,
        examples=["ARIMA"],
        description="Moving Average, Linear Regression or ARIMA",
    )
    horizon: Any = Field(
        None,
        examples=[30],
        description="Days to forecast, 1–365",
    )
    startDate: Any = Field(None, examples=["2025-03-19"])
    endDate: Any = Field(None, examples=["2025-06-18"])

class RecommendationRequest(Loose):
    skus: Any = Field(None, examples=[["PP-4012", "PE-7820"]])
    filters: Any = Field(default_factory=dict, examples=[{"start": "2025-03-19", "end": "2025-06-18", "region": ["Central"]}])


class StockUpdate(Loose):
    stock: Any = Field(None, examples=[1450])
    reason: Any = Field(None, examples=["Cycle count"])
    notes: Any = Field("", examples=["Aisle 4 recount"])


class ReorderCreate(Loose):
    sku: Any = Field(None, examples=["PP-4012"])
    quantity: Any = Field(None, examples=[600])
    supplier: Any = Field(None, examples=["Gulf Polymers Supply"])


class ReorderUpdate(Loose):
    status: Any = Field(None, examples=["Delivered"])


class UserCreate(Loose):
    name: Any = Field(None, examples=["Sara Khalid"])
    department: Any = Field(None, examples=["Commercial"])
    roleId: Any = Field(None, examples=[1])
    status: Any = Field("Active", examples=["Active"])
    password: Any = Field(None, examples=["Welcome123!"])
    id: Any = Field(None, description="Optional employee ID (imports)")
    email: Any = Field(None, description="Optional work email (imports)")


class UserUpdate(Loose):
    name: Any = None
    email: Any = None
    department: Any = None
    roleId: Any = None
    status: Any = None
    password: Any = None


class CategoryCreate(Loose):
    id: Any = Field(None, description="Optional, like CAT-006")
    name: Any = Field(None, examples=["Specialty Resins"])
    description: Any = Field("", examples=["High-performance resin grades"])


class CategoryUpdate(Loose):
    name: Any = None
    description: Any = None
    status: Any = None


class PermissionUpdate(Loose):
    action: Any = Field(None, examples=["Run forecasts"])
    roleId: Any = Field(None, examples=[1])
    value: Any = Field(None, examples=["View"])


class ScreensUpdate(Loose):
    screens: Any = Field(None, examples=[["SCR-01", "SCR-02", "SCR-04"]])


class ReportRequest(Loose):
    name: Any = Field(None, examples=["Sales Summary"])
    format: Any = Field(None, examples=["PDF"])
    filters: Any = Field(default_factory=dict, examples=[{"start": "2025-03-19", "end": "2025-06-18", "region": ["Central"]}])


class EmailReportRequest(ReportRequest):
    recipients: Any = Field(None, examples=[["regional.lead@demandiq.test"]])
    subject: Any = Field("", examples=["Sales summary · June"])
    message: Any = Field("", examples=["This month's sales."])


class ActivityCreate(Loose):
    action: Any = Field(None, examples=["Screen access denied"])
    details: Any = Field("", examples=["#/administration · Store Manager"])


class ErrorUpdate(Loose):
    status: Any = Field(None, examples=["Investigating"])
    notes: Any = Field("", examples=["Checking why the filters matched no sales"])


# ================================================================================================
# Responses
# ================================================================================================


class UserOut(CamelModel):
    id: str
    name: str
    email: str
    role_id: int
    initials: str
    department: str
    status: str


class SessionInfo(CamelModel):
    id: str
    started_at: str
    expires_at: str
    remember: bool


class MeOut(CamelModel):
    expires_at: str
    session: SessionInfo
    user: UserOut
    permissions: dict[str, Level]
    screens: list[str]


class LoginOut(MeOut):
    access_token: str
    token_type: str = "bearer"


class RoleOut(CamelModel):
    role_id: int
    name: str
    screens: list[str]


class MessageOut(BaseModel):
    message: str


class Kpi(BaseModel):
    id: str
    label: str
    value: float | int | None
    format: str
    detail: str
    icon: str
    tone: str


class SummaryOut(CamelModel):
    role_id: int
    generated_at: str
    start_date: str
    end_date: str
    kpis: list[Kpi]


class SaleOut(CamelModel):
    id: str
    date: str
    sku: str
    category: str
    region: str
    units: int
    unit_price: float
    discount_rate: float
    net_revenue: float
    dataset_id: str | None


class InventoryOut(CamelModel):
    sku: str
    name: str
    category: str
    region: str
    unit_price: float
    unit_cost: float | None
    reorder: int
    safety: int
    stock: int
    demand: int
    status: Literal["Safe", "Warning", "Critical"]
    suggested: int
    days: int


class AlertOut(CamelModel):
    sku: str
    name: str
    status: str
    stock: int
    reorder: int
    safety: int
    days: int
    suggested: int
    message: str


class SnapshotItem(BaseModel):
    sku: str
    stock: int
    status: str


class SnapshotOut(CamelModel):
    month: str
    as_of: str
    items: list[SnapshotItem]


class ReorderOut(CamelModel):
    id: str
    sku: str
    quantity: int
    supplier: str
    status: Literal["Ordered", "Delivered"]
    ordered_at: str
    delivered_at: str | None
    user_id: str
    user_name: str | None


class CategoryOut(BaseModel):
    id: str
    name: str
    description: str
    status: str
    products: int


class ReportTypeOut(BaseModel):
    name: str
    description: str
    icon: str


class ReportOut(CamelModel):
    id: str
    name: str
    format: str
    generated_at: str
    user_id: str
    user_name: str | None
    role_id: int
    status: Literal["Processing", "Completed", "Failed"]
    filters: dict | None
    error: str | None


class EmailQueuedOut(BaseModel):
    id: str
    status: str
    recipients: list[str]
    name: str
    format: str


class ActivityOut(CamelModel):
    id: str
    at: str
    session_id: str | None
    user_id: str | None
    user_name: str
    role_id: int | None
    action: str
    module: str
    details: str
    status: str


class SessionOut(CamelModel):
    id: str
    user_id: str
    login_at: str
    logout_at: str | None


class ErrorOut(BaseModel):
    id: str
    at: str
    module: str
    type: str
    severity: str
    message: str
    status: str
    notes: str | None


class LineageSource(CamelModel):
    dataset_id: str | None
    file_name: str | None
    records: int
    first_date: str
    last_date: str


class Lineage(BaseModel):
    records: int
    sources: list[LineageSource]
    waiting: list[LineageSource]


class LineageOut(Lineage):
    sku: str
    startDate: str
    endDate: str
    days: int


class Metrics(BaseModel):
    mae: float | None
    rmse: float | None
    mape: float | None


class ForecastPointOut(BaseModel):
    date: str
    predicted: int


class Person(BaseModel):
    id: str
    name: str


class ForecastOut(CamelModel):
    id: str
    sku: str
    model: str
    horizon: int
    status: str
    start_date: str | None
    end_date: str | None
    configuration: dict[str, Any]
    metrics: Metrics
    evaluation: dict[str, int | None]
    points: list[ForecastPointOut]
    lineage: Lineage | None
    generated_at: str
    generated_by: Person | None


class DatasetLineage(CamelModel):
    records_in_history: int
    skus: list[str]
    forecasted_skus: list[str]
    forecast_ids: list[str]


class DatasetOut(CamelModel):
    id: str
    file_name: str
    uploaded_at: str
    uploader_id: str
    uploader: str | None
    record_count: int
    validation: str
    checks: dict[str, int] | None
    coverage: dict[str, Any] | None
    cleaning: str
    cleaned_at: str | None
    cleaning_summary: dict[str, Any] | None
    pending_count: int
    new_products: list[str]
    forecasting: str
    forecasted_at: str | None
    lineage: DatasetLineage
    error: str | None


class UploadOut(BaseModel):
    dataset: DatasetOut
    validation: dict[str, Any]


class CleanOut(BaseModel):
    dataset: DatasetOut
    summary: dict[str, Any]
    salesRange: dict[str, str]


class CompareOut(CamelModel):
    sku: str
    horizon: int
    start_date: str
    end_date: str
    results: list[dict[str, Any]]


class RecommendationOut(CamelModel):
    skus: list[str]
    start_date: str
    end_date: str
    days: int
    test_days: int
    metric: str
    recommended: str | None
    reason: str | None
    margin: float | None
    close: bool
    ranked: list[str]
    models: list[dict[str, Any]]


class RestoreOut(BaseModel):
    permissions: dict[str, dict[str, str]]
    screens: dict[str, list[str]]


class HealthOut(BaseModel):
    status: str
    database: str
    version: str
