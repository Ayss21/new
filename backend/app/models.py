"""DemandIQ ERD v3 ORM models. Maps the 17 tables in create_tables.sql."""

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.mssql import NVARCHAR
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Role(Base):
    __tablename__ = "roles"

    role_id = Column(SmallInteger, primary_key=True)
    role_name = Column(NVARCHAR(50), nullable=False, unique=True)


class Screen(Base):
    __tablename__ = "screens"

    screen_id = Column(NVARCHAR(10), primary_key=True)
    screen_name = Column(NVARCHAR(100), nullable=False, unique=True)


class RoleScreen(Base):
    __tablename__ = "role_screens"

    role_id = Column(
        SmallInteger, ForeignKey("roles.role_id"), primary_key=True
    )
    screen_id = Column(
        NVARCHAR(10), ForeignKey("screens.screen_id"), primary_key=True
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    __table_args__ = (
        CheckConstraint(
            "access_level IN (N'Yes', N'View', N'Review', N'No')",
            name="CK_role_permissions_access_level",
        ),
    )

    role_id = Column(
        SmallInteger, ForeignKey("roles.role_id"), primary_key=True
    )
    action = Column(NVARCHAR(50), primary_key=True)
    screen_id = Column(
        NVARCHAR(10), ForeignKey("screens.screen_id"), nullable=False
    )
    access_level = Column(NVARCHAR(20), nullable=False)


class RoleReportType(Base):
    __tablename__ = "role_report_types"

    __table_args__ = (
        Index("IX_role_report_types_report_type", "report_type_id"),
    )

    role_id = Column(
        SmallInteger, ForeignKey("roles.role_id"), primary_key=True
    )
    report_type_id = Column(SmallInteger, primary_key=True)
    report_name = Column(NVARCHAR(100), nullable=False)
    description = Column(NVARCHAR(255), nullable=True)


class User(Base):
    __tablename__ = "users"

    __table_args__ = (
        CheckConstraint(
            "status IN "
            "(N'Active', N'Inactive', N'Pending activation')",
            name="CK_users_status",
        ),
        Index("IX_users_role_id", "role_id"),
    )

    user_id = Column(NVARCHAR(20), primary_key=True)
    full_name = Column(NVARCHAR(120), nullable=False)
    email = Column(NVARCHAR(255), nullable=False, unique=True)
    password_hash = Column(NVARCHAR(255), nullable=False)
    role_id = Column(
        SmallInteger, ForeignKey("roles.role_id"), nullable=False
    )
    department = Column(NVARCHAR(100), nullable=True)
    status = Column(NVARCHAR(30), nullable=False, default="Active")


class SessionRow(Base):
    __tablename__ = "sessions"

    __table_args__ = (
        CheckConstraint(
            "logout_at IS NULL OR logout_at >= login_at",
            name="CK_sessions_logout",
        ),
        CheckConstraint(
            "expires_at >= login_at",
            name="CK_sessions_expiry",
        ),
        Index("IX_sessions_user_login", "user_id", "login_at"),
    )

    session_id = Column(NVARCHAR(20), primary_key=True)
    user_id = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=False
    )
    login_at = Column(DateTime(timezone=True), nullable=False)
    logout_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    token_hash = Column(NVARCHAR(128), nullable=False, unique=True)


class ProductFamily(Base):
    __tablename__ = "product_families"

    __table_args__ = (
        CheckConstraint(
            "status IN (N'Active', N'Inactive')",
            name="CK_product_families_status",
        ),
    )

    family_id = Column(NVARCHAR(20), primary_key=True)
    family_name = Column(NVARCHAR(100), nullable=False, unique=True)
    description = Column(NVARCHAR(255), nullable=True)
    status = Column(NVARCHAR(20), nullable=False, default="Active")


class Product(Base):
    __tablename__ = "products"

    __table_args__ = (
        CheckConstraint(
            "unit_price >= 0 AND "
            "(unit_cost IS NULL OR unit_cost >= 0)",
            name="CK_products_prices",
        ),
        CheckConstraint(
            "safety_stock >= 0 AND reorder_level >= safety_stock",
            name="CK_products_levels",
        ),
        Index("IX_products_family_id", "family_id"),
    )

    sku = Column(NVARCHAR(20), primary_key=True)
    product_name = Column(NVARCHAR(150), nullable=False)
    family_id = Column(
        NVARCHAR(20), ForeignKey("product_families.family_id"),
        nullable=False,
    )
    unit_price = Column(Numeric(12, 2), nullable=False)
    unit_cost = Column(Numeric(12, 2), nullable=True)
    reorder_level = Column(Integer, nullable=False)
    safety_stock = Column(Integer, nullable=False)


class Dataset(Base):
    __tablename__ = "datasets"

    __table_args__ = (
        CheckConstraint(
            "cleaning_status IN "
            "(N'Pending', N'Completed', N'Not started')",
            name="CK_datasets_cleaning_status",
        ),
        CheckConstraint(
            "(cleaning_status = N'Completed' "
            "AND cleaned_at IS NOT NULL AND cleaned_by IS NOT NULL) "
            "OR (cleaning_status <> N'Completed' "
            "AND cleaned_at IS NULL AND cleaned_by IS NULL)",
            name="CK_datasets_cleaned",
        ),
        Index("IX_datasets_uploaded_by", "uploaded_by"),
    )

    dataset_id = Column(NVARCHAR(20), primary_key=True)
    file_name = Column(NVARCHAR(260), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), nullable=False)
    uploaded_by = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=False
    )
    cleaning_status = Column(
        NVARCHAR(20), nullable=False, default="Pending"
    )
    cleaned_at = Column(DateTime(timezone=True), nullable=True)
    cleaned_by = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=True
    )


class SalesRecord(Base):
    __tablename__ = "sales_records"

    __table_args__ = (
        UniqueConstraint(
            "sale_date", "sku", "region",
            name="UQ_sales_records_day_sku_region",
        ),
        CheckConstraint("units > 0", name="CK_sales_records_units"),
        CheckConstraint(
            "unit_price >= 0", name="CK_sales_records_price"
        ),
        CheckConstraint(
            "discount_rate >= 0 AND discount_rate <= 1",
            name="CK_sales_records_discount",
        ),
        CheckConstraint(
            "record_status IN (N'Cleaned', N'Pending')",
            name="CK_sales_records_status",
        ),
        Index(
            "IX_sales_records_sku_date",
            "sku",
            "sale_date",
            mssql_include=[
                "region", "units", "unit_price", "discount_rate"
            ],
        ),
        Index("IX_sales_records_dataset", "dataset_id"),
        Index("IX_sales_records_region", "region", "sale_date"),
    )

    sale_id = Column(NVARCHAR(20), primary_key=True)
    sale_date = Column(Date, nullable=False)
    sku = Column(
        NVARCHAR(20), ForeignKey("products.sku"), nullable=False
    )
    region = Column(NVARCHAR(50), nullable=False)
    units = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 2), nullable=False)
    discount_rate = Column(
        Numeric(6, 4), nullable=False, default=0
    )
    record_status = Column(
        NVARCHAR(20), nullable=False, default="Pending"
    )
    dataset_id = Column(
        NVARCHAR(20), ForeignKey("datasets.dataset_id"), nullable=False
    )


class Inventory(Base):
    __tablename__ = "inventory"

    __table_args__ = (
        CheckConstraint(
            "stock >= 0 AND demand_30d >= 0",
            name="CK_inventory_stock",
        ),
        CheckConstraint(
            "status IN (N'Safe', N'Warning', N'Critical')",
            name="CK_inventory_status",
        ),
        Index(
            "IX_inventory_snapshot_date",
            "snapshot_date",
            mssql_include=["sku", "stock", "status"],
        ),
    )

    sku = Column(
        NVARCHAR(20), ForeignKey("products.sku"), primary_key=True
    )
    snapshot_date = Column(Date, primary_key=True)
    stock = Column(Integer, nullable=False)
    demand_30d = Column(Integer, nullable=False)
    status = Column(NVARCHAR(20), nullable=False)


class Forecast(Base):
    __tablename__ = "forecast"

    __table_args__ = (
        CheckConstraint(
            "model IN "
            "(N'Moving Average', N'Linear Regression', N'ARIMA')",
            name="CK_forecast_model",
        ),
        CheckConstraint(
            "horizon_days > 0", name="CK_forecast_horizon"
        ),
        CheckConstraint(
            "history_start <= history_end "
            "AND forecast_date > history_end",
            name="CK_forecast_history",
        ),
        CheckConstraint(
            "predicted_units >= 0", name="CK_forecast_units"
        ),
        Index(
            "IX_forecast_sku_model",
            "sku",
            "model",
            "horizon_days",
            mssql_include=[
                "forecast_id", "forecast_date", "predicted_units"
            ],
        ),
        Index("IX_forecast_generated_at", "generated_at"),
    )

    forecast_id = Column(NVARCHAR(20), primary_key=True)
    forecast_date = Column(Date, primary_key=True)
    sku = Column(
        NVARCHAR(20), ForeignKey("products.sku"), nullable=False
    )
    model = Column(NVARCHAR(30), nullable=False)
    horizon_days = Column(SmallInteger, nullable=False)
    history_start = Column(Date, nullable=False)
    history_end = Column(Date, nullable=False)
    predicted_units = Column(Integer, nullable=False)
    mae = Column(Float, nullable=True)
    rmse = Column(Float, nullable=True)
    mape = Column(Float, nullable=True)
    generated_at = Column(DateTime(timezone=True), nullable=False)
    generated_by = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=False
    )


class Reorder(Base):
    __tablename__ = "reorders"

    __table_args__ = (
        CheckConstraint(
            "quantity > 0", name="CK_reorders_quantity"
        ),
        CheckConstraint(
            "status IN (N'Ordered', N'Delivered')",
            name="CK_reorders_status",
        ),
        CheckConstraint(
            "(status = N'Delivered' AND delivered_at IS NOT NULL "
            "AND delivered_at >= ordered_at) "
            "OR (status = N'Ordered' AND delivered_at IS NULL)",
            name="CK_reorders_delivery",
        ),
        Index("IX_reorders_sku", "sku", "ordered_at"),
    )

    reorder_id = Column(NVARCHAR(20), primary_key=True)
    sku = Column(
        NVARCHAR(20), ForeignKey("products.sku"), nullable=False
    )
    quantity = Column(Integer, nullable=False)
    supplier = Column(NVARCHAR(150), nullable=True)
    status = Column(NVARCHAR(20), nullable=False, default="Ordered")
    ordered_at = Column(DateTime(timezone=True), nullable=False)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    ordered_by = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=False
    )


class Report(Base):
    __tablename__ = "reports"

    __table_args__ = (
        CheckConstraint(
            "file_format IN (N'PDF', N'XLSX', N'CSV')",
            name="CK_reports_format",
        ),
        CheckConstraint(
            "status IN (N'Completed', N'Failed', N'Processing')",
            name="CK_reports_status",
        ),
        CheckConstraint(
            "filters IS NULL OR ISJSON(filters) = 1",
            name="CK_reports_filters",
        ),
        Index("IX_reports_type", "report_type_id"),
        Index("IX_reports_user", "user_id", "generated_at"),
    )

    report_id = Column(NVARCHAR(20), primary_key=True)
    report_type_id = Column(SmallInteger, nullable=False)
    user_id = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=False
    )
    file_format = Column(NVARCHAR(10), nullable=False)
    generated_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(NVARCHAR(20), nullable=False, default="Processing")
    filters = Column(Text, nullable=True)


class ActivityLog(Base):
    __tablename__ = "activity_log"

    __table_args__ = (
        CheckConstraint(
            "status IN (N'Completed', N'Failed', N'Pending')",
            name="CK_activity_log_status",
        ),
        Index("IX_activity_log_timestamp", "timestamp"),
        Index("IX_activity_log_user", "user_id", "timestamp"),
        Index("IX_activity_log_screen", "screen_id", "timestamp"),
    )

    activity_id = Column(NVARCHAR(20), primary_key=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    user_id = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=True
    )
    role_id = Column(
        SmallInteger, ForeignKey("roles.role_id"), nullable=True
    )
    screen_id = Column(
        NVARCHAR(10), ForeignKey("screens.screen_id"), nullable=False
    )
    action = Column(NVARCHAR(150), nullable=False)
    reference_id = Column(NVARCHAR(50), nullable=True)
    details = Column(Text, nullable=True)
    status = Column(NVARCHAR(20), nullable=False, default="Completed")


class ErrorLog(Base):
    __tablename__ = "error_log"

    __table_args__ = (
        CheckConstraint(
            "status IN (N'Open', N'Investigating', N'Resolved')",
            name="CK_error_log_status",
        ),
        Index("IX_error_log_timestamp", "timestamp"),
        Index("IX_error_log_status", "status"),
    )

    error_id = Column(NVARCHAR(20), primary_key=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    user_id = Column(
        NVARCHAR(20), ForeignKey("users.user_id"), nullable=True
    )
    role_id = Column(
        SmallInteger, ForeignKey("roles.role_id"), nullable=True
    )
    screen_id = Column(
        NVARCHAR(10), ForeignKey("screens.screen_id"), nullable=False
    )
    error_type = Column(NVARCHAR(100), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(NVARCHAR(20), nullable=False, default="Open")


ALL_TABLES = [table.name for table in Base.metadata.sorted_tables]