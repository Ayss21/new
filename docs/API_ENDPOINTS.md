# DemandIQ API — endpoints

FastAPI serves the API under **`/api`** on port 8000. With the backend running:

- **Swagger UI** (try every endpoint): <http://localhost:8000/docs> — sign in with `POST /api/auth/login`, copy the
  `accessToken`, click **Authorize** and paste it.
- **ReDoc**: <http://localhost:8000/redoc>
- **OpenAPI JSON**: <http://localhost:8000/api/openapi.json> (a copy is in `docs/openapi.json`)

Request and response bodies, status codes, error codes, permissions and business rules are specified with real JSON
examples in [`demandiq-react/docs/API_CONTRACT.md`](../demandiq-react/docs/API_CONTRACT.md) (version 1.3), which the
backend implements and `backend/tests` checks.

## Conventions

- JSON in camelCase; dates `YYYY-MM-DD`, months `YYYY-MM`, times ISO 8601 UTC with `Z`.
- `Authorization: Bearer <accessToken>` on every endpoint marked *Bearer*. Sessions last 8 hours, 7 days with
  `remember: true`; logout revokes the token.
- Global filters: `start`, `end` and the lists `category`, `sku`, `region`, `model`, `status`. GET: repeat the
  parameter (`?region=Central&region=East`); POST: a `filters` object with JSON arrays. Empty or missing = all.
- Errors: `{"detail": {"code": "forbidden", "message": "…", "fields": {…}}}` (codes in the contract, section 3).

## Permissions (effective level, checked on every request)

| Endpoints | Requirement |
|---|---|
| `POST /auth/login`, `GET /auth/roles`, `POST /auth/password-reset`, `GET /health` | Public |
| Reading data (`GET /sales`, `/datasets`, `/forecasts…`, `/inventory…`, `/reorders`, `/categories`, `/reports…`, `/dashboard/summary`) | Signed in |
| `POST /datasets` | Upload sales = Yes (Store Manager) |
| `POST /datasets/{id}/clean` | Clean data = Yes (Data Analyst) |
| `POST /forecasts`, `POST /forecasts/compare` | Run forecasts = Yes (Data Analyst) |
| `POST /forecasts/recommendation` | Run forecasts = Yes or View |
| `PATCH /inventory/{sku}`, `POST /reorders`, `PATCH /reorders/{id}` | Update inventory = Yes (Inventory Supervisor) |
| `/users…`, `POST`/`PATCH /categories…`, `/roles/…` | Manage users = Yes (Admin) |
| `POST /reports`, `POST /reports/email` | Generate reports = Yes and the report type is in the role's list |
| `GET /activity`, `GET /sessions`, `GET /errors`, `PATCH /errors/{id}` | View system logs = Yes (Admin) |

## Every endpoint

| Area | Method | Path | What it does | Auth |
|---|---|---|---|---|
| Authentication | `POST` | `/api/auth/login` | Sign in with the role picked on the sign-in page | Public |
| Authentication | `GET` | `/api/auth/me` | The signed-in user (checks a saved token after a refresh) | Bearer |
| Authentication | `POST` | `/api/auth/logout` | End the session (the token stops working) | Bearer |
| Authentication | `GET` | `/api/auth/roles` | Each role with the screens it can open (public) | Public |
| Authentication | `POST` | `/api/auth/password-reset` | Ask for reset instructions (always 202) | Public |
| Dashboard | `GET` | `/api/dashboard/summary` | KPI cards for the signed-in user's role | Bearer |
| Sales data | `GET` | `/api/sales` | Sales records (all, or those matching the global filters) | Bearer |
| Sales data | `GET` | `/api/datasets` | Every upload attempt, newest first, with its lineage | Bearer |
| Sales data | `POST` | `/api/datasets` | Upload a sales file of any layout (multipart field: file) | Bearer |
| Sales data | `POST` | `/api/datasets/{dataset_id}/clean` | Clean a Pending upload and merge it into the sales history | Bearer |
| Forecasting | `GET` | `/api/forecasts` | Saved runs, newest first | Bearer |
| Forecasting | `POST` | `/api/forecasts` | Run a model for one product and save the run | Bearer |
| Forecasting | `GET` | `/api/forecasts/lineage` | Which uploads a forecast with these settings would use | Bearer |
| Forecasting | `GET` | `/api/forecasts/{forecast_id}` | One saved run | Bearer |
| Forecasting | `POST` | `/api/forecasts/compare` | All three models on the same settings (nothing saved) | Bearer |
| Forecasting | `POST` | `/api/forecasts/recommendation` | Most accurate model for a group of products | Bearer |
| Inventory | `GET` | `/api/inventory` | Every product with its stock position | Bearer |
| Inventory | `GET` | `/api/inventory/alerts` | Products below their reorder level, most urgent first | Bearer |
| Inventory | `GET` | `/api/inventory/snapshots` | Month-end stock per product | Bearer |
| Inventory | `PATCH` | `/api/inventory/{sku}` | Set the stock after a count or adjustment | Bearer |
| Inventory | `GET` | `/api/reorders` | Every reorder, newest first | Bearer |
| Inventory | `POST` | `/api/reorders` | Place a reorder (status Ordered) | Bearer |
| Inventory | `PATCH` | `/api/reorders/{reorder_id}` | Mark delivered ({"status": "Delivered"}): adds the quantity to stock | Bearer |
| Administration | `GET` | `/api/users` | Every account (never with passwords) | Bearer |
| Administration | `POST` | `/api/users` | Create an account (the server gives the employee ID and work email) | Bearer |
| Administration | `PATCH` | `/api/users/{user_id}` | Change a user's name, email, department, role, status or password | Bearer |
| Administration | `GET` | `/api/categories` | Product categories with their product counts | Bearer |
| Administration | `POST` | `/api/categories` | Create a category | Bearer |
| Administration | `PATCH` | `/api/categories/{category_id}` | Rename, describe or (de)activate a category | Bearer |
| Administration | `GET` | `/api/roles/permissions` | The action permission matrix as the Admin set it | Bearer |
| Administration | `PATCH` | `/api/roles/permissions` | Change one cell of the matrix | Bearer |
| Administration | `GET` | `/api/roles/screens` | Role ID → the screen IDs it can open | Bearer |
| Administration | `PUT` | `/api/roles/{role_id}/screens` | Replace one role's screens | Bearer |
| Administration | `POST` | `/api/roles/restore-defaults` | Action permissions and screen access back to the defaults | Bearer |
| Reports & Exports | `GET` | `/api/reports/types` | The report types the signed-in user's role may generate | Bearer |
| Reports & Exports | `GET` | `/api/reports` | Report history: your reports (the Admin: everyone's), newest first | Bearer |
| Reports & Exports | `POST` | `/api/reports` | Generate a report in the background (poll GET /reports/{id}) | Bearer |
| Reports & Exports | `POST` | `/api/reports/email` | Generate a report and email it | Bearer |
| Reports & Exports | `GET` | `/api/reports/{report_id}` | A report and its status | Bearer |
| Reports & Exports | `GET` | `/api/reports/{report_id}/file` | Download the report file (PDF, XLSX or CSV) | Bearer |
| Logs | `GET` | `/api/activity` | The audit log, newest first | Bearer |
| Logs | `POST` | `/api/activity` | Record an event only the browser sees (Screen access denied) | Bearer |
| Logs | `GET` | `/api/sessions` | Sign-in sessions, newest first | Bearer |
| Logs | `GET` | `/api/errors` | The error log, newest first | Bearer |
| Logs | `PATCH` | `/api/errors/{error_id}` | Mark an error Open, Investigating or Resolved, with notes | Bearer |
| System | `GET` | `/api/health` | Is the API up, and can it reach the database? | Public |

## Frontend → endpoint map

| Screen | Endpoints it uses (service file) |
|---|---|
| Sign-in | `POST /auth/login`, `GET /auth/me` after a refresh, `POST /auth/password-reset` (`authService.js`) |
| All screens after sign-in | `GET /sales`, `/inventory`, `/inventory/snapshots`, `/inventory/alerts`, `/forecasts`, `/datasets`, `/reorders`, `/reports`, `/reports/types`, `/categories`; Admin also `/users`, `/roles/permissions`, `/roles/screens`, `/activity`, `/sessions`, `/errors` (`AppStore.jsx`) |
| Dashboard (every role) | `GET /dashboard/summary` with the global filters (`dashboardService.js`); Data Analyst: `POST /forecasts/recommendation` per demand type |
| Sales Data | `POST /datasets` (upload), `POST /datasets/{id}/clean`, `GET /datasets` (`salesService.js`) |
| Forecasting | `GET /forecasts/lineage`, `POST /forecasts`, `POST /forecasts/compare`, `GET /forecasts/{id}` (`forecastService.js`) |
| Inventory | `PATCH /inventory/{sku}`, `POST /reorders`, `PATCH /reorders/{id}` (`inventoryService.js`, `reorderService.js`) |
| Reports & Exports | `GET /reports/types`, `POST /reports` → poll `GET /reports/{id}` → `GET /reports/{id}/file`, `POST /reports/email` (`reportService.js`) |
| Administration | `POST/PATCH /users`, `POST/PATCH /categories`, `PATCH /roles/permissions`, `PUT /roles/{roleId}/screens`, `POST /roles/restore-defaults`, `PATCH /errors/{id}` (`adminService.js`, `activityService.js`) |
| Any screen opened without access | `POST /activity` (Screen access denied) |
