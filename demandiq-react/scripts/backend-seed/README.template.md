# DemandIQ backend seed

Everything the DemandIQ app shows in demo mode, as a PostgreSQL database for the FastAPI backend: the
same users, sales history, uploads, forecasts, inventory, reorders, reports and logs, with the same IDs and
values. Load it, point FastAPI at it, switch the app to live mode, and every screen should show what it
shows in demo mode.

These files are **generated** from the demo backend's data (`src/data/seed.js`) by `npm run export:seed`.
Don't edit them by hand: change the seed and export again, so the app and the database never disagree.

## Files

| File | What it is |
|---|---|
| `schema.sql` | {{TABLE_COUNT}} tables with keys, foreign keys and checks, ID sequences, column comments and {{VIEW_COUNT}} views. PostgreSQL 12 or later |
| `seed.sql` | All {{TOTAL_ROWS}} rows in load order. Hashes the demo passwords with bcrypt (the `pgcrypto` extension) |
| `csv/` | One CSV file per table, the same rows (for another database, a spreadsheet or a loader script) |
| `json/` | The same rows as JSON arrays |
| `manifest.json` | The tables in load order, with primary keys, references and row counts |
| `DATA_DICTIONARY.md` | Every column: type, key, the API field it becomes, and what it holds |

## Load it into PostgreSQL

Any PostgreSQL 12 or later works; `pgcrypto` comes with the standard installers.

**psql** (Windows, macOS, Linux), from this folder:

```bash
createdb -U postgres demandiq
psql -U postgres -d demandiq -v ON_ERROR_STOP=1 -f schema.sql -f seed.sql
```

On Windows, psql and createdb are in the PostgreSQL `bin` folder (for example
`C:\Program Files\PostgreSQL\16\bin`); use the full path if that folder isn't on your PATH.

**pgAdmin**: create a database named `demandiq`, open the Query Tool on it, open `schema.sql` and run it
(F5), then do the same with `seed.sql`.

**Docker**, from this folder (PowerShell, bash or zsh) — the container runs `schema.sql` and then
`seed.sql` the first time it starts:

```bash
docker run --name demandiq-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=demandiq -p 5432:5432 -v "${PWD}:/docker-entrypoint-initdb.d" postgres:16
```

Each file runs as one transaction, so a failure changes nothing. Running `schema.sql` again drops the
DemandIQ tables and views (only those) and creates them empty; run `seed.sql` after it to reload the data.

Check that it loaded:

```sql
SELECT sku, stock, status, suggested, days_of_cover FROM inventory_view ORDER BY position;
SELECT dataset_id, file_name, validation, cleaning, forecasting FROM dataset_view ORDER BY uploaded_at DESC;
```

The first should show 11 products (PE-7820 Critical, 184 in stock); the second, seven uploads with
DS-0002 to DS-0005 Completed, DS-0007 waiting for cleaning and two rejected files.

## Connect FastAPI and the app

1. FastAPI connects with, for example, `postgresql://postgres:postgres@localhost:5432/demandiq`
   (`postgresql+psycopg://…` for SQLAlchemy with psycopg 3).
2. Build the endpoints in `docs/API_CONTRACT.md` on these tables. The views give the calculated fields, so
   the list endpoints are mostly a `SELECT` from one view (next section).
3. Point the app at FastAPI: create `.env.local` next to `package.json` with `VITE_API_MODE=live`, then
   restart `npm run dev` (contract, section 11). Sign in with the demo accounts below.

If you use SQLAlchemy, you can generate models from the loaded database
(`pip install sqlacodegen`, then `sqlacodegen postgresql://…/demandiq`), or treat `schema.sql` as your first
Alembic migration.

## Tables

{{TABLE_SUMMARY}}

`DATA_DICTIONARY.md` lists every column.

## Views: the calculated values

Values the app shows that come from other data aren't stored — they're worked out by these views, with the
same rules as the demo backend, so they can't go out of date:

{{VIEWS}}

## From rows to the API's JSON

| Endpoint | Read from |
|---|---|
| `GET /inventory`, `/inventory/alerts` | `inventory_view` (alerts: `status <> 'Safe'`) |
| `GET /categories` | `category_view` |
| `GET /sales` | `sales_view` |
| `GET /datasets` | `dataset_view` |
| `GET /forecasts`, `/forecasts/{id}` | `forecast_run_view`, with `forecast_points` (points) and `forecast_sources` (lineage) |
| `POST /auth/login`, `GET /auth/me` | `users`; `permissions` from `effective_permissions`, `screens` from `role_screens` |
| `GET /roles/permissions` | `role_permissions` — the matrix as the Admin set it, not the effective levels |
| `GET /reports`, `/reorders`, `/inventory/snapshots` | `reports`, `reorders`, `inventory_snapshots` + `inventory_snapshot_items` |
| `GET /activity`, `/sessions`, `/errors` | `activity_log`, `sessions`, `error_log` |

- **Names**: columns are snake_case, the API is camelCase, and a row's own key is `id` in the API
  (`dataset_id` → `id`). Fields with other names — `reorder_level` → `reorder`, `demand_30d` → `demand`,
  `days_of_cover` → `days`, the nested `checks`, `coverage`, `cleaningSummary`, `metrics`, `lineage` … — are
  listed in the data dictionary's "API field" column.
- **People's names** in API rows (`uploader`, `userName`, `generatedBy.name`, `cleaningSummary.cleanedBy`)
  come from `users`. The audit table `activity_log` keeps the name and role as they were at the time
  instead.
- **Categories**: products refer to their category by `category_id`; the API sends the category's name.
- **IDs** are stored as the app shows them (USR-1042, DS-0007, FC-0011). New rows get the next ID in the
  same format from a sequence: {{NEXT_IDS}}.
- **Times** are `TIMESTAMPTZ`; send them as ISO 8601 (`2025-06-24T02:22:00Z`) and the app shows them in the
  viewer's time zone. Dates are `YYYY-MM-DD`.
- **Numbers**: `NUMERIC` columns reach Python as `Decimal`, which Pydantic 2 writes as a JSON *string*
  (`"248.00"`). The app expects numbers, so declare those response fields as `float`.
- **Order**: logs, histories, uploads, runs, reports and reorders are newest first (by their timestamp);
  products follow `products.position`. The app sorts and filters the rest itself.

## Demo accounts

{{ACCOUNTS}}

The passwords are the demo's public ones (the sign-in page shows them). seed.sql stores bcrypt hashes
(`$2a$`, cost 10); Python's `bcrypt.checkpw` and passlib verify them. Never use these accounts outside
development.

## Good to know

1. **Times are for {{TIME_ZONE}}.** The demo's times are wall-clock times — Layla signs in at 07:52 on
   24 June 2025. This export stores them in {{TIME_ZONE}}, so the app shows 07:52 to someone in that time
   zone. For another one, export again with `npm run export:seed -- --tz Asia/Riyadh` (any IANA name).
2. **30-day demand is a starting estimate.** `inventory.demand_30d` holds the demo's starting values; the
   seeded forecasts didn't produce them. In the app, saving a forecast replaces the product's value with
   `max(1, round(average predicted units per day × 30))`. They're kept as they are because the demo shows
   them and the seeded reorders (FE-1094 × 810, PE-7820 × 796) were sized from them. To start from
   the newest seeded forecast of each product instead, run this after loading. Most products then get a
   much higher demand (they sell more than the starting estimates), so suggested orders grow and days of
   cover drop — and the Inventory screen no longer matches the demo's:

   ```sql
   UPDATE inventory i
   SET demand_30d = greatest(1, round(newest.per_day * 30))
   FROM (
     SELECT DISTINCT ON (r.sku) r.sku,
            (SELECT avg(p.predicted) FROM forecast_points p WHERE p.forecast_id = r.forecast_id) AS per_day
     FROM forecast_runs r
     ORDER BY r.sku, r.generated_at DESC
   ) newest
   WHERE newest.sku = i.sku AND newest.per_day IS NOT NULL;
   ```

3. **{{PROCESSING_COUNT}} reports are still Processing** ({{PROCESSING_REPORTS}}), as in the demo, and no job is
   working on them. Leave them, or mark them Failed when the server starts.
4. **Sessions**: the seeded sessions have all ended. Store a SHA-256 hash of each new token in
   `sessions.token_hash`, never the token itself.
5. **Reorders are Ordered, then Delivered.** `POST /reorders` stores an order as Ordered with `ordered_at`
   and `ordered_by`; Mark delivered (`PATCH /reorders/{id}` with `{"status": "Delivered"}`) sets
   `delivered_at` and adds the quantity to `inventory.stock` and the current month's snapshot row. There is
   no Requested step. RO-0002 and RO-0003 are seeded as Ordered, RO-0001 as Delivered.
6. **Uploads can add products.** A sales file of any layout is read by its column names (contract, section
   6.3). Products it names that aren't in `products` are added at upload — with `added_from` set to the
   dataset, `unit_cost` NULL, stock from the file's stock column on its last day (else 0), and reorder level
   and safety stock from their sales in the file — along with their category when it's new, an `inventory`
   row and a row in the current month's snapshot. Rows for the same product and day are added up and
   counted in `datasets.combined_rows`; `dataset_view.new_products` lists what an upload added.
7. **New users get their ID and email from the server.** `POST /users` takes the name, department, role,
   status and password; the employee ID is `USR-` and one more than the highest number in use (USR-3382
   after this seed), the email `first.last@` the Admin's domain (`sara.khalid@demo.demandiq`).
8. **The Admin only views** Sales Data, Inventory and Forecasting: `role_permissions` keeps the Admin at
   Review (Upload sales) and View (Clean data, Run forecasts, Update inventory), and a check constraint stops
   anything else.
9. **Not stored by the demo** (add tables if you need them): a history of stock adjustments (only the
   activity log records who changed stock and why), emailed reports (`POST /reports/email`), and generated
   report files (the demo builds a file when it is downloaded).
10. **Kept in step with the app**: report types, the permission actions and the screens are also in the
   app's code (`src/data/seed.js`, `src/navigation.js`); if you change them here, change them there.

## Loading the CSV or JSON files instead

Use these for another database, or a loader script. Load the tables in the order of `manifest.json` (each
refers only to tables before it).

- CSV: a header row of column names; an empty cell is NULL and `""` is empty text; `TEXT[]` values look
  like `{Yes,Review,No}`; `JSONB` values are JSON text. UTF-8.
- `users` has a `password` column with the demo password instead of `password_hash`: hash it (bcrypt)
  when you load it.
- Then move the ID sequences past the seeded IDs: the `SELECT setval(…)` lines at the end of `seed.sql`.

In PostgreSQL, for example (after `schema.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\copy roles FROM 'csv/roles.csv' WITH (FORMAT csv, HEADER true)
-- … every table in manifest order; users through a staging table:
CREATE TEMP TABLE users_csv (LIKE users);
ALTER TABLE users_csv RENAME COLUMN password_hash TO password;
\copy users_csv FROM 'csv/users.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO users
SELECT user_id, name, email, crypt(password, gen_salt('bf', 10)), role_id, initials, department, status
FROM users_csv;
```

In Python:

```python
import json
import bcrypt

manifest = json.load(open("manifest.json", encoding="utf-8"))
for table in manifest["tables"]:
    rows = json.load(open(table["json"], encoding="utf-8"))
    if table["name"] == "users":
        for row in rows:
            row["password_hash"] = bcrypt.hashpw(row.pop("password").encode(), bcrypt.gensalt()).decode()
    # insert rows into table["name"] with your database library, in this order
```

## Regenerate

After a change to `src/data/seed.js` or to the tables, from the project folder:

```bash
npm run export:seed                        # times in Asia/Kolkata
npm run export:seed -- --tz Asia/Riyadh    # times in another time zone
```

The export is in `scripts/backend-seed/`: `tables.js` (tables and rows), `views.sql`, `writers.js` (SQL,
CSV, JSON and these documents) and `export.mjs`. `npm test` checks that every key is unique and every
reference points at a row that exists.
