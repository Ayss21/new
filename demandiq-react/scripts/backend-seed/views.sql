-- GET /inventory: each product with its stock, status, suggested order and days of cover, worked out like
-- deriveInventory in src/lib/domain.js. GET /inventory/alerts lists the rows that aren't Safe.
CREATE VIEW inventory_view AS
SELECT p.sku,
       p.name,
       c.name AS category,
       p.location,
       p.region,
       p.channel,
       p.unit_price,
       p.unit_cost,
       p.reorder_level,
       p.safety_stock,
       i.stock,
       i.demand_30d,
       s.status,
       CASE WHEN s.status = 'Safe' THEN 0
            ELSE greatest(0, i.demand_30d + p.safety_stock - i.stock)
       END AS suggested,
       greatest(1, round(i.stock * 30.0 / i.demand_30d))::integer AS days_of_cover,
       p.position
FROM products p
JOIN categories c ON c.category_id = p.category_id
JOIN inventory i ON i.sku = p.sku
CROSS JOIN LATERAL (
  SELECT CASE WHEN i.stock <= p.safety_stock * 1.15 THEN 'Critical'
              WHEN i.stock < p.reorder_level THEN 'Warning'
              ELSE 'Safe'
         END AS status
) s;

-- GET /categories: each category with how many products it has (counted, not stored).
CREATE VIEW category_view AS
SELECT c.category_id,
       c.name,
       c.description,
       c.status,
       (SELECT count(*) FROM products p WHERE p.category_id = c.category_id)::integer AS products
FROM categories c;

-- GET /sales: each sales record with its product's category, location, region and channel.
CREATE VIEW sales_view AS
SELECT s.sale_id,
       s.sale_date,
       s.sku,
       c.name AS category,
       p.location,
       p.region,
       p.channel,
       s.units,
       s.unit_price,
       s.discount_rate,
       s.net_revenue,
       s.dataset_id
FROM sales_records s
JOIN products p ON p.sku = s.sku
JOIN categories c ON c.category_id = p.category_id;

-- GET /datasets: each upload with its validation label, record and pending counts, cleaning summary, and
-- its forecasting status and lineage, worked out from the saved runs' lineage product by product like
-- src/lib/lineage.js.
CREATE VIEW dataset_view AS
WITH history AS (
  -- Its records in the sales history now, and their products
  SELECT dataset_id, count(*)::integer AS records, array_agg(DISTINCT sku) AS skus
  FROM sales_records
  WHERE dataset_id IS NOT NULL
  GROUP BY dataset_id
),
forecast_use AS (
  -- The saved runs that used its records (newest first), their products, and when the first one ran
  SELECT s.dataset_id,
         array_agg(DISTINCT r.sku) AS skus,
         array_agg(r.forecast_id ORDER BY r.generated_at DESC, r.forecast_id DESC) AS forecast_ids,
         min(r.generated_at) AS first_run_at
  FROM forecast_sources s
  JOIN forecast_runs r ON r.forecast_id = s.forecast_id
  WHERE s.kind = 'used' AND s.dataset_id IS NOT NULL
  GROUP BY s.dataset_id
),
pending AS (
  SELECT dataset_id, count(*)::integer AS records
  FROM dataset_pending_records
  GROUP BY dataset_id
)
SELECT d.dataset_id,
       d.file_name,
       d.uploaded_at,
       d.uploaded_by,
       uploader.name AS uploader,
       v.validation,
       CASE WHEN v.validation = 'Failed' THEN 0 ELSE d.valid_rows END AS record_count,
       d.total_rows,
       d.valid_rows,
       d.combined_rows,
       d.missing_rows,
       d.duplicate_rows,
       d.invalid_date_rows,
       d.invalid_numeric_rows,
       d.coverage_first_date,
       d.coverage_last_date,
       d.coverage_products,
       d.cleaning,
       d.cleaned_at,
       d.cleaned_by,
       cleaner.name AS cleaned_by_name,
       CASE WHEN d.cleaning = 'Completed' THEN d.valid_rows END AS input_records,
       CASE WHEN d.cleaning = 'Completed' THEN d.total_rows - d.valid_rows - d.combined_rows END AS excluded_at_validation,
       d.outliers_capped,
       d.records_replaced,
       d.records_skipped,
       d.records_added,
       coalesce(pending.records, 0) AS pending_count,
       f.forecasting,
       forecast_use.first_run_at AS forecasted_at,
       coalesce(history.records, 0) AS records_in_history,
       l.skus,
       l.forecasted_skus,
       coalesce(forecast_use.forecast_ids, '{}'::text[]) AS forecast_ids,
       -- The products this upload added to the catalog (newProducts)
       ARRAY(SELECT np.sku FROM products np WHERE np.added_from = d.dataset_id ORDER BY np.position) AS new_products,
       d.error
FROM datasets d
JOIN users uploader ON uploader.user_id = d.uploaded_by
LEFT JOIN users cleaner ON cleaner.user_id = d.cleaned_by
LEFT JOIN history ON history.dataset_id = d.dataset_id
LEFT JOIN forecast_use ON forecast_use.dataset_id = d.dataset_id
LEFT JOIN pending ON pending.dataset_id = d.dataset_id
CROSS JOIN LATERAL (
  SELECT CASE WHEN d.error IS NOT NULL OR d.valid_rows = 0 THEN 'Failed'
              WHEN w.warnings = 0 THEN 'Valid'
              WHEN w.warnings = 1 THEN '1 warning'
              ELSE w.warnings || ' warnings'
         END AS validation
  FROM (SELECT d.missing_rows + d.duplicate_rows + d.invalid_date_rows + d.invalid_numeric_rows AS warnings) w
) v
CROSS JOIN LATERAL (
  -- Its products: those it still has in the history, plus any already forecast with its records
  SELECT ARRAY(SELECT DISTINCT u.sku COLLATE "C" FROM unnest(coalesce(history.skus, '{}') || coalesce(forecast_use.skus, '{}')) AS u(sku) ORDER BY 1) AS skus,
         ARRAY(SELECT DISTINCT u.sku COLLATE "C" FROM unnest(coalesce(forecast_use.skus, '{}')) AS u(sku) ORDER BY 1) AS forecasted_skus
) l
CROSS JOIN LATERAL (
  SELECT CASE WHEN v.validation = 'Failed' THEN 'Not started'
              WHEN d.cleaning <> 'Completed' THEN 'Pending'
              WHEN cardinality(l.skus) = 0 THEN 'Not needed'
              WHEN cardinality(l.forecasted_skus) = 0 THEN 'Pending'
              WHEN cardinality(l.forecasted_skus) >= cardinality(l.skus) THEN 'Completed'
              ELSE 'Partial'
         END AS forecasting
) f;

-- GET /forecasts: each saved run with its configuration as the API sends it, how many sales records it
-- used and who ran it. Its points are in forecast_points and its lineage in forecast_sources.
CREATE VIEW forecast_run_view AS
SELECT r.forecast_id,
       r.sku,
       r.model,
       r.horizon,
       r.start_date,
       r.end_date,
       jsonb_strip_nulls(jsonb_build_object(
         'horizon', r.horizon,
         'windowSize', r.window_size,
         'slope', r.slope,
         'order', CASE WHEN r.model = 'ARIMA' THEN jsonb_build_array(r.arima_p, r.arima_d, r.arima_q) END
       )) AS configuration,
       r.mae,
       r.rmse,
       r.mape,
       r.holdout_days,
       coalesce(used.records, 0) AS history_records,
       r.generated_at,
       r.generated_by,
       u.name AS generated_by_name
FROM forecast_runs r
JOIN users u ON u.user_id = r.generated_by
LEFT JOIN (
  SELECT forecast_id, sum(records)::integer AS records
  FROM forecast_sources
  WHERE kind = 'used'
  GROUP BY forecast_id
) used ON used.forecast_id = r.forecast_id;

-- POST /auth/login and GET /auth/me (permissions): what each role may do now. Its level in the matrix, or
-- No when the role can't open the screen where the action is carried out.
CREATE VIEW effective_permissions AS
SELECT rp.role_id,
       rp.action,
       CASE WHEN rs.screen_id IS NULL THEN 'No' ELSE rp.level END AS level,
       a.position
FROM role_permissions rp
JOIN permission_actions a ON a.action = rp.action
LEFT JOIN role_screens rs ON rs.role_id = rp.role_id AND rs.screen_id = a.screen_id;
