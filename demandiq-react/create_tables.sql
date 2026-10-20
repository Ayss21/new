/* =====================================================================================
   DemandIQ - create_tables.sql                                       (SQL Server / SSMS)
   Database : [B1A-S6-T3]  (already exists - this script does NOT create it)
   Schema   : DemandIQ ER diagram v3 - 17 tables, fact-constellation design
              (shared dimensions: products / SKU, users, roles, screens)

   RUN THIS SCRIPT FIRST, then seed_data.sql.

   Re-runnable: Section 0 drops the 17 DemandIQ tables (children first) if they exist.
   It touches ONLY these 17 tables. Remove Section 0 if you never want tables dropped.

   Type mapping used for the ER diagram's generic types
     TEXT        -> NVARCHAR(n)  (keys must be bounded to be indexed; long free text = NVARCHAR(MAX))
     SMALLINT    -> SMALLINT
     INTEGER     -> INT
     NUMERIC(p,s)-> DECIMAL(p,s)
     DOUBLE      -> FLOAT
     DATE        -> DATE
     TIMESTAMPTZ -> DATETIMEOFFSET(0)
     JSONB       -> NVARCHAR(MAX) + CHECK (ISJSON(...) = 1)
   ===================================================================================== */
USE [B1A-S6-T3];
GO

SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------------------
   0. Clean re-run: drop the DemandIQ tables, children before parents
   --------------------------------------------------------------------------------- */
DROP TABLE IF EXISTS dbo.error_log;
DROP TABLE IF EXISTS dbo.activity_log;
DROP TABLE IF EXISTS dbo.reports;
DROP TABLE IF EXISTS dbo.reorders;
DROP TABLE IF EXISTS dbo.forecast;
DROP TABLE IF EXISTS dbo.inventory;
DROP TABLE IF EXISTS dbo.sales_records;
DROP TABLE IF EXISTS dbo.datasets;
DROP TABLE IF EXISTS dbo.products;
DROP TABLE IF EXISTS dbo.product_families;
DROP TABLE IF EXISTS dbo.sessions;
DROP TABLE IF EXISTS dbo.users;
DROP TABLE IF EXISTS dbo.role_report_types;
DROP TABLE IF EXISTS dbo.role_permissions;
DROP TABLE IF EXISTS dbo.role_screens;
DROP TABLE IF EXISTS dbo.screens;
DROP TABLE IF EXISTS dbo.roles;
GO

/* =================================================================================
   ACCESS CONTROL
   ================================================================================= */

-- 1. roles <<DIM>> -------------------------------------------------------------------
CREATE TABLE dbo.roles (
    role_id     SMALLINT      NOT NULL,
    role_name   NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_roles PRIMARY KEY (role_id),
    CONSTRAINT UQ_roles_role_name UNIQUE (role_name)
);
GO

-- 2. screens <<DIM>> -----------------------------------------------------------------
CREATE TABLE dbo.screens (
    screen_id   NVARCHAR(10)  NOT NULL,
    screen_name NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_screens PRIMARY KEY (screen_id),
    CONSTRAINT UQ_screens_screen_name UNIQUE (screen_name)
);
GO

-- 3. role_screens <<BRIDGE>>  (roles M:N screens) -------------------------------------
CREATE TABLE dbo.role_screens (
    role_id     SMALLINT      NOT NULL,
    screen_id   NVARCHAR(10)  NOT NULL,
    CONSTRAINT PK_role_screens PRIMARY KEY (role_id, screen_id),
    CONSTRAINT FK_role_screens_roles   FOREIGN KEY (role_id)   REFERENCES dbo.roles (role_id),
    CONSTRAINT FK_role_screens_screens FOREIGN KEY (screen_id) REFERENCES dbo.screens (screen_id)
);
GO

-- 4. role_permissions <<BRIDGE>>  (roles M:N actions; each action belongs to a screen) -
CREATE TABLE dbo.role_permissions (
    role_id      SMALLINT      NOT NULL,
    action       NVARCHAR(50)  NOT NULL,
    screen_id    NVARCHAR(10)  NOT NULL,
    access_level NVARCHAR(20)  NOT NULL,
    CONSTRAINT PK_role_permissions PRIMARY KEY (role_id, action),
    CONSTRAINT FK_role_permissions_roles   FOREIGN KEY (role_id)   REFERENCES dbo.roles (role_id),
    CONSTRAINT FK_role_permissions_screens FOREIGN KEY (screen_id) REFERENCES dbo.screens (screen_id),
    CONSTRAINT CK_role_permissions_access_level CHECK (access_level IN (N'Yes', N'View', N'Review', N'No'))
);
GO

-- 5. role_report_types <<BRIDGE>>  (roles M:N report types + the report's details) ----
--    report_type_id identifies a report type (1..10). The same type appears once per
--    role that may generate it, so reports.report_type_id is matched to this table by
--    report_type_id (+ the generating user's role_id) - see EXECUTION_GUIDE.md, note 1.
CREATE TABLE dbo.role_report_types (
    role_id        SMALLINT      NOT NULL,
    report_type_id SMALLINT      NOT NULL,
    report_name    NVARCHAR(100) NOT NULL,
    description    NVARCHAR(255) NULL,
    CONSTRAINT PK_role_report_types PRIMARY KEY (role_id, report_type_id),
    CONSTRAINT FK_role_report_types_roles FOREIGN KEY (role_id) REFERENCES dbo.roles (role_id)
);
GO
CREATE INDEX IX_role_report_types_report_type ON dbo.role_report_types (report_type_id);
GO

/* =================================================================================
   USERS
   ================================================================================= */

-- 6. users <<DIM>> ---------------------------------------------------------------------
CREATE TABLE dbo.users (
    user_id       NVARCHAR(20)  NOT NULL,
    full_name     NVARCHAR(120) NOT NULL,
    email         NVARCHAR(255) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    role_id       SMALLINT      NOT NULL,
    department    NVARCHAR(100) NULL,
    status        NVARCHAR(30)  NOT NULL CONSTRAINT DF_users_status DEFAULT N'Active',
    CONSTRAINT PK_users PRIMARY KEY (user_id),
    CONSTRAINT UQ_users_email UNIQUE (email),
    CONSTRAINT FK_users_roles FOREIGN KEY (role_id) REFERENCES dbo.roles (role_id),
    CONSTRAINT CK_users_status CHECK (status IN (N'Active', N'Inactive', N'Pending activation'))
);
GO
CREATE INDEX IX_users_role_id ON dbo.users (role_id);
GO

-- 7. sessions <<FACT>> -----------------------------------------------------------------
CREATE TABLE dbo.sessions (
    session_id  NVARCHAR(20)       NOT NULL,
    user_id     NVARCHAR(20)       NOT NULL,
    login_at    DATETIMEOFFSET(0)  NOT NULL,
    logout_at   DATETIMEOFFSET(0)  NULL,
    expires_at  DATETIMEOFFSET(0)  NOT NULL,
    token_hash  NVARCHAR(128)      NOT NULL,
    CONSTRAINT PK_sessions PRIMARY KEY (session_id),
    CONSTRAINT UQ_sessions_token_hash UNIQUE (token_hash),
    CONSTRAINT FK_sessions_users FOREIGN KEY (user_id) REFERENCES dbo.users (user_id),
    CONSTRAINT CK_sessions_logout CHECK (logout_at IS NULL OR logout_at >= login_at),
    CONSTRAINT CK_sessions_expiry CHECK (expires_at >= login_at)
);
GO
CREATE INDEX IX_sessions_user_login ON dbo.sessions (user_id, login_at);
GO

/* =================================================================================
   PRODUCT MASTER
   ================================================================================= */

-- 8. product_families <<DIM>>  (the app's "product categories") -------------------------
CREATE TABLE dbo.product_families (
    family_id    NVARCHAR(20)  NOT NULL,
    family_name  NVARCHAR(100) NOT NULL,
    description  NVARCHAR(255) NULL,
    status       NVARCHAR(20)  NOT NULL CONSTRAINT DF_product_families_status DEFAULT N'Active',
    CONSTRAINT PK_product_families PRIMARY KEY (family_id),
    CONSTRAINT UQ_product_families_name UNIQUE (family_name),
    CONSTRAINT CK_product_families_status CHECK (status IN (N'Active', N'Inactive'))
);
GO

-- 9. products <<DIM>> --------------------------------------------------------------------
CREATE TABLE dbo.products (
    sku           NVARCHAR(20)   NOT NULL,
    product_name  NVARCHAR(150)  NOT NULL,
    family_id     NVARCHAR(20)   NOT NULL,
    unit_price    DECIMAL(12,2)  NOT NULL,
    unit_cost     DECIMAL(12,2)  NULL,      -- unknown for products first seen in an upload
    reorder_level INT            NOT NULL,
    safety_stock  INT            NOT NULL,
    CONSTRAINT PK_products PRIMARY KEY (sku),
    CONSTRAINT FK_products_product_families FOREIGN KEY (family_id) REFERENCES dbo.product_families (family_id),
    CONSTRAINT CK_products_prices   CHECK (unit_price >= 0 AND (unit_cost IS NULL OR unit_cost >= 0)),
    CONSTRAINT CK_products_levels   CHECK (safety_stock >= 0 AND reorder_level >= safety_stock)
);
GO
CREATE INDEX IX_products_family_id ON dbo.products (family_id);
GO

/* =================================================================================
   SALES DATA
   ================================================================================= */

-- 10. datasets <<DIM>>  (one row per uploaded sales file) --------------------------------
CREATE TABLE dbo.datasets (
    dataset_id      NVARCHAR(20)       NOT NULL,
    file_name       NVARCHAR(260)      NOT NULL,
    uploaded_at     DATETIMEOFFSET(0)  NOT NULL,
    uploaded_by     NVARCHAR(20)       NOT NULL,
    cleaning_status NVARCHAR(20)       NOT NULL CONSTRAINT DF_datasets_cleaning DEFAULT N'Pending',
    cleaned_at      DATETIMEOFFSET(0)  NULL,
    cleaned_by      NVARCHAR(20)       NULL,      -- optional FK (dashed line in the ER)
    CONSTRAINT PK_datasets PRIMARY KEY (dataset_id),
    CONSTRAINT FK_datasets_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES dbo.users (user_id),
    CONSTRAINT FK_datasets_cleaned_by  FOREIGN KEY (cleaned_by)  REFERENCES dbo.users (user_id),
    CONSTRAINT CK_datasets_cleaning_status CHECK (cleaning_status IN (N'Pending', N'Completed', N'Not started')),
    CONSTRAINT CK_datasets_cleaned CHECK (
        (cleaning_status = N'Completed' AND cleaned_at IS NOT NULL AND cleaned_by IS NOT NULL)
        OR (cleaning_status <> N'Completed' AND cleaned_at IS NULL AND cleaned_by IS NULL))
);
GO
CREATE INDEX IX_datasets_uploaded_by ON dbo.datasets (uploaded_by);
GO

-- 11. sales_records <<FACT>> ----------------------------------------------------------------
--     Net revenue is not stored: units * unit_price * (1 - discount_rate).
CREATE TABLE dbo.sales_records (
    sale_id        NVARCHAR(20)   NOT NULL,
    sale_date      DATE           NOT NULL,
    sku            NVARCHAR(20)   NOT NULL,
    region         NVARCHAR(50)   NOT NULL,
    units          INT            NOT NULL,
    unit_price     DECIMAL(12,2)  NOT NULL,
    discount_rate  DECIMAL(6,4)   NOT NULL CONSTRAINT DF_sales_records_discount DEFAULT 0,
    record_status  NVARCHAR(20)   NOT NULL CONSTRAINT DF_sales_records_status DEFAULT N'Pending',
    dataset_id     NVARCHAR(20)   NOT NULL,
    CONSTRAINT PK_sales_records PRIMARY KEY (sale_id),
    CONSTRAINT FK_sales_records_products FOREIGN KEY (sku)        REFERENCES dbo.products (sku),
    CONSTRAINT FK_sales_records_datasets FOREIGN KEY (dataset_id) REFERENCES dbo.datasets (dataset_id),
    CONSTRAINT UQ_sales_records_day_sku_region UNIQUE (sale_date, sku, region),
    CONSTRAINT CK_sales_records_units    CHECK (units > 0),
    CONSTRAINT CK_sales_records_price    CHECK (unit_price >= 0),
    CONSTRAINT CK_sales_records_discount CHECK (discount_rate >= 0 AND discount_rate <= 1),
    CONSTRAINT CK_sales_records_status   CHECK (record_status IN (N'Cleaned', N'Pending'))
);
GO
CREATE INDEX IX_sales_records_sku_date ON dbo.sales_records (sku, sale_date) INCLUDE (region, units, unit_price, discount_rate);
CREATE INDEX IX_sales_records_dataset  ON dbo.sales_records (dataset_id);
CREATE INDEX IX_sales_records_region   ON dbo.sales_records (region, sale_date);
GO

/* =================================================================================
   INVENTORY / FORECASTING / REORDERS
   ================================================================================= */

-- 12. inventory <<FACT>>  (one snapshot per SKU per day; composite key) --------------------
CREATE TABLE dbo.inventory (
    sku           NVARCHAR(20)  NOT NULL,
    snapshot_date DATE          NOT NULL,
    stock         INT           NOT NULL,
    demand_30d    INT           NOT NULL,
    status        NVARCHAR(20)  NOT NULL,
    CONSTRAINT PK_inventory PRIMARY KEY (sku, snapshot_date),
    CONSTRAINT FK_inventory_products FOREIGN KEY (sku) REFERENCES dbo.products (sku),
    CONSTRAINT CK_inventory_stock  CHECK (stock >= 0 AND demand_30d >= 0),
    CONSTRAINT CK_inventory_status CHECK (status IN (N'Safe', N'Warning', N'Critical'))
);
GO
CREATE INDEX IX_inventory_snapshot_date ON dbo.inventory (snapshot_date) INCLUDE (sku, stock, status);
GO

-- 13. forecast <<FACT>>  (one row per forecast run x predicted day; composite key) -----------
--     A "run" = one forecast_id. mae / rmse / mape describe the run and repeat on each of its
--     rows (as drawn in the ER). mape is NULL when the hold-out period contained a zero.
CREATE TABLE dbo.forecast (
    forecast_id     NVARCHAR(20)       NOT NULL,
    forecast_date   DATE               NOT NULL,
    sku             NVARCHAR(20)       NOT NULL,
    model           NVARCHAR(30)       NOT NULL,
    horizon_days    SMALLINT           NOT NULL,
    history_start   DATE               NOT NULL,
    history_end     DATE               NOT NULL,
    predicted_units INT                NOT NULL,
    mae             FLOAT              NULL,
    rmse            FLOAT              NULL,
    mape            FLOAT              NULL,
    generated_at    DATETIMEOFFSET(0)  NOT NULL,
    generated_by    NVARCHAR(20)       NOT NULL,
    CONSTRAINT PK_forecast PRIMARY KEY (forecast_id, forecast_date),
    CONSTRAINT FK_forecast_products FOREIGN KEY (sku)          REFERENCES dbo.products (sku),
    CONSTRAINT FK_forecast_users    FOREIGN KEY (generated_by) REFERENCES dbo.users (user_id),
    CONSTRAINT CK_forecast_model   CHECK (model IN (N'Moving Average', N'Linear Regression', N'ARIMA')),
    CONSTRAINT CK_forecast_horizon CHECK (horizon_days > 0),
    CONSTRAINT CK_forecast_history CHECK (history_start <= history_end AND forecast_date > history_end),
    CONSTRAINT CK_forecast_units   CHECK (predicted_units >= 0)
);
GO
CREATE INDEX IX_forecast_sku_model ON dbo.forecast (sku, model, horizon_days) INCLUDE (forecast_id, forecast_date, predicted_units);
CREATE INDEX IX_forecast_generated_at ON dbo.forecast (generated_at);
GO

-- 14. reorders <<FACT>> ----------------------------------------------------------------------
CREATE TABLE dbo.reorders (
    reorder_id   NVARCHAR(20)       NOT NULL,
    sku          NVARCHAR(20)       NOT NULL,
    quantity     INT                NOT NULL,
    supplier     NVARCHAR(150)      NULL,
    status       NVARCHAR(20)       NOT NULL CONSTRAINT DF_reorders_status DEFAULT N'Ordered',
    ordered_at   DATETIMEOFFSET(0)  NOT NULL,
    delivered_at DATETIMEOFFSET(0)  NULL,
    ordered_by   NVARCHAR(20)       NOT NULL,
    CONSTRAINT PK_reorders PRIMARY KEY (reorder_id),
    CONSTRAINT FK_reorders_products FOREIGN KEY (sku)        REFERENCES dbo.products (sku),
    CONSTRAINT FK_reorders_users    FOREIGN KEY (ordered_by) REFERENCES dbo.users (user_id),
    CONSTRAINT CK_reorders_quantity CHECK (quantity > 0),
    CONSTRAINT CK_reorders_status   CHECK (status IN (N'Ordered', N'Delivered')),
    CONSTRAINT CK_reorders_delivery CHECK (
        (status = N'Delivered' AND delivered_at IS NOT NULL AND delivered_at >= ordered_at)
        OR (status = N'Ordered' AND delivered_at IS NULL))
);
GO
CREATE INDEX IX_reorders_sku ON dbo.reorders (sku, ordered_at);
GO

/* =================================================================================
   REPORTS & EXPORTS
   ================================================================================= */

-- 15. reports <<FACT>> ---------------------------------------------------------------------
--     report_type_id is a logical reference to role_report_types (see note in section 5).
CREATE TABLE dbo.reports (
    report_id      NVARCHAR(20)       NOT NULL,
    report_type_id SMALLINT           NOT NULL,
    user_id        NVARCHAR(20)       NOT NULL,
    file_format    NVARCHAR(10)       NOT NULL,
    generated_at   DATETIMEOFFSET(0)  NOT NULL,
    status         NVARCHAR(20)       NOT NULL CONSTRAINT DF_reports_status DEFAULT N'Processing',
    filters        NVARCHAR(MAX)      NULL,
    CONSTRAINT PK_reports PRIMARY KEY (report_id),
    CONSTRAINT FK_reports_users FOREIGN KEY (user_id) REFERENCES dbo.users (user_id),
    CONSTRAINT CK_reports_format  CHECK (file_format IN (N'PDF', N'XLSX', N'CSV')),
    CONSTRAINT CK_reports_status  CHECK (status IN (N'Completed', N'Failed', N'Processing')),
    CONSTRAINT CK_reports_filters CHECK (filters IS NULL OR ISJSON(filters) = 1)
);
GO
CREATE INDEX IX_reports_type ON dbo.reports (report_type_id);
CREATE INDEX IX_reports_user ON dbo.reports (user_id, generated_at);
GO

/* =================================================================================
   MONITORING
   user_id / role_id are optional (dashed lines in the ER): a failed sign-in with an
   unknown account has neither. screen_id is mandatory (solid line).
   ================================================================================= */

-- 16. activity_log <<FACT>> -------------------------------------------------------------------
CREATE TABLE dbo.activity_log (
    activity_id  NVARCHAR(20)       NOT NULL,
    [timestamp]  DATETIMEOFFSET(0)  NOT NULL,
    user_id      NVARCHAR(20)       NULL,
    role_id      SMALLINT           NULL,
    screen_id    NVARCHAR(10)       NOT NULL,
    action       NVARCHAR(150)      NOT NULL,
    reference_id NVARCHAR(50)       NULL,
    details      NVARCHAR(MAX)      NULL,
    status       NVARCHAR(20)       NOT NULL CONSTRAINT DF_activity_log_status DEFAULT N'Completed',
    CONSTRAINT PK_activity_log PRIMARY KEY (activity_id),
    CONSTRAINT FK_activity_log_users   FOREIGN KEY (user_id)   REFERENCES dbo.users (user_id),
    CONSTRAINT FK_activity_log_roles   FOREIGN KEY (role_id)   REFERENCES dbo.roles (role_id),
    CONSTRAINT FK_activity_log_screens FOREIGN KEY (screen_id) REFERENCES dbo.screens (screen_id),
    CONSTRAINT CK_activity_log_status  CHECK (status IN (N'Completed', N'Failed', N'Pending'))
);
GO
CREATE INDEX IX_activity_log_timestamp ON dbo.activity_log ([timestamp] DESC);
CREATE INDEX IX_activity_log_user      ON dbo.activity_log (user_id, [timestamp]);
CREATE INDEX IX_activity_log_screen    ON dbo.activity_log (screen_id, [timestamp]);
GO

-- 17. error_log <<FACT>> ----------------------------------------------------------------------
CREATE TABLE dbo.error_log (
    error_id    NVARCHAR(20)       NOT NULL,
    [timestamp] DATETIMEOFFSET(0)  NOT NULL,
    user_id     NVARCHAR(20)       NULL,
    role_id     SMALLINT           NULL,
    screen_id   NVARCHAR(10)       NOT NULL,
    error_type  NVARCHAR(100)      NOT NULL,
    message     NVARCHAR(MAX)      NOT NULL,
    status      NVARCHAR(20)       NOT NULL CONSTRAINT DF_error_log_status DEFAULT N'Open',
    CONSTRAINT PK_error_log PRIMARY KEY (error_id),
    CONSTRAINT FK_error_log_users   FOREIGN KEY (user_id)   REFERENCES dbo.users (user_id),
    CONSTRAINT FK_error_log_roles   FOREIGN KEY (role_id)   REFERENCES dbo.roles (role_id),
    CONSTRAINT FK_error_log_screens FOREIGN KEY (screen_id) REFERENCES dbo.screens (screen_id),
    CONSTRAINT CK_error_log_status  CHECK (status IN (N'Open', N'Investigating', N'Resolved'))
);
GO
CREATE INDEX IX_error_log_timestamp ON dbo.error_log ([timestamp] DESC);
CREATE INDEX IX_error_log_status    ON dbo.error_log (status);
GO

PRINT 'DemandIQ: 17 tables created in [B1A-S6-T3].';
GO
