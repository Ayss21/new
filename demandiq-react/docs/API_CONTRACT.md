# DemandIQ API contract

**Version 1.2** · for the FastAPI backend team · JSON examples recorded from the demo backend on 17 October 2026

The React app calls every endpoint in this document through the service files in `src/services`
(`authService.js`, `dashboardService.js` … `activityService.js`). Pages never call `fetch` themselves.

Until FastAPI is ready, a **demo backend** inside the browser (`src/services/mock`) answers the same
requests with the same JSON, status codes, errors and permission checks, so the app is fully usable
today. One setting switches the app to FastAPI (section 11). The demo backend is also a working
reference implementation: when a rule here is unclear, the route files in `src/services/mock/routes`
show exactly what the app expects.

Every JSON example below is a **real response recorded from the demo backend** (long lists are cut
with `"… N more"`; those strings are not part of the data).

**What changed in 1.2**

- Reorders are **Ordered → Delivered**. `POST /reorders` places the order (`status: "Ordered"`, `orderedAt`
  set); Mark delivered is the only change after that. There is no Requested status, no `requestedAt`, and the
  server never moves an order by itself (6.6). The audit action is `Reorder placed` (section 9).
- Uploads take a sales file of **any layout** (section 7): columns are found by their names in any order
  among any number of other columns, with a header row under titles, without a header row, or with the
  dates across the top; dates and numbers in the usual forms. The file type comes from the contents, not
  the name. `validation.columns` says which column was read for what.
- Rows for the same product and day are **added up** (`combined` in `checks` and `validation`); only a row
  that repeats an earlier one exactly is a `duplicate`.
- Products the catalog doesn't have are **added at upload**, with their category when it's new:
  `dataset.newProducts` lists their SKUs, `GET /inventory` includes them (`unitCost: null`), and the audit
  log gets a `Products added` row (6.3, section 8).
- Clearer errors: 415 says why a PDF, an old `.xls` or another binary file can't be read; 422 says which
  column is missing, or why no row could be used.
- The app asks `POST /forecasts/recommendation` about at most 30 products per demand type, its best sellers
  in the date range (section 8).
- Database (`backend-seed/`, section 13): the table `reorders` replaces `reorder_requests`; new
  `products.added_from`, `datasets.combined_rows` and `dataset_view.new_products`.

**What changed in 1.1**

- Global filters are **lists**: `category`, `sku`, `region`, `model` (and `status`) take several values,
  sent as repeated query parameters (`?region=Central&region=East`) or JSON arrays; empty or missing =
  all. `location` and `channel` are no longer filters (section 1).
- `GET /datasets/history` and `GET /datasets/template` are **removed**: the dataset history is
  `GET /datasets` (section 6.3), and there is no template download.
- Uploads accept **CSV, TSV/TXT and Excel (.xlsx)** files, with forgiving column names (section 7).
- Reorders went Requested → Ordered → Delivered (was Pending → Approved → Received / Cancelled); in 1.2,
  Ordered → Delivered.
- `POST /users` **generates** the employee ID and work email; the app sends only the name, department,
  role, status and password (6.7).
- The **Admin is view-only** on Sales Data, Inventory and Forecasting: locked at Review (Upload sales) and
  View (Clean data, Run forecasts, Update inventory). Clean data also accepts `View` (section 4).
- Store Manager KPI **`sales_growth`** replaces `forecast_demand`; the Data Analyst's forecast KPIs count
  only the runs that match the filters (6.2).

## Contents

1. [Conventions](#1-conventions)
2. [Authentication and sessions](#2-authentication-and-sessions)
3. [Errors](#3-errors)
4. [Roles, screens and permissions](#4-roles-screens-and-permissions)
5. [Endpoint list](#5-endpoint-list)
6. [Endpoints in detail](#6-endpoints-in-detail) — auth, dashboard, sales, forecasts, inventory, reorders, admin, reports, logs
7. [File uploads and downloads](#7-file-uploads-and-downloads)
8. [Business rules the server owns](#8-business-rules-the-server-owns) — including dataset lineage
9. [Audit log and error log](#9-audit-log-and-error-log)
10. [Demo-only endpoints (do not implement)](#10-demo-only-endpoints-do-not-implement)
11. [Connecting the React app to FastAPI](#11-connecting-the-react-app-to-fastapi)
12. [Changes from the integration note](#12-changes-from-the-integration-note)
13. [Database and demo data: `backend-seed/`](#13-database-and-demo-data-backend-seed)

---

## 1. Conventions

| Item | Rule |
|---|---|
| Base path | Every path in this document is relative to **`/api`**: `POST /auth/login` means `POST /api/auth/login`. In development Vite forwards `/api/…` unchanged to `http://localhost:8000`, so FastAPI mounts its routers with `prefix="/api"`. |
| Format | JSON in UTF-8 (`Content-Type: application/json`), except the CSV upload (multipart) and file downloads (section 7). |
| Field names | **camelCase** in JSON (`startDate`, `pendingCount`). With Pydantic v2: `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)` and return models by alias. |
| Dates | Calendar dates `YYYY-MM-DD` (`2025-06-18`). Months `YYYY-MM`. Timestamps ISO 8601 in UTC with `Z` (`2025-06-26T05:00:00.000Z`). |
| IDs | Strings, treated as opaque by the app (`FC-0011`, `DS-0007`, `USR-1042`). Exceptions: `roleId` is an **integer** 1–4, screens use `SCR-01`…`SCR-06`, products are identified by `sku`. |
| Nulls | Every documented field is always present. `null` means "not available" (for example `mape` when a test day had no sales). |
| Lists | Returned in full as a JSON array (no pagination in version 1). Logs and histories are newest first. The app filters, sorts and pages lists itself. The largest list is `GET /sales` (1,496 records in the demo data). If lists grow too large, add `limit` / `offset` and tell the frontend team. |
| Numbers | Raw numbers, never formatted text. Money is in the sales currency. `discountRate` is a fraction (0.05 = 5 %). `mape` is a percentage (6.3 = 6.3 %). |
| Global filters | `start`, `end` (dates) and the lists `category`, `sku`, `region`, `model` (`status`: Safe / Warning / Critical, for the Inventory Supervisor's dashboard). GET requests send them as query parameters, repeating a list's name for each value (`?category=Polymers&category=Chemicals`; FastAPI: `category: list[str] \| None = Query(None)`); POST requests send a `filters` object with JSON arrays (`"region": ["Central"]`). An empty or missing list means "all"; missing dates mean the whole sales history. A single string is accepted as a list of one. A bad date is `422 validation_error`. |

---

## 2. Authentication and sessions

### How the app signs in

1. The user picks one of the four roles (section 4) and signs in: `POST /auth/login` returns an
   `accessToken` plus the user, the role's action permissions and its screen IDs.
2. The app keeps the token (in `localStorage` with **Remember me**, otherwise in `sessionStorage`) and sends it
   on every request as **`Authorization: Bearer <accessToken>`**.
3. After a page refresh the app calls `GET /auth/me` with the saved token:
   200 → the user stays signed in; 401 → the sign-in page shows `detail.message`;
   no answer → a "Can't reach the DemandIQ server" screen with **Try again**.
4. `POST /auth/logout` ends the session on the server (204). The app forgets the token even if this call fails.

### Login checks, in this order

| # | Check | Response |
|---|---|---|
| 1 | Email or employee ID (case-insensitive) and password match an account | otherwise **401** `invalid_credentials` — the same message whether the account or the password was wrong |
| 2 | The account is Active | Pending activation → **403** `account_pending`; Inactive → **403** `account_inactive` |
| 3 | The `roleId` picked on the sign-in page is the account's role | otherwise **403** `role_mismatch` |

Every refused sign-in is written to the activity log as **Sign-in failed** (section 9).

### Checks on every signed-in request

| Situation | Status | `detail.code` |
|---|---|---|
| No `Authorization` header, or not `Bearer …` | 401 | `not_authenticated` |
| Unknown token, or the session was signed out | 401 | `session_ended` |
| The session is past its `expiresAt` | 401 | `session_expired` |
| The account no longer exists | 401 | `account_missing` |
| The account was set to Pending activation | 401 | `account_pending` |
| The account was deactivated | 401 | `account_inactive` |
| The account's role changed since sign-in | 401 | `role_changed` |

Any 401 on a signed-in request signs the user out in the app and shows `detail.message` on the sign-in
page, so write these messages for end users ("Your session expired. Please sign in again.").

### Session rules

- A session lasts **8 hours**, or **7 days** when the login request has `"remember": true`
  (`SESSION_RULES` in `src/services/authService.js`). The server decides; the app only displays it.
- No refresh tokens in version 1: when a session ends, the user signs in again.
- The token can be a random string stored in a sessions table or a signed JWT. Either way the server must
  be able to **revoke** it at logout and run the checks above, so keep a sessions table (and put the
  session ID in the JWT if you use one).
- Passwords are stored as hashes (bcrypt or argon2) and are **never** returned by any endpoint.
- Permissions and screens are checked on every request against the current settings, so an Admin's change
  takes effect immediately (a refused request gets 403). The app reloads `GET /auth/me` when the Admin
  changes their own role's settings; other users see their new menus at their next sign-in or refresh.

---

## 3. Errors

Every error response has this body:

```json
{
  "detail": {
    "code": "forbidden",
    "message": "The Data Analyst role isn't allowed to upload sales data."
  }
}
```

| Key | Meaning |
|---|---|
| `code` | Machine-readable reason (table below). The app uses it for logic, e.g. `invalid_credentials` highlights both sign-in fields. |
| `message` | Shown to the user as it is. Write it for end users. |
| `fields` | Form errors only: `{ "fieldName": "message" }`. Each message appears under the matching input. |
| other keys | A few codes add data, e.g. `invalid_file` adds `validation` and `dataset`. |

In FastAPI:

```python
from fastapi import HTTPException

raise HTTPException(
    status_code=403,
    detail={"code": "forbidden", "message": "The Data Analyst role isn't allowed to upload sales data."},
)
```

FastAPI's own request-validation errors (422 with `detail` as a list of `{ "loc", "msg", "type" }`) work too:
the app turns `loc` into field names (`["body", "horizon"]` → `horizon`). You don't have to customise
them, but the field messages are friendlier if you return the `validation_error` shape below.

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "validation_error",
    "message": "Enter your email or employee ID.",
    "fields": {
      "login": "Enter your email or employee ID.",
      "password": "Enter your password.",
      "roleId": "Select the role you're signing in as."
    }
  }
}
```

### Status codes and error codes

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_json` | The body is not valid JSON |
| 401 | `invalid_credentials` | Sign-in: wrong login or password |
| 401 | `not_authenticated`, `session_ended`, `session_expired`, `account_missing`, `account_pending`, `account_inactive`, `role_changed` | The session is not valid (section 2) |
| 403 | `forbidden` | The role doesn't have the permission the endpoint needs (section 4) |
| 403 | `account_pending`, `account_inactive`, `role_mismatch` | Sign-in refused |
| 403 | `report_not_allowed` | The report type is not available to the role |
| 404 | `not_found` | Unknown ID, SKU or path |
| 405 | `method_not_allowed` | The path exists but not with this method |
| 409 | `not_pending` | Cleaning a dataset that is not waiting for cleaning |
| 409 | `invalid_transition` | Marking a delivered reorder delivered again (6.6) |
| 409 | `email_taken`, `id_taken`, `name_taken` | Duplicate user email, user or category ID, category name (with `fields`) |
| 409 | `last_admin`, `own_account`, `own_role` | Would leave no active Admin; deactivating or changing the role of your own account |
| 409 | `locked` | A permission or screen that can't be changed (section 4) |
| 409 | `report_processing`, `report_failed` | Downloading a report that isn't ready or failed |
| 413 | `file_too_large` | Upload over 50 MB (a server safeguard; the app doesn't show a limit) |
| 415 | `unsupported_file` | Upload is not a `.csv`, `.tsv`, `.txt` or `.xlsx` file |
| 422 | `validation_error` | Field values are invalid (`fields` lists them) |
| 422 | `invalid_file` | The file failed validation (the attempt is still recorded) |
| 422 | `forecast_failed` | The model could not run on that history |
| 500 | `server_error` | Unexpected failure |

The app adds its own status **0** for "no answer": `network_error` (server unreachable) and `timeout`
(no answer within 30 seconds). It treats **502, 503 and 504** the same way (that is what a proxy answers
when FastAPI is down — Vite's dev proxy sends 502): a signed-in user stays signed in and gets **Try again**
instead of being signed out. So don't use 502–504 for errors the user should act on.

---

## 4. Roles, screens and permissions

### Role IDs

Requests and responses use role **IDs**, never role names.

| `roleId` | Role |
|---|---|
| 1 | Store Manager |
| 2 | Data Analyst |
| 3 | Inventory Supervisor |
| 4 | Admin |

### Screen IDs and default screen access

| Screen ID | Screen | App address |
|---|---|---|
| SCR-01 | Dashboard | `#/dashboard` |
| SCR-02 | Sales Data | `#/sales-data` |
| SCR-03 | Inventory | `#/inventory` |
| SCR-04 | Reports & Exports | `#/reports` |
| SCR-05 | Forecasting | `#/forecasting` |
| SCR-06 | Administration | `#/administration` |

Defaults (`ROLE_SCREEN_ACCESS` in `src/navigation.js`); the Admin can change them with `PUT /roles/{roleId}/screens`:

| `roleId` | Role | Screen IDs |
|---|---|---|
| 1 | Store Manager | SCR-01 Dashboard, SCR-02 Sales Data, SCR-04 Reports & Exports |
| 2 | Data Analyst | SCR-01 Dashboard, SCR-02 Sales Data, SCR-04 Reports & Exports, SCR-05 Forecasting |
| 3 | Inventory Supervisor | SCR-01 Dashboard, SCR-03 Inventory, SCR-04 Reports & Exports |
| 4 | Admin | SCR-01 Dashboard, SCR-02 Sales Data, SCR-03 Inventory, SCR-04 Reports & Exports, SCR-05 Forecasting, SCR-06 Administration |

Locked cells (`409 locked`): every role keeps **SCR-01**; only the Admin has **SCR-06**, and the Admin always keeps it.

### Action permissions

What a role may do on its screens. Values: **`Yes`** (allowed) · **`View`** (sees, can't act) ·
**`Review`** (sees uploads, can't upload) · **`No`** (no access). The app shows `View`/`Review` actions as
disabled buttons. Defaults (`initialPermissions` in
`src/data/seed.js`); the Admin can change them with `PATCH /roles/permissions`:

| Action | Screen | 1 Store Manager | 2 Data Analyst | 3 Inventory Supervisor | 4 Admin |
|---|---|---|---|---|---|
| Upload sales | SCR-02 | `Yes` | `Review` | `No` | `Review` |
| Clean data | SCR-02 | `No` | `Yes` | `No` | `View` |
| Run forecasts | SCR-05 | `View` | `Yes` | `View` | `View` |
| Update inventory | SCR-03 | `No` | `No` | `Yes` | `View` |
| Generate reports | SCR-04 | `Yes` | `Yes` | `Yes` | `Yes` |
| Manage users | SCR-06 | `No` | `No` | `No` | `Yes` |
| View system logs | SCR-06 | `No` | `No` | `No` | `Yes` |

Allowed values per action: Upload sales `Yes`/`Review`/`No` · Clean data, Run forecasts and Update
inventory `Yes`/`View`/`No` · all others `Yes`/`No`.
Locked (`409 locked`): the Admin's **Manage users** stays `Yes`; the Admin is **view-only** on the Console
modules — Upload sales stays `Review`, Clean data, Run forecasts and Update inventory stay `View` (the
Admin sees Sales Data, Inventory and Forecasting with every action switched off; Reports stay usable);
**Manage users** and **View system logs** can only be given to the Admin (they belong to SCR-06). The
server applies the Admin's view-only levels even if the stored matrix said otherwise.

**An action only counts on its screen.** Each action is carried out on one screen (the Screen column). If a
role can't open that screen, its level for the action is `No`, whatever the matrix says — for example, the
Store Manager's `View` for Run forecasts counts only once the Admin gives the role SCR-05. The `permissions`
in the login and `/auth/me` responses are these **effective** levels, and the server checks requests
against them. `GET /roles/permissions` returns the matrix exactly as the Admin set it.

### What each endpoint requires

"= `Yes`" means the role's **effective** level (above). The app hides what a role can't do, but **the
server must check every request itself** — the browser is not a security boundary.

| Endpoints | Requirement |
|---|---|
| `POST /auth/login`, `GET /auth/roles`, `POST /auth/password-reset` | None (public) |
| `GET /auth/me`, `POST /auth/logout`, `GET /dashboard/summary`, `POST /activity` | Signed in |
| `GET /sales`, `GET /datasets` | Signed in |
| `POST /datasets` | Upload sales = `Yes` |
| `POST /datasets/{id}/clean` | Clean data = `Yes` |
| `GET /forecasts`, `GET /forecasts/{id}`, `GET /forecasts/lineage` | Signed in |
| `POST /forecasts`, `POST /forecasts/compare` | Run forecasts = `Yes` |
| `POST /forecasts/recommendation` | Run forecasts = `Yes` or `View` (effective level not `No`) |
| `GET /inventory`, `GET /inventory/alerts`, `GET /inventory/snapshots`, `GET /reorders`, `GET /categories` | Signed in |
| `PATCH /inventory/{sku}`, `POST /reorders`, `PATCH /reorders/{id}` | Update inventory = `Yes` |
| `/users…`, `POST`/`PATCH /categories…`, `/roles/…` | Manage users = `Yes` |
| `GET /reports`, `GET /reports/{id}`, `GET /reports/{id}/file` | Signed in; your own reports (the Admin sees everyone's — others get 404) |
| `POST /reports`, `POST /reports/email` | Generate reports = `Yes` **and** the report type is in the role's list below |
| `GET /activity`, `GET /sessions`, `GET /errors`, `PATCH /errors/{id}` | View system logs = `Yes` |

### Report types per role

| Role | Report types (`name` in `POST /reports`) |
|---|---|
| 1 Store Manager | Sales Summary, Demand Forecast Report, Forecast Accuracy Report, Sales by Region, Product Performance Report |
| 2 Data Analyst | Sales Summary, Demand Forecast Report, Forecast Accuracy Report, Data Quality Report |
| 3 Inventory Supervisor | Inventory Status Report, Reorder Recommendation Report |
| 4 Admin | All ten: the nine above plus User Activity Report and System Error Report |

(`REPORTS_BY_ROLE` and `ALL_REPORTS` in `src/data/seed.js`.)

---

## 5. Endpoint list

| Service function | Method and path | Success |
|---|---|---|
| **authService** | | |
| `login` | `POST /auth/login` | 200 |
| `getCurrentUser` | `GET /auth/me` | 200 |
| `logout` | `POST /auth/logout` | 204 |
| `getRoles` | `GET /auth/roles` | 200 |
| `requestPasswordReset` | `POST /auth/password-reset` | 202 |
| **dashboardService** | | |
| `getSummary` | `GET /dashboard/summary` | 200 |
| **salesService** | | |
| `getSales` | `GET /sales` | 200 |
| `getDatasets` | `GET /datasets` | 200 |
| `uploadDataset` | `POST /datasets` (multipart) | 201 |
| `cleanDataset` | `POST /datasets/{id}/clean` | 200 |
| **forecastService** | | |
| `runForecast` | `POST /forecasts` | 201 |
| `getForecasts` | `GET /forecasts` | 200 |
| `getForecastById` | `GET /forecasts/{id}` | 200 |
| `getLineage` | `GET /forecasts/lineage` | 200 |
| `compareModels` | `POST /forecasts/compare` | 200 |
| `getRecommendation` | `POST /forecasts/recommendation` | 200 |
| **inventoryService** | | |
| `getInventory` | `GET /inventory` | 200 |
| `updateStock` | `PATCH /inventory/{sku}` | 200 |
| `getAlerts` | `GET /inventory/alerts` | 200 |
| `getSnapshots` | `GET /inventory/snapshots` | 200 |
| **reorderService** | | |
| `getReorders` | `GET /reorders` | 200 |
| `createReorder` | `POST /reorders` | 201 |
| `updateReorderStatus` | `PATCH /reorders/{id}` | 200 |
| **adminService** | | |
| `getUsers` · `createUser` · `updateUser` | `GET /users` · `POST /users` · `PATCH /users/{id}` | 200 · 201 · 200 |
| `getCategories` · `createCategory` · `updateCategory` | `GET /categories` · `POST /categories` · `PATCH /categories/{id}` | 200 · 201 · 200 |
| `getPermissions` · `updatePermission` | `GET /roles/permissions` · `PATCH /roles/permissions` | 200 |
| `getScreenAccess` · `updateScreenAccess` | `GET /roles/screens` · `PUT /roles/{roleId}/screens` | 200 |
| `restoreDefaults` | `POST /roles/restore-defaults` | 200 |
| **reportService** | | |
| `getReports` | `GET /reports` | 200 |
| `generateReport` | `POST /reports` | 202 |
| `getReport` | `GET /reports/{id}` | 200 |
| `downloadReport` | `GET /reports/{id}/file` (PDF, XLSX or CSV) | 200 |
| `emailReport` | `POST /reports/email` | 202 |
| **activityService** | | |
| `getActivity` · `logEvent` | `GET /activity` · `POST /activity` | 200 · 201 |
| `getSessions` | `GET /sessions` | 200 |
| `getErrors` · `updateErrorStatus` | `GET /errors` · `PATCH /errors/{id}` | 200 |

When the app loads after sign-in it requests, in parallel: sales, inventory, snapshots, alerts, forecasts,
datasets, reorders, reports and categories; plus users, permissions and screens when the
role has Manage users = `Yes`; plus activity, sessions and errors when it has View system logs = `Yes`.
After each change it reloads only the lists that change.

---

## 6. Endpoints in detail

### 6.1 Authentication — `authService.js`

#### `POST /auth/login`

Public. Signs in with the role picked on the sign-in page.

| Field | Type | Rule |
|---|---|---|
| `login` | string | Email or employee ID, case-insensitive. Required. |
| `password` | string | Required. |
| `roleId` | integer | 1–4, the role picked on the sign-in page. Must be the account's role. |
| `remember` | boolean | Optional, default `false`. `true` → 7-day session, otherwise 8 hours. |

`POST /auth/login`

```json
{
  "login": "analyst@demo.demandiq",
  "password": "Analyze123!",
  "roleId": 2,
  "remember": true
}
```

**200** — the token, the session, the user, the role's permissions and its screen IDs:

```json
{
  "accessToken": "14766fe8cc9d1b6d7fbc725433cd51f6175eb1ad425f34e9",
  "tokenType": "bearer",
  "expiresAt": "2026-10-24T07:24:58.146Z",
  "session": {
    "id": "SES-0013",
    "startedAt": "2026-10-17T07:24:58.146Z",
    "expiresAt": "2026-10-24T07:24:58.146Z",
    "remember": true
  },
  "user": {
    "id": "USR-1042",
    "name": "Noura Alharbi",
    "email": "analyst@demo.demandiq",
    "roleId": 2,
    "initials": "NA",
    "department": "Data & Analytics",
    "status": "Active"
  },
  "permissions": {
    "Upload sales": "Review",
    "Clean data": "Yes",
    "Run forecasts": "Yes",
    "Update inventory": "No",
    "Generate reports": "Yes",
    "Manage users": "No",
    "View system logs": "No"
  },
  "screens": ["SCR-01", "SCR-02", "SCR-04", "SCR-05"]
}
```

Errors: 422 `validation_error` (`fields`: login, password, roleId) · 401 `invalid_credentials` ·
403 `account_pending` / `account_inactive` / `role_mismatch`:

`401 Unauthorized`

```json
{
  "detail": {
    "code": "invalid_credentials",
    "message": "Invalid user ID or password. Please try again."
  }
}
```

`403 Forbidden`

```json
{
  "detail": {
    "code": "role_mismatch",
    "message": "This account isn't registered as an Admin."
  }
}
```

`403 Forbidden`

```json
{
  "detail": {
    "code": "account_inactive",
    "message": "This account is inactive. Contact your administrator."
  }
}
```

#### `GET /auth/me`

The signed-in user, as in the login response but without `accessToken` and `tokenType`. The app calls it
after a page refresh.

```json
{
  "expiresAt": "2026-10-24T07:24:58.146Z",
  "session": {
    "id": "SES-0013",
    "startedAt": "2026-10-17T07:24:58.146Z",
    "expiresAt": "2026-10-24T07:24:58.146Z",
    "remember": true
  },
  "user": {
    "id": "USR-1042",
    "name": "Noura Alharbi",
    "email": "analyst@demo.demandiq",
    "roleId": 2,
    "initials": "NA",
    "department": "Data & Analytics",
    "status": "Active"
  },
  "permissions": {
    "Upload sales": "Review",
    "Clean data": "Yes",
    "Run forecasts": "Yes",
    "Update inventory": "No",
    "Generate reports": "Yes",
    "Manage users": "No",
    "View system logs": "No"
  },
  "screens": ["SCR-01", "SCR-02", "SCR-04", "SCR-05"]
}
```

Errors: 401 with the codes in section 2.

`401 Unauthorized`

```json
{
  "detail": {
    "code": "session_ended",
    "message": "Your session has ended. Please sign in again."
  }
}
```

#### `POST /auth/logout`

Ends the session: the token stops working. **204**, no body.

#### `GET /auth/roles`

Public. Each role with the screen IDs it can open now. The demo's sign-in page shows them next to the
demonstration accounts; in live mode the app doesn't call it (the role picker's four roles are fixed).

```json
[
  {
    "roleId": 1,
    "name": "Store Manager",
    "screens": ["SCR-01", "SCR-02", "SCR-04"]
  },
  {
    "roleId": 2,
    "name": "Data Analyst",
    "screens": ["SCR-01", "SCR-02", "SCR-04", "SCR-05"]
  },
  {
    "roleId": 3,
    "name": "Inventory Supervisor",
    "screens": ["SCR-01", "SCR-03", "SCR-04"]
  },
  {
    "roleId": 4,
    "name": "Admin",
    "screens": ["SCR-01", "SCR-02", "SCR-03", "SCR-04", "SCR-05", "SCR-06"]
  }
]
```

#### `POST /auth/password-reset`

Public. Request: `{ "email": "analyst@demo.demandiq" }`. Always **202**, whether or not the email has an
account, so nobody can find out which emails are registered. 422 if the email is not valid.

```json
{
  "message": "If an account exists for this email, reset instructions will be sent."
}
```

### 6.2 Dashboard — `dashboardService.js`

#### `GET /dashboard/summary`

The KPI cards at the top of the signed-in user's dashboard, for **their** role, calculated with the global
filters (query parameters, section 1). The charts and tables below the cards use the lists the app already
loaded.

Example: `GET /dashboard/summary?start=2025-03-19&end=2025-06-18&region=Central` as a Data Analyst:

```json
{
  "roleId": 2,
  "generatedAt": "2026-10-17T07:24:58.163Z",
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "kpis": [
    {
      "id": "uploaded_datasets",
      "label": "Uploaded datasets",
      "value": 7,
      "format": "number",
      "detail": "1 waiting for cleaning",
      "icon": "upload",
      "tone": ""
    },
    {
      "id": "valid_records",
      "label": "Valid records",
      "value": 122,
      "format": "number",
      "detail": "After active filters",
      "icon": "check",
      "tone": ""
    },
    {
      "id": "forecast_runs",
      "label": "Forecast runs",
      "value": 2,
      "format": "number",
      "detail": "Saved executions",
      "icon": "trend",
      "tone": ""
    },
    {
      "id": "forecast_accuracy",
      "label": "Forecast accuracy",
      "value": 92.99774581046653,
      "format": "percent",
      "detail": "100 − evaluation MAPE",
      "icon": "check",
      "tone": ""
    }
  ]
}
```

Each KPI: `id`, `label`, `value` (a raw number or `null`), `format`, `detail` (the small line under the
value), `icon`, `tone` (`""`, `"warning"` or `"critical"`). The app formats `value` by `format`:
`currency_millions` → `$1.23M` · `number` → `1,234` · `units` → `1,234 units` · `percent` → `93.0%` ·
`growth` → `+12.3%` / `−4.0%` · `null` → `N/A`. Icons are names from the app's icon set (`trend`, `box`, `grid`, `upload`, `check`,
`warning`, `shield`).

The KPIs per role ("filtered" = matching the global filters):

**1 Store Manager**

| `id` | `label` | `value` | `format` | `detail` | `icon` | `tone` |
|---|---|---|---|---|---|---|
| `total_revenue` | Total sales revenue | Sum of `netRevenue` of the filtered sales | `currency_millions` | “Net of recorded discounts” | `trend` | — |
| `units_sold` | Total units sold | Sum of `units` of the filtered sales | `number` | “N sales records” (filtered) | `box` | — |
| `active_skus` | Active products / SKUs | Number of different SKUs in the filtered sales | `number` | “N inventory records” (filtered products) | `grid` | — |
| `sales_growth` | Sales growth | Growth in `netRevenue` of the filtered sales against the period of the same length just before `start` (same category, SKU and region filters): (this period − previous) ÷ previous × 100. When the sales history starts or ends inside either period, the average revenue per day of history is compared instead. `null` when the previous period has no sales. Reference: `salesGrowth` in `src/lib/dashboard.js` | `growth` | “vs 19 Dec 2024 – 18 Mar 2025” (the previous period's days with history), plus “ · daily average” when days were missing; or “No sales in the previous period” | `trend` | — |

**2 Data Analyst**

| `id` | `label` | `value` | `format` | `detail` | `icon` | `tone` |
|---|---|---|---|---|---|---|
| `uploaded_datasets` | Uploaded datasets | Number of datasets | `number` | “N waiting for cleaning” (Pending with records), or “N total records” (all sales) | `upload` | — |
| `valid_records` | Valid records | Number of filtered sales records | `number` | “After active filters” | `check` | — |
| `forecast_runs` | Forecast runs | Saved runs of the picked models for products that match the filters | `number` | “Saved executions” | `trend` | — |
| `forecast_accuracy` | Forecast accuracy | 100 − `mape` of the newest of those runs (at least 0); `null` when that MAPE is `null` | `percent` | “100 − evaluation MAPE”, or “Run a model to evaluate” | `check` | — |

**3 Inventory Supervisor**

| `id` | `label` | `value` | `format` | `detail` | `icon` | `tone` |
|---|---|---|---|---|---|---|
| `active_skus` | Active SKUs | Number of filtered products | `number` | “Matching products” | `box` | — |
| `safe_items` | Safe stock items | Filtered products with status Safe | `number` | “Above reorder level” | `check` | — |
| `low_items` | Low stock items | Filtered products with status Warning | `number` | “Below reorder level” | `warning` | `warning` |
| `critical_items` | Critical stock alerts | Filtered products with status Critical | `number` | “Immediate review” | `warning` | `critical` |
| `suggested_reorder` | Suggested reorder | Sum of `suggested` of the filtered products | `units` | “Across N products” (with a suggestion) | `trend` | — |

**4 Admin**

| `id` | `label` | `value` | `format` | `detail` | `icon` | `tone` |
|---|---|---|---|---|---|---|
| `active_users` | Active users | Users with status Active | `number` | “Across four roles” | `shield` | — |
| `dataset_uploads` | Dataset uploads | Number of datasets | `number` | “Recorded uploads” | `upload` | — |
| `forecast_runs` | Forecast runs | Number of saved forecast runs (all) | `number` | “Saved executions” | `trend` | — |
| `unresolved_errors` | Unresolved errors | Error-log entries whose status isn't Resolved | `number` | “Requires attention” | `warning` | `critical` |

Reference implementation: `dashboardKpis` in `src/lib/dashboard.js`.

### 6.3 Sales data — `salesService.js`

#### `GET /sales`

Sales records. Without query parameters: the whole history (the app does this once and filters locally).
With the global filters as query parameters: only matching records, e.g.
`GET /sales?start=2025-03-19&end=2025-06-18&sku=PP-4012&sku=PE-7820&region=Central`.

```json
[
  {
    "id": "SAL-PP-4012-1",
    "date": "2024-12-19",
    "sku": "PP-4012",
    "category": "Polymers",
    "location": "Central DC",
    "region": "Central",
    "channel": "Direct",
    "units": 58,
    "unitPrice": 248,
    "discountRate": 0.05,
    "netRevenue": 13664.8,
    "datasetId": "DS-0002"
  },
  {
    "id": "SAL-PP-4012-2",
    "date": "2024-12-20",
    "sku": "PP-4012",
    "category": "Polymers",
    "location": "Central DC",
    "region": "Central",
    "channel": "Direct",
    "units": 67,
    "unitPrice": 248,
    "discountRate": 0,
    "netRevenue": 16616,
    "datasetId": "DS-0002"
  },
  "… 1494 more"
]
```

`netRevenue = units × unitPrice × (1 − discountRate)`, rounded to 2 decimals. `category`, `location`,
`region` and `channel` come from the product. **`datasetId`** is the upload the record was cleaned from
(`null` for history loaded without an upload) — the start of the dataset lineage (section 8). When a later
upload replaces a record (cleaning with `overlap: "replace"`), the record takes that upload's ID.

#### `GET /datasets`

Every upload attempt, newest first, with its pipeline state and its lineage. This list is also the Sales
Data page's **Dataset history** (Dataset · Date & Time · User · Action · Status): **Action** is `Failed`
when `validation` is `"Failed"`, otherwise `Uploaded`; **Status** is `Forecasted` when `forecasting` is
`"Completed"`, otherwise `Not Forecasted`. The example shows an upload waiting for cleaning (DS-0007) and
one whose records every product's forecast has used (DS-0005):

```json
[
  {
    "id": "DS-0007",
    "fileName": "sales_jun_19_25_2025.csv",
    "uploadedAt": "2025-06-26T03:00:00.000Z",
    "uploaderId": "USR-2091",
    "uploader": "Omar Hassan",
    "recordCount": 63,
    "validation": "2 warnings",
    "checks": {
      "total": 65,
      "valid": 63,
      "combined": 0,
      "missing": 1,
      "duplicates": 1,
      "invalidDates": 0,
      "invalidNumeric": 0
    },
    "coverage": {
      "firstDate": "2025-06-19",
      "lastDate": "2025-06-25",
      "products": 11
    },
    "cleaning": "Pending",
    "cleanedAt": null,
    "cleaningSummary": null,
    "pendingCount": 63,
    "newProducts": [],
    "forecasting": "Pending",
    "forecastedAt": null,
    "lineage": {
      "recordsInHistory": 0,
      "skus": [],
      "forecastedSkus": [],
      "forecastIds": []
    },
    "error": null
  },
  {
    "id": "DS-0005",
    "fileName": "sales_jun_1_18_2025.csv",
    "uploadedAt": "2025-06-19T03:15:00.000Z",
    "uploaderId": "USR-2091",
    "uploader": "Omar Hassan",
    "recordCount": 147,
    "validation": "Valid",
    "checks": {
      "total": 147,
      "valid": 147,
      "combined": 0,
      "missing": 0,
      "duplicates": 0,
      "invalidDates": 0,
      "invalidNumeric": 0
    },
    "coverage": {
      "firstDate": "2025-06-01",
      "lastDate": "2025-06-18",
      "products": 11
    },
    "cleaning": "Completed",
    "cleanedAt": "2025-06-19T03:50:00.000Z",
    "cleaningSummary": {
      "inputRecords": 147,
      "excludedAtValidation": 0,
      "outliersCapped": 0,
      "replaced": 0,
      "skipped": 0,
      "added": 147,
      "cleanedBy": "Noura Alharbi",
      "cleanedAt": "2025-06-19T03:50:00.000Z"
    },
    "pendingCount": 0,
    "newProducts": [],
    "forecasting": "Completed",
    "forecastedAt": "2025-06-19T04:35:00.000Z",
    "lineage": {
      "recordsInHistory": 147,
      "skus": [
        "AB-6621",
        "CH-2155",
        "EV-8843",
        "FE-1094",
        "LL-2468",
        "ME-7732",
        "PC-3308",
        "PE-7820",
        "PP-4012",
        "PS-5510",
        "UR-9954"
      ],
      "forecastedSkus": [
        "AB-6621",
        "CH-2155",
        "EV-8843",
        "FE-1094",
        "LL-2468",
        "ME-7732",
        "PC-3308",
        "PE-7820",
        "PP-4012",
        "PS-5510",
        "UR-9954"
      ],
      "forecastIds": [
        "FC-0011",
        "FC-0010",
        "FC-0009",
        "FC-0008",
        "FC-0007",
        "FC-0006",
        "FC-0005",
        "FC-0004",
        "FC-0003",
        "FC-0002",
        "FC-0001"
      ]
    },
    "error": null
  },
  "… 5 more"
]
```

| Field | Values |
|---|---|
| `validation` | `"Valid"`, `"N warning(s)"` (rows excluded at validation) or `"Failed"` |
| `checks` | Validation counts: `total` (rows in the file), `valid` (records), `combined`, `missing`, `duplicates`, `invalidDates`, `invalidNumeric` (section 7) |
| `coverage` | What the file's valid records cover: `firstDate`, `lastDate`, `products` (count); `null` for a rejected file |
| `cleaning` | `"Pending"` (waiting for a Data Analyst), `"Completed"` or `"Not started"` (failed upload) |
| `pendingCount` | Valid records waiting for cleaning. The records themselves stay on the server. |
| `newProducts` | SKUs of the products this upload added to the catalog; `[]` when it added none |
| `forecasting` | **Worked out from the saved forecasts' lineage, not stored** (rules in section 8): `"Not started"` (rejected), `"Pending"` (not cleaned yet, or no saved forecast used its records yet), `"Partial"` (forecasts used its records for some of its products), `"Completed"` (for every product it has in the history), `"Not needed"` (cleaned, but none of its records are in the history) |
| `forecastedAt` | When the first saved forecast that used its records was saved, otherwise `null` |
| `lineage.recordsInHistory` | Its records in the sales history now (records skipped as duplicates, or replaced by a later upload, don't count) |
| `lineage.skus` | Its products that count for forecasting: in the history now, or already forecast with its records |
| `lineage.forecastedSkus` | The products forecast with its records |
| `lineage.forecastIds` | The saved forecasts that used its records, newest first |
| `cleaningSummary` | Filled in by cleaning (see `POST /datasets/{id}/clean`), otherwise `null` |
| `error` | Why a failed upload was rejected, otherwise `null` |

After the analyst cleans DS-0007 and runs one forecast for PP-4012 over a range that includes its dates,
only that upload changes — to `"Partial"`, 1 of its 11 products:

```json
{
  "id": "DS-0007",
  "fileName": "sales_jun_19_25_2025.csv",
  "uploadedAt": "2025-06-26T03:00:00.000Z",
  "uploaderId": "USR-2091",
  "uploader": "Omar Hassan",
  "recordCount": 63,
  "validation": "2 warnings",
  "checks": {
    "total": 65,
    "valid": 63,
    "combined": 0,
    "missing": 1,
    "duplicates": 1,
    "invalidDates": 0,
    "invalidNumeric": 0
  },
  "coverage": {
    "firstDate": "2025-06-19",
    "lastDate": "2025-06-25",
    "products": 11
  },
  "cleaning": "Completed",
  "cleanedAt": "2026-10-17T07:24:58.196Z",
  "cleaningSummary": {
    "inputRecords": 63,
    "excludedAtValidation": 2,
    "outliersCapped": 1,
    "replaced": 0,
    "skipped": 0,
    "added": 63,
    "cleanedBy": "Noura Alharbi",
    "cleanedAt": "2026-10-17T07:24:58.196Z"
  },
  "pendingCount": 0,
  "newProducts": [],
  "forecasting": "Partial",
  "forecastedAt": "2026-10-17T07:24:58.198Z",
  "lineage": {
    "recordsInHistory": 63,
    "skus": [
      "AB-6621",
      "CH-2155",
      "EV-8843",
      "FE-1094",
      "LL-2468",
      "ME-7732",
      "PC-3308",
      "PE-7820",
      "PP-4012",
      "PS-5510",
      "UR-9954"
    ],
    "forecastedSkus": ["PP-4012"],
    "forecastIds": ["FC-0014"]
  },
  "error": null
}
```

#### `POST /datasets`

Upload a sales file of any layout — delimited text (CSV, TSV, TXT) or an Excel workbook (.xlsx):
`multipart/form-data` with the file in the field **`file`**. How the file is read is in section 7.

**201** — the new dataset (cleaning `Pending`) and the validation counts. `validation.columns` is the
file's column for each thing the server read (`date`, `product`, `units`, and `name`, `price`, `discount`,
`discountAmount`, `revenue`, `stock`, `category`, `region`, `location`, `channel` when the file has them):

```json
{
  "dataset": {
    "id": "DS-0008",
    "fileName": "sales_jun_26_27_2025.csv",
    "uploadedAt": "2026-10-17T07:24:58.177Z",
    "uploaderId": "USR-2091",
    "uploader": "Omar Hassan",
    "recordCount": 3,
    "validation": "Valid",
    "checks": {
      "total": 3,
      "valid": 3,
      "combined": 0,
      "missing": 0,
      "duplicates": 0,
      "invalidDates": 0,
      "invalidNumeric": 0
    },
    "coverage": {
      "firstDate": "2025-06-26",
      "lastDate": "2025-06-27",
      "products": 2
    },
    "cleaning": "Pending",
    "cleanedAt": null,
    "cleaningSummary": null,
    "pendingCount": 3,
    "newProducts": [],
    "forecasting": "Pending",
    "forecastedAt": null,
    "lineage": {
      "recordsInHistory": 0,
      "skus": [],
      "forecastedSkus": [],
      "forecastIds": []
    },
    "error": null
  },
  "validation": {
    "total": 3,
    "valid": 3,
    "combined": 0,
    "missing": 0,
    "duplicates": 0,
    "invalidDates": 0,
    "invalidNumeric": 0,
    "errors": [],
    "columns": {
      "date": "Date",
      "units": "Units_Sold",
      "discount": "Discount_Rate",
      "price": "Unit_Price",
      "product": "Product_ID"
    }
  }
}
```

A file in another layout — two stores a day, products the catalog doesn't have, columns the app doesn't
use, a known product written `pp4012`:

```
Date,Store ID,Product ID,Category,Region,Inventory Level,Units Sold,Units Ordered,Price,Discount,Weather Condition
2025-06-26,S001,P0001,Snacks,North,231,12,20,4.00,10,Sunny
2025-06-26,S002,P0001,Snacks,North,150,7,20,4.00,0,Rainy
2025-06-26,S001,P0002,Beverages,South,204,5,10,2.50,0,Sunny
2025-06-27,S001,P0001,Snacks,North,219,9,0,4.00,0,Sunny
2025-06-27,S002,P0001,Snacks,North,143,6,0,4.00,0,Cloudy
2025-06-27,S001,P0002,Beverages,South,199,4,10,2.50,5,Sunny
2025-06-27,S001,pp4012,Polymers,Central,1450,40,0,248,0,Sunny
```

The two rows per product and day become one record each (`combined: 2`), P0001 and P0002 join the catalog
(`newProducts`) with their categories, and `pp4012` is PP-4012:

```json
{
  "dataset": {
    "id": "DS-0011",
    "fileName": "retail_store_inventory.csv",
    "uploadedAt": "2026-10-17T07:24:58.208Z",
    "uploaderId": "USR-2091",
    "uploader": "Omar Hassan",
    "recordCount": 5,
    "validation": "Valid",
    "checks": {
      "total": 7,
      "valid": 5,
      "combined": 2,
      "missing": 0,
      "duplicates": 0,
      "invalidDates": 0,
      "invalidNumeric": 0
    },
    "coverage": {
      "firstDate": "2025-06-26",
      "lastDate": "2025-06-27",
      "products": 3
    },
    "cleaning": "Pending",
    "cleanedAt": null,
    "cleaningSummary": null,
    "pendingCount": 5,
    "newProducts": ["P0001", "P0002"],
    "forecasting": "Pending",
    "forecastedAt": null,
    "lineage": {
      "recordsInHistory": 0,
      "skus": [],
      "forecastedSkus": [],
      "forecastIds": []
    },
    "error": null
  },
  "validation": {
    "total": 7,
    "valid": 5,
    "combined": 2,
    "missing": 0,
    "duplicates": 0,
    "invalidDates": 0,
    "invalidNumeric": 0,
    "errors": [],
    "columns": {
      "date": "Date",
      "units": "Units Sold",
      "discount": "Discount",
      "price": "Price",
      "stock": "Inventory Level",
      "category": "Category",
      "region": "Region",
      "location": "Store ID",
      "product": "Product ID"
    }
  }
}
```

`GET /inventory` then includes the new products. Their stock is the file's stock column on its last day
(here 219 + 143), their price the median price in the file, and their reorder level, safety stock and
30-day demand come from their sales in the file (section 8). `unitCost` is `null`:

```json
{
  "sku": "P0001",
  "name": "P0001",
  "category": "Snacks",
  "location": "S001",
  "region": "North",
  "channel": "Unassigned",
  "unitPrice": 4,
  "unitCost": null,
  "reorder": 238,
  "safety": 119,
  "stock": 362,
  "demand": 510,
  "status": "Safe",
  "suggested": 0,
  "days": 21
}
```

**422 `invalid_file`** — the file can't be used. The attempt is still recorded (a `Failed` dataset, an
activity row and an error-log row), and the message says why — a column it couldn't find:

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "invalid_file",
    "message": "Couldn't find a product column (SKU, Product ID, Item or Product Name …). Columns in the file: Date, Units.",
    "validation": {
      "total": 1,
      "valid": 0,
      "combined": 0,
      "missing": 0,
      "duplicates": 0,
      "invalidDates": 0,
      "invalidNumeric": 0,
      "errors": [
        "Couldn't find a product column (SKU, Product ID, Item or Product Name …). Columns in the file: Date, Units."
      ],
      "columns": {
        "date": "Date",
        "units": "Units"
      }
    },
    "dataset": {
      "id": "DS-0009",
      "fileName": "broken.csv",
      "uploadedAt": "2026-10-17T07:24:58.178Z",
      "uploaderId": "USR-2091",
      "uploader": "Omar Hassan",
      "recordCount": 0,
      "validation": "Failed",
      "checks": {
        "total": 1,
        "valid": 0,
        "combined": 0,
        "missing": 0,
        "duplicates": 0,
        "invalidDates": 0,
        "invalidNumeric": 0
      },
      "coverage": null,
      "cleaning": "Not started",
      "cleanedAt": null,
      "cleaningSummary": null,
      "pendingCount": 0,
      "newProducts": [],
      "forecasting": "Not started",
      "forecastedAt": null,
      "lineage": {
        "recordsInHistory": 0,
        "skus": [],
        "forecastedSkus": [],
        "forecastIds": []
      },
      "error": "Couldn't find a product column (SKU, Product ID, Item or Product Name …). Columns in the file: Date, Units."
    }
  }
}
```

or why none of the rows could be used:

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "invalid_file",
    "message": "None of the 3 rows could be used: 2 have a number that can't be used (such as \"lots\"); 1 has a date that can't be read (such as \"31/31/2025\").",
    "validation": {
      "total": 3,
      "valid": 0,
      "combined": 0,
      "missing": 0,
      "duplicates": 0,
      "invalidDates": 1,
      "invalidNumeric": 2,
      "errors": [
        "None of the 3 rows could be used: 2 have a number that can't be used (such as \"lots\"); 1 has a date that can't be read (such as \"31/31/2025\")."
      ],
      "columns": {
        "date": "Date",
        "units": "Qty",
        "product": "SKU"
      }
    },
    "dataset": {
      "id": "DS-0010",
      "fileName": "bad_rows.csv",
      "uploadedAt": "2026-10-17T07:24:58.180Z",
      "uploaderId": "USR-2091",
      "uploader": "Omar Hassan",
      "recordCount": 0,
      "validation": "Failed",
      "checks": {
        "total": 3,
        "valid": 0,
        "combined": 0,
        "missing": 0,
        "duplicates": 0,
        "invalidDates": 1,
        "invalidNumeric": 2
      },
      "coverage": null,
      "cleaning": "Not started",
      "cleanedAt": null,
      "cleaningSummary": null,
      "pendingCount": 0,
      "newProducts": [],
      "forecasting": "Not started",
      "forecastedAt": null,
      "lineage": {
        "recordsInHistory": 0,
        "skus": [],
        "forecastedSkus": [],
        "forecastIds": []
      },
      "error": "None of the 3 rows could be used: 2 have a number that can't be used (such as \"lots\"); 1 has a date that can't be read (such as \"31/31/2025\")."
    }
  }
}
```

Other errors: 415 `unsupported_file` (a PDF, an Excel 97–2003 `.xls` or another binary file, judged by the
contents) · 413 `file_too_large` (over 50 MB) · 403 `forbidden` (the Data Analyst and the Admin have
`Review`):

`415 Unsupported Media Type`

```json
{
  "detail": {
    "code": "unsupported_file",
    "message": "A PDF can't be read as sales data. Upload a CSV, text or Excel (.xlsx) file."
  }
}
```

`403 Forbidden`

```json
{
  "detail": {
    "code": "forbidden",
    "message": "The Data Analyst role isn't allowed to upload sales data."
  }
}
```

#### `POST /datasets/{id}/clean`

A Data Analyst cleans a `Pending` upload and merges it into the sales data (rules in section 8).

| Field | Type | Rule |
|---|---|---|
| `capOutliers` | boolean | Default `true`: cap extreme values per product |
| `overlap` | string | `"replace"` (default) or `"skip"`: what to do when a record for the same date and product already exists |

`POST /datasets/DS-0008/clean`

```json
{
  "capOutliers": true,
  "overlap": "replace"
}
```

**200** — the updated dataset, the cleaning summary and the new date range of all sales (the app moves
its date presets to the new latest date):

```json
{
  "dataset": {
    "id": "DS-0008",
    "fileName": "sales_jun_26_27_2025.csv",
    "uploadedAt": "2026-10-17T07:24:58.177Z",
    "uploaderId": "USR-2091",
    "uploader": "Omar Hassan",
    "recordCount": 3,
    "validation": "Valid",
    "checks": {
      "total": 3,
      "valid": 3,
      "combined": 0,
      "missing": 0,
      "duplicates": 0,
      "invalidDates": 0,
      "invalidNumeric": 0
    },
    "coverage": {
      "firstDate": "2025-06-26",
      "lastDate": "2025-06-27",
      "products": 2
    },
    "cleaning": "Completed",
    "cleanedAt": "2026-10-17T07:24:58.184Z",
    "cleaningSummary": {
      "inputRecords": 3,
      "excludedAtValidation": 0,
      "outliersCapped": 0,
      "replaced": 0,
      "skipped": 0,
      "added": 3,
      "cleanedBy": "Noura Alharbi",
      "cleanedAt": "2026-10-17T07:24:58.184Z"
    },
    "pendingCount": 0,
    "newProducts": [],
    "forecasting": "Pending",
    "forecastedAt": null,
    "lineage": {
      "recordsInHistory": 3,
      "skus": ["PE-7820", "PP-4012"],
      "forecastedSkus": [],
      "forecastIds": []
    },
    "error": null
  },
  "summary": {
    "inputRecords": 3,
    "excludedAtValidation": 0,
    "outliersCapped": 0,
    "replaced": 0,
    "skipped": 0,
    "added": 3,
    "cleanedBy": "Noura Alharbi",
    "cleanedAt": "2026-10-17T07:24:58.184Z"
  },
  "salesRange": {
    "start": "2024-12-19",
    "end": "2025-06-27"
  }
}
```

Errors: 404 `not_found` · 409 `not_pending` · 422 `validation_error` · 403 `forbidden`.

`409 Conflict`

```json
{
  "detail": {
    "code": "not_pending",
    "message": "sales_jun_26_27_2025.csv is not waiting for cleaning."
  }
}
```

### 6.4 Forecasts — `forecastService.js`

#### `POST /forecasts`

Runs a model for one product and **saves** the run. Rules in section 8.

| Field | Type | Rule |
|---|---|---|
| `sku` | string | An existing product |
| `model` | string | `"Moving Average"`, `"Linear Regression"` or `"ARIMA"` |
| `horizon` | integer | Days to forecast, 1–365 |
| `startDate`, `endDate` | date | The sales history to fit on (`startDate` ≤ `endDate`) |
| `windowSize` | integer | Moving Average only: 2–60, default 7 |
| `order` | `[p, d, q]` | ARIMA only: p 0–5, d 0–2, q 0–5, default `[2, 1, 2]` |

`POST /forecasts`

```json
{
  "sku": "PP-4012",
  "model": "ARIMA",
  "horizon": 30,
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "order": [2, 1, 2]
}
```

**201** — the saved run:

```json
{
  "id": "FC-0012",
  "sku": "PP-4012",
  "model": "ARIMA",
  "horizon": 30,
  "status": "Completed",
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "configuration": {
    "horizon": 30,
    "order": [2, 1, 2]
  },
  "metrics": {
    "mae": 4.841826406809797,
    "rmse": 5.49281607562721,
    "mape": 6.323860786988085
  },
  "evaluation": {
    "holdoutDays": 14
  },
  "points": [
    {
      "date": "2025-06-19",
      "predicted": 81
    },
    {
      "date": "2025-06-20",
      "predicted": 81
    },
    {
      "date": "2025-06-21",
      "predicted": 78
    },
    {
      "date": "2025-06-22",
      "predicted": 78
    },
    "… 26 more"
  ],
  "lineage": {
    "records": 92,
    "sources": [
      {
        "datasetId": "DS-0002",
        "fileName": "sales_dec_2024_mar_2025.csv",
        "records": 13,
        "firstDate": "2025-03-19",
        "lastDate": "2025-03-31"
      },
      {
        "datasetId": "DS-0003",
        "fileName": "sales_april_2025.csv",
        "records": 30,
        "firstDate": "2025-04-01",
        "lastDate": "2025-04-30"
      },
      {
        "datasetId": "DS-0004",
        "fileName": "sales_may_2025.csv",
        "records": 31,
        "firstDate": "2025-05-01",
        "lastDate": "2025-05-31"
      },
      {
        "datasetId": "DS-0005",
        "fileName": "sales_jun_1_18_2025.csv",
        "records": 18,
        "firstDate": "2025-06-01",
        "lastDate": "2025-06-18"
      }
    ],
    "waiting": []
  },
  "generatedAt": "2026-10-17T07:24:58.186Z",
  "generatedBy": {
    "id": "USR-1042",
    "name": "Noura Alharbi"
  }
}
```

| Field | Meaning |
|---|---|
| `configuration` | The settings used: `horizon` plus `windowSize` (Moving Average), `slope` (Linear Regression) or `order` (ARIMA) |
| `metrics` | MAE, RMSE and MAPE on the held-out days. `mape` is `null` when a held-out day had 0 sales |
| `evaluation.holdoutDays` | How many of the most recent days were held back to measure accuracy |
| `points` | One per future day after `endDate`: `predicted` is a whole number of units, never negative |
| `lineage` | Where the history came from, kept with the run: `records` (sales records used), `sources` (the cleaned uploads they came from, with how many records and which dates), `waiting` (uploads still waiting for cleaning that had this product's sales in the range — not used, so the forecast counted those days as no sales). See `GET /forecasts/lineage` and section 8. |
| `generatedBy` | `{ id, name }` of the user, `null` for runs from before user tracking |

Moving Average request and its `configuration`:

`POST /forecasts`

```json
{
  "sku": "PE-7820",
  "model": "Moving Average",
  "horizon": 14,
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "windowSize": 7
}
```

```json
"configuration": {"horizon": 14, "windowSize": 7}
```

Errors: 422 `validation_error` · 422 `forecast_failed` (also written to the error log) · 403 `forbidden`.

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "validation_error",
    "message": "Choose an existing product SKU.",
    "fields": {
      "sku": "Choose an existing product SKU.",
      "model": "Use one of: Moving Average, Linear Regression, ARIMA.",
      "horizon": "Use a whole number of days from 1 to 365."
    }
  }
}
```

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "forecast_failed",
    "message": "At least 21 historical periods are required to run this forecast."
  }
}
```

`403 Forbidden`

```json
{
  "detail": {
    "code": "forbidden",
    "message": "The Store Manager role isn't allowed to run forecasts."
  }
}
```

Side effects: the product's 30-day demand, suggested reorder and status are recalculated from the run, and
the run's `lineage` is saved with it. **No dataset is changed**: each upload's forecasting status is worked
out from the saved runs' lineage (section 8), so a forecast for one product never changes the status of an
upload it didn't use.

#### `GET /forecasts`

Every saved run, newest first, in the same shape as above.

#### `GET /forecasts/{id}`

One saved run. 404 `not_found` if it doesn't exist.

#### `GET /forecasts/lineage?sku&start&end`

Which uploads a forecast with these settings would use — asked by the Forecasting page's **Data used**
strip before the analyst runs it. The same `records`, `sources` and `waiting` as a saved run's `lineage`,
plus the request and the number of days. Nothing is saved. 422 `validation_error` for an unknown SKU or a
bad date range.

FastAPI matches paths in the order they are declared: declare `/forecasts/lineage` **before**
`/forecasts/{id}`, or "lineage" is taken as a run ID.

Example: PP-4012 from 1 to 25 June, while the 19–25 June upload is still waiting for cleaning:

```json
{
  "sku": "PP-4012",
  "startDate": "2025-06-01",
  "endDate": "2025-06-25",
  "days": 25,
  "records": 18,
  "sources": [
    {
      "datasetId": "DS-0005",
      "fileName": "sales_jun_1_18_2025.csv",
      "records": 18,
      "firstDate": "2025-06-01",
      "lastDate": "2025-06-18"
    }
  ],
  "waiting": [
    {
      "datasetId": "DS-0007",
      "fileName": "sales_jun_19_25_2025.csv",
      "records": 7,
      "firstDate": "2025-06-19",
      "lastDate": "2025-06-25"
    }
  ]
}
```

#### `POST /forecasts/compare`

Runs all three models on the same product and settings **without saving** anything (Forecasting page →
Compare models). A model that can't run on that history has `status: "Failed"` and an `error`.

`POST /forecasts/compare`

```json
{
  "sku": "PP-4012",
  "horizon": 30,
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "windowSize": 7,
  "order": [2, 1, 2]
}
```

```json
{
  "sku": "PP-4012",
  "horizon": 30,
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "results": [
    {
      "model": "Moving Average",
      "status": "Completed",
      "metrics": {
        "mae": 5.516349380322181,
        "rmse": 5.868703521034846,
        "mape": 7.002254189533468
      },
      "totalPredicted": 2306,
      "error": null
    },
    {
      "model": "Linear Regression",
      "status": "Completed",
      "metrics": {
        "mae": 4.814629312820996,
        "rmse": 5.453058101124307,
        "mape": 6.298510089998026
      },
      "totalPredicted": 2399,
      "error": null
    },
    {
      "model": "ARIMA",
      "status": "Completed",
      "metrics": {
        "mae": 4.841826406809797,
        "rmse": 5.49281607562721,
        "mape": 6.323860786988085
      },
      "totalPredicted": 2411,
      "error": null
    }
  ]
}
```

#### `POST /forecasts/recommendation`

Which model is most accurate for a group of products (Data Analyst dashboard → Demand type distribution →
a demand type). The server tests all three models on the same products and the same held-out days, using
the sales that match `filters`. Nothing is saved. Rules in section 8.

| Field | Type | Rule |
|---|---|---|
| `skus` | string[] | Up to 500. Unknown SKUs are ignored; the response's `skus` lists the ones tested. The app sends at most 30 per demand type: the ones that sold the most units in the date range |
| `filters` | object | The global filters (`start`, `end` and the lists `category`, `sku`, `region`) |

`POST /forecasts/recommendation`

```json
{
  "skus": ["PP-4012", "PE-7820", "PC-3308"],
  "filters": {
    "start": "2025-03-19",
    "end": "2025-06-18",
    "region": ["Central"]
  }
}
```

```json
{
  "skus": ["PP-4012", "PE-7820", "PC-3308"],
  "startDate": "2025-03-19",
  "endDate": "2025-06-18",
  "days": 92,
  "testDays": 14,
  "metric": "mae",
  "recommended": "Linear Regression",
  "reason": null,
  "margin": 0.005617114638919985,
  "close": true,
  "ranked": ["Linear Regression", "ARIMA", "Moving Average"],
  "models": [
    {
      "model": "Moving Average",
      "products": [
        {
          "sku": "PP-4012",
          "mae": 5.516349380322181,
          "rmse": 5.868703521034846,
          "mape": 7.002254189533468
        },
        {
          "sku": "PE-7820",
          "mae": 0,
          "rmse": 0,
          "mape": null
        },
        {
          "sku": "PC-3308",
          "mae": 0,
          "rmse": 0,
          "mape": null
        }
      ],
      "tested": 3,
      "eligible": true,
      "error": null,
      "mae": 1.8387831267740602,
      "rmse": 1.9562345070116154,
      "mape": null,
      "wins": 2
    },
    {
      "model": "Linear Regression",
      "products": [
        {
          "sku": "PP-4012",
          "mae": 4.814629312820996,
          "rmse": 5.453058101124307,
          "mape": 6.298510089998026
        },
        {
          "sku": "PE-7820",
          "mae": 0,
          "rmse": 0,
          "mape": null
        },
        {
          "sku": "PC-3308",
          "mae": 0,
          "rmse": 0,
          "mape": null
        }
      ],
      "tested": 3,
      "eligible": true,
      "error": null,
      "mae": 1.6048764376069986,
      "rmse": 1.8176860337081022,
      "mape": null,
      "wins": 1
    },
    {
      "model": "ARIMA",
      "products": [
        {
          "sku": "PP-4012",
          "mae": 4.841826406809797,
          "rmse": 5.49281607562721,
          "mape": 6.323860786988085
        },
        {
          "sku": "PE-7820",
          "mae": 0,
          "rmse": 0,
          "mape": null
        },
        {
          "sku": "PC-3308",
          "mae": 0,
          "rmse": 0,
          "mape": null
        }
      ],
      "tested": 3,
      "eligible": true,
      "error": null,
      "mae": 1.6139421356032655,
      "rmse": 1.8309386918757367,
      "mape": null,
      "wins": 0
    }
  ]
}
```

`recommended` is `null` when no reliable recommendation can be made, and `reason` says why (no products,
fewer than 7 test days, or fewer than two models could be tested). `ranked` lists the eligible models,
best first. `close` is `true` when the lead is under 3 % (`margin` is the lead as a fraction).

### 6.5 Inventory — `inventoryService.js`

#### `GET /inventory`

Every product with its stock position.

```json
[
  {
    "sku": "PP-4012",
    "name": "Polypropylene 4012",
    "category": "Polymers",
    "location": "Central DC",
    "region": "Central",
    "channel": "Direct",
    "unitPrice": 248,
    "unitCost": 162,
    "reorder": 650,
    "safety": 300,
    "stock": 1240,
    "demand": 2414,
    "status": "Safe",
    "suggested": 0,
    "days": 15
  },
  {
    "sku": "PE-7820",
    "name": "HDPE Resin 7820",
    "category": "Polyethylene",
    "location": "East Hub",
    "region": "East",
    "channel": "Distributor",
    "unitPrice": 224,
    "unitCost": 148,
    "reorder": 400,
    "safety": 220,
    "stock": 184,
    "demand": 2773,
    "status": "Critical",
    "suggested": 2809,
    "days": 2
  },
  "… 9 more"
]
```

| Field | Meaning |
|---|---|
| `unitPrice`, `unitCost` | List price and unit cost. `unitCost` is `null` when it isn't known (products added from an upload) |
| `reorder` | Reorder level (units) |
| `safety` | Safety stock (units) |
| `demand` | Expected demand for the next 30 days (units), updated by forecast runs |
| `status` | `"Safe"`, `"Warning"` (the app shows "Low") or `"Critical"` |
| `suggested` | Suggested reorder quantity (0 when Safe) |
| `days` | Days of stock left at the current demand |

The formulas are in section 8.

#### `PATCH /inventory/{sku}`

Sets the stock after a count or adjustment. `status`, `suggested` and `days` are recalculated, and the
current month's snapshot is updated.

| Field | Type | Rule |
|---|---|---|
| `stock` | integer | 0 or more |
| `reason` | string | Required (e.g. "Cycle count") |
| `notes` | string | Optional |

`PATCH /inventory/PP-4012`

```json
{
  "stock": 1450,
  "reason": "Cycle count",
  "notes": "Aisle 4 recount"
}
```

```json
{
  "sku": "PP-4012",
  "name": "Polypropylene 4012",
  "category": "Polymers",
  "location": "Central DC",
  "region": "Central",
  "channel": "Direct",
  "unitPrice": 248,
  "unitCost": 162,
  "reorder": 650,
  "safety": 300,
  "stock": 1450,
  "demand": 2414,
  "status": "Safe",
  "suggested": 0,
  "days": 18
}
```

Errors: 404 `not_found` · 422 `validation_error` · 403 `forbidden`.

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "validation_error",
    "message": "Enter a whole number, 0 or more.",
    "fields": {
      "stock": "Enter a whole number, 0 or more.",
      "reason": "Choose an adjustment reason."
    }
  }
}
```

#### `GET /inventory/alerts`

Products below their reorder level (the bell in the header), Critical first, then fewest days left.

```json
[
  {
    "sku": "PE-7820",
    "name": "HDPE Resin 7820",
    "status": "Critical",
    "stock": 184,
    "reorder": 400,
    "safety": 220,
    "days": 2,
    "suggested": 2809,
    "message": "PE-7820 has 2 days of stock remaining"
  },
  {
    "sku": "FE-1094",
    "name": "Fertilizer Grade 1094",
    "status": "Critical",
    "stock": 290,
    "reorder": 520,
    "safety": 260,
    "days": 10,
    "suggested": 810,
    "message": "FE-1094 has 10 days of stock remaining"
  },
  "… 3 more"
]
```

#### `GET /inventory/snapshots?start=YYYY-MM&end=YYYY-MM`

Month-end stock per product, for the Monthly inventory trends chart. Both parameters are optional.

```json
[
  {
    "month": "2025-05",
    "asOf": "2025-05-31",
    "items": [
      {
        "sku": "PP-4012",
        "stock": 1290,
        "status": "Safe"
      },
      {
        "sku": "PE-7820",
        "stock": 300,
        "status": "Warning"
      },
      "… 9 more"
    ]
  },
  {
    "month": "2025-06",
    "asOf": "2025-06-18",
    "items": [
      {
        "sku": "PP-4012",
        "stock": 1240,
        "status": "Safe"
      },
      {
        "sku": "PE-7820",
        "stock": 184,
        "status": "Critical"
      },
      "… 9 more"
    ]
  }
]
```

### 6.6 Reorders — `reorderService.js`

A reorder is **Ordered**, then **Delivered** (Inventory page → Reorder status):

| Status | Set by | When |
|---|---|---|
| `Ordered` | `POST /reorders` | The Inventory Supervisor places the order (product details → Place reorder). `orderedAt` is set |
| `Delivered` | `PATCH /reorders/{id}` `{ "status": "Delivered" }` (**Mark delivered**) | The goods arrived: `deliveredAt` is set, the quantity is **added to the product's stock**, its `status`, `suggested` and `days` are worked out again, and the current month's snapshot follows |

There is no other status and no other change: a delivered order stays delivered. `deliveredAt` is `null`
until Mark delivered.

#### `POST /reorders`

| Field | Type | Rule |
|---|---|---|
| `sku` | string | An existing product |
| `quantity` | integer | More than 0 |
| `supplier` | string | Required |

`POST /reorders`

```json
{
  "sku": "PP-4012",
  "quantity": 600,
  "supplier": "Gulf Polymers Supply"
}
```

**201** — the order, `Ordered`:

```json
{
  "id": "RO-0004",
  "sku": "PP-4012",
  "quantity": 600,
  "supplier": "Gulf Polymers Supply",
  "status": "Ordered",
  "orderedAt": "2026-10-17T07:24:58.209Z",
  "deliveredAt": null,
  "userId": "USR-3381",
  "userName": "Layla Noor"
}
```

#### `PATCH /reorders/{id}`

Request: `{ "status": "Delivered" }` (Mark delivered). Returns the updated order:

```json
{
  "id": "RO-0004",
  "sku": "PP-4012",
  "quantity": 600,
  "supplier": "Gulf Polymers Supply",
  "status": "Delivered",
  "orderedAt": "2026-10-17T07:24:58.209Z",
  "deliveredAt": "2026-10-17T07:24:58.210Z",
  "userId": "USR-3381",
  "userName": "Layla Noor"
}
```

Refused: an order that is already delivered (`409 invalid_transition`); any other `status` (`422`); the
Admin (`403`, view only):

`409 Conflict`

```json
{
  "detail": {
    "code": "invalid_transition",
    "message": "RO-0004 has already been delivered."
  }
}
```

`422 Unprocessable Entity`

```json
{
  "detail": {
    "code": "validation_error",
    "message": "Use \"Delivered\".",
    "fields": {
      "status": "Use \"Delivered\"."
    }
  }
}
```

`403 Forbidden`

```json
{
  "detail": {
    "code": "forbidden",
    "message": "The Admin role isn't allowed to update stock or reorders."
  }
}
```

#### `GET /reorders`

Every order, newest first, in the same shape. The demo data has three — RO-0003 and RO-0002 Ordered (the
orders the activity log mentions), RO-0001 Delivered — so new orders start at RO-0004:

```json
[
  {
    "id": "RO-0004",
    "sku": "PP-4012",
    "quantity": 600,
    "supplier": "Gulf Polymers Supply",
    "status": "Delivered",
    "orderedAt": "2026-10-17T07:24:58.209Z",
    "deliveredAt": "2026-10-17T07:24:58.210Z",
    "userId": "USR-3381",
    "userName": "Layla Noor"
  },
  {
    "id": "RO-0003",
    "sku": "PE-7820",
    "quantity": 796,
    "supplier": "Approved supplier · SUP-024",
    "status": "Ordered",
    "orderedAt": "2025-06-26T03:35:00.000Z",
    "deliveredAt": null,
    "userId": "USR-3381",
    "userName": "Layla Noor"
  },
  "… 2 more"
]
```

### 6.7 Administration — `adminService.js`

#### Users: `GET /users`, `POST /users`, `PATCH /users/{id}`

`GET /users` returns every account (never with passwords):

```json
[
  {
    "id": "USR-1042",
    "name": "Noura Alharbi",
    "email": "analyst@demo.demandiq",
    "roleId": 2,
    "initials": "NA",
    "department": "Data & Analytics",
    "status": "Active"
  },
  {
    "id": "USR-2091",
    "name": "Omar Hassan",
    "email": "store.manager@demo.demandiq",
    "roleId": 1,
    "initials": "OH",
    "department": "Commercial",
    "status": "Active"
  },
  "… 4 more"
]
```

`POST /users` creates an account. The Admin's **Add user** form asks only for the name (plus department,
role, status and a temporary password): **the server gives the account its employee ID and work email**.

| Field | Type | Rule |
|---|---|---|
| `name` | string | Required |
| `department` | string | Required |
| `roleId` | integer | 1–4 |
| `status` | string | `"Active"` (default) or `"Pending activation"` |
| `password` | string | At least 8 characters. Stored hashed. |
| `id` | string | Optional (for imports): employee ID like `USR-2044`, unique. Left out → `USR-` and one more than the highest number in use (USR-3381 → USR-3382) |
| `email` | string | Optional (for imports): valid and unique. Left out → `first.last@` + the signed-in Admin's email domain, from the name's first and last word (accents dropped, lower case: `José María Núñez` → `jose.nunez@…`), with `2`, `3` … added when taken (`sara.khalid2@…`); a name without Latin letters uses the employee ID (`usr-3382@…`) |

`POST /users`

```json
{
  "name": "Sara Khalid",
  "department": "Commercial",
  "roleId": 1,
  "status": "Active",
  "password": "Welcome123!"
}
```

**201** — the new user (same shape as `GET /users`); the app shows the generated ID and email:

```json
{
  "id": "USR-3382",
  "name": "Sara Khalid",
  "email": "sara.khalid@demo.demandiq",
  "roleId": 1,
  "initials": "SK",
  "department": "Commercial",
  "status": "Active"
}
```

Duplicates (a given `id` or `email` already in use) are `409` with `fields`:

`409 Conflict`

```json
{
  "detail": {
    "code": "email_taken",
    "message": "A user with this email already exists.",
    "fields": {
      "email": "A user with this email already exists."
    }
  }
}
```

`PATCH /users/{id}` changes any of `name`, `email`, `department`, `roleId`, `status`
(`"Active"`, `"Pending activation"`, `"Inactive"`) and `password`. Returns the updated user.
Refused with 409: `last_admin` (no active Admin would be left), `own_account` (deactivating yourself),
`own_role` (changing your own role).

`PATCH /users/USR-3382`

```json
{
  "department": "Supply Chain",
  "roleId": 3
}
```

`409 Conflict`

```json
{
  "detail": {
    "code": "last_admin",
    "message": "At least one active Admin is required."
  }
}
```

A user whose status or role changes is signed out at their next request (section 2).

#### Categories: `GET /categories`, `POST /categories`, `PATCH /categories/{id}`

`GET /categories` is available to every signed-in user (the global filters list them). `products` is the
number of products in the category, counted from the products (not stored), so a new category has 0.
Renaming a category renames it everywhere: products refer to their category by ID.

```json
[
  {
    "id": "CAT-001",
    "name": "Polymers",
    "description": "Thermoplastic resin portfolio",
    "status": "Active",
    "products": 2
  },
  {
    "id": "CAT-002",
    "name": "Polyethylene",
    "description": "HDPE, LDPE and LLDPE products",
    "status": "Active",
    "products": 2
  },
  "… 5 more"
]
```

`POST /categories`: `{ "id": "CAT-006" (optional, like CAT-001), "name": "…" (required, unique), "description": "…" }`
→ **201**. `PATCH /categories/{id}`: any of `name`, `description`, `status` (`"Active"` / `"Inactive"`).

`POST /categories`

```json
{
  "name": "Specialty Resins",
  "description": "High-performance resin grades"
}
```

```json
{
  "id": "CAT-008",
  "name": "Specialty Resins",
  "description": "High-performance resin grades",
  "status": "Active",
  "products": 0
}
```

#### Action permissions: `GET /roles/permissions`, `PATCH /roles/permissions`

The whole matrix: action → role ID → value. JSON object keys are always strings, so role IDs appear as
`"1"` … `"4"` here.

```json
{
  "Upload sales": {
    "1": "Yes",
    "2": "Review",
    "3": "No",
    "4": "Review"
  },
  "Clean data": {
    "1": "No",
    "2": "Yes",
    "3": "No",
    "4": "View"
  },
  "Run forecasts": {
    "1": "View",
    "2": "Yes",
    "3": "View",
    "4": "View"
  },
  "Update inventory": {
    "1": "No",
    "2": "No",
    "3": "Yes",
    "4": "View"
  },
  "Generate reports": {
    "1": "Yes",
    "2": "Yes",
    "3": "Yes",
    "4": "Yes"
  },
  "Manage users": {
    "1": "No",
    "2": "No",
    "3": "No",
    "4": "Yes"
  },
  "View system logs": {
    "1": "No",
    "2": "No",
    "3": "No",
    "4": "Yes"
  }
}
```

`PATCH` changes one cell and returns the whole matrix. A locked cell (section 4) is `409 locked`:

`PATCH /roles/permissions`

```json
{
  "action": "Run forecasts",
  "roleId": 1,
  "value": "Yes"
}
```

`409 Conflict`

```json
{
  "detail": {
    "code": "locked",
    "message": "The Admin only views Sales Data, Inventory and Forecasting."
  }
}
```

#### Screen access: `GET /roles/screens`, `PUT /roles/{roleId}/screens`

Role ID → the screen IDs it can open.

```json
{
  "1": ["SCR-01", "SCR-02", "SCR-04"],
  "2": ["SCR-01", "SCR-02", "SCR-04", "SCR-05"],
  "3": ["SCR-01", "SCR-03", "SCR-04"],
  "4": ["SCR-01", "SCR-02", "SCR-03", "SCR-04", "SCR-05", "SCR-06"]
}
```

`PUT /roles/{roleId}/screens` replaces one role's list and returns the whole map. Changing a locked cell
is `409 locked`:

`PUT /roles/1/screens`

```json
{
  "screens": ["SCR-01", "SCR-02", "SCR-04"]
}
```

`409 Conflict`

```json
{
  "detail": {
    "code": "locked",
    "message": "The Admin always keeps Administration, so access settings can't be locked out."
  }
}
```

#### `POST /roles/restore-defaults`

Puts the action permissions and screen access back to the defaults in section 4. Returns
`{ "permissions": {…}, "screens": {…} }`.

### 6.8 Reports — `reportService.js`

Reports are generated **in the background**:

```
POST /reports ──202──▶ { status: "Processing" }
      │
      ▼  the app polls GET /reports/{id} every 0.5 s (gives up after 60 s)
{ status: "Completed" } ──▶ GET /reports/{id}/file ──▶ PDF / XLSX / CSV download
{ status: "Failed", error: "…" } ──▶ the app shows the error
```

The report appears in the report history as soon as it is requested.

#### `POST /reports`

| Field | Type | Rule |
|---|---|---|
| `name` | string | A report type from section 4 that the role may generate |
| `format` | string | `"PDF"`, `"XLSX"` or `"CSV"` |
| `filters` | object | The global filters applied when the report was requested (section 1; lists as JSON arrays) |

`POST /reports`

```json
{
  "name": "Sales Summary",
  "format": "PDF",
  "filters": {
    "start": "2025-03-19",
    "end": "2025-06-18",
    "region": ["Central"]
  }
}
```

**202**:

```json
{
  "id": "RPT-022",
  "name": "Sales Summary",
  "format": "PDF",
  "generatedAt": "2026-10-17T07:24:58.215Z",
  "userId": "USR-2091",
  "userName": "Omar Hassan",
  "roleId": 1,
  "status": "Processing",
  "filters": {
    "start": "2025-03-19",
    "end": "2025-06-18",
    "region": ["Central"]
  },
  "error": null
}
```

Errors: 403 `report_not_allowed` · 403 `forbidden` · 422 `validation_error`.

`403 Forbidden`

```json
{
  "detail": {
    "code": "report_not_allowed",
    "message": "The Inventory Supervisor role can't generate the Sales Summary."
  }
}
```

#### `GET /reports/{id}`

The report and its status (`"Processing"`, `"Completed"` or `"Failed"`). A report fails when nothing
matches its filters:

```json
{
  "id": "RPT-024",
  "name": "Sales Summary",
  "format": "XLSX",
  "generatedAt": "2026-10-17T07:24:58.549Z",
  "userId": "USR-2091",
  "userName": "Omar Hassan",
  "roleId": 1,
  "status": "Failed",
  "filters": {
    "start": "2020-01-01",
    "end": "2020-01-31"
  },
  "error": "There is no matching data to export."
}
```

#### `GET /reports/{id}/file`

The file (section 7). 409 `report_processing` while it is still Processing, 409 `report_failed` if it failed.

```
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="sales-summary.pdf"

<232,876 bytes of application/pdf>
```

`409 Conflict`

```json
{
  "detail": {
    "code": "report_processing",
    "message": "The report is still being generated."
  }
}
```

#### `GET /reports`

The signed-in user's reports (the Admin: everyone's), newest first, in the shape above.

#### `POST /reports/email`

Generates a report and emails it. The demo backend only records the request; FastAPI sends the email.

| Field | Type | Rule |
|---|---|---|
| `name`, `format`, `filters` | | As in `POST /reports` |
| `recipients` | string[] | 1–20 valid email addresses |
| `subject` | string | Optional, up to 200 characters |
| `message` | string | Optional |

`POST /reports/email`

```json
{
  "name": "Sales Summary",
  "format": "PDF",
  "filters": {
    "start": "2025-03-19",
    "end": "2025-06-18"
  },
  "recipients": ["regional.lead@demandiq.test"],
  "subject": "Sales summary · June",
  "message": "This month's sales."
}
```

**202**:

```json
{
  "id": "MAIL-0001",
  "status": "Queued",
  "recipients": ["regional.lead@demandiq.test"],
  "name": "Sales Summary",
  "format": "PDF"
}
```

### 6.9 Logs — `activityService.js`

#### `GET /activity`

The audit log, newest first (written by the server, section 9). `status` is `"Completed"`, `"Failed"` or
`"Pending"`. `userId` and `roleId` are `null` for a failed sign-in with an unknown account; `sessionId` is
`null` outside a session.

```json
[
  {
    "id": "EVT-0090",
    "at": "2026-10-17T07:24:58.580Z",
    "sessionId": "SES-0014",
    "userId": "USR-2091",
    "userName": "Omar Hassan",
    "roleId": 1,
    "action": "Screen access denied",
    "module": "Authentication",
    "details": "#/administration · Store Manager",
    "status": "Failed"
  },
  {
    "id": "EVT-0089",
    "at": "2026-10-17T07:24:58.580Z",
    "sessionId": "SES-0014",
    "userId": "USR-2091",
    "userName": "Omar Hassan",
    "roleId": 1,
    "action": "Report emailed",
    "module": "Reports & Exports",
    "details": "Sales Summary · PDF → regional.lead@demandiq.test (with a message)",
    "status": "Pending"
  },
  "… 88 more"
]
```

#### `POST /activity`

For events only the browser sees. The only one in version 1 is **Screen access denied** (someone typed the
address of a screen their role can't open). Any other `action` is 422. `details` is cut to 200 characters.

`POST /activity`

```json
{
  "action": "Screen access denied",
  "details": "#/administration · Store Manager"
}
```

**201** — the new log row:

```json
{
  "id": "EVT-0090",
  "at": "2026-10-17T07:24:58.580Z",
  "sessionId": "SES-0014",
  "userId": "USR-2091",
  "userName": "Omar Hassan",
  "roleId": 1,
  "action": "Screen access denied",
  "module": "Authentication",
  "details": "#/administration · Store Manager",
  "status": "Failed"
}
```

#### `GET /sessions`

Sign-in sessions, newest first. `logoutAt` is `null` while the session is active (the app shows "Ongoing").

```json
[
  {
    "id": "SES-0016",
    "userId": "USR-1001",
    "loginAt": "2026-10-17T07:24:58.152Z",
    "logoutAt": null
  },
  {
    "id": "SES-0015",
    "userId": "USR-3381",
    "loginAt": "2026-10-17T07:24:58.152Z",
    "logoutAt": null
  },
  "… 14 more"
]
```

#### `GET /errors`

The error log, newest first. `severity` is `"Info"`, `"Warning"`, `"Error"` or `"Critical"`; `status` is
`"Open"`, `"Investigating"` or `"Resolved"`; `notes` is `null` until someone adds resolution notes.

```json
[
  {
    "id": "ERR-0014",
    "at": "2026-10-17T07:24:58.550Z",
    "module": "Reports & Exports",
    "type": "Export failure",
    "severity": "Warning",
    "message": "Sales Summary: There is no matching data to export.",
    "status": "Open",
    "notes": null
  },
  {
    "id": "ERR-0013",
    "at": "2026-10-17T07:24:58.188Z",
    "module": "Forecasting",
    "type": "Execution failure",
    "severity": "Error",
    "message": "PP-4012 · At least 21 historical periods are required to run this forecast.",
    "status": "Open",
    "notes": null
  },
  "… 12 more"
]
```

#### `PATCH /errors/{id}`

`status` (`"Open"`, `"Investigating"`, `"Resolved"`) and optional `notes` (up to 1,000 characters).
Returns the updated entry.

`PATCH /errors/ERR-0014`

```json
{
  "status": "Investigating",
  "notes": "Checking why the filters matched no sales"
}
```

```json
{
  "id": "ERR-0014",
  "at": "2026-10-17T07:24:58.550Z",
  "module": "Reports & Exports",
  "type": "Export failure",
  "severity": "Warning",
  "message": "Sales Summary: There is no matching data to export.",
  "status": "Investigating",
  "notes": "Checking why the filters matched no sales"
}
```

---

## 7. File uploads and downloads

### Upload: `POST /datasets`

- `multipart/form-data`, one file in the field **`file`** (the browser sets the `Content-Type` with its boundary).
- FastAPI: `async def upload(file: UploadFile = File(...))` — install `python-multipart`.
- **What the file is comes from its first bytes, not its name** (a CSV saved as `.xlsx` is read as text):

  | Contents | Read as |
  |---|---|
  | A zip (`50 4B 03 04`) | An Excel workbook (.xlsx, .xlsm). The worksheets are tried in order (hidden ones last) and the first that gives a valid record is used; when none does, the error is the one for the sheet with the most rows. Cells are read as text; a date cell is an Excel day number (`45834` = 2025-06-26). Not a readable workbook: 422 "This isn't a valid .xlsx file." Python: `openpyxl.load_workbook(…, read_only=True, data_only=True)` |
  | `D0 CF 11 E0` | Excel 97–2003: 415 "Excel 97–2003 (.xls) files can't be read. Save it as .xlsx or CSV and upload it again." |
  | `%PDF` | 415 "A PDF can't be read as sales data. Upload a CSV, text or Excel (.xlsx) file." |
  | A zero byte in the first 4 KB (and no UTF-16 byte-order mark) | 415 "Unsupported file type. Upload a CSV, text or Excel (.xlsx) file." |
  | Anything else | Delimited text: UTF-16 with its byte-order mark, else UTF-8 (a BOM is ignored), else Windows-1252. The delimiter is the one of `,` tab `;` `\|` that splits most of the first 25 non-empty lines into the same number of cells (a tie goes to more cells). Quoted cells may contain the delimiter, line breaks and doubled quotes |

- Up to **50 MB** (413 `file_too_large`) as a safeguard; the app doesn't mention a limit.

The reference for everything below is `importSales` in `src/lib/salesImport.js` (its tests,
`salesImport.test.js`, show each layout).

**Finding the columns**

1. Empty rows are ignored. The **header row** is the row among the first 15 that names at least two of a
   date, a product and a quantity column (the one naming the most). Rows above it — a title, notes — are
   skipped. Header names ignore case, spaces and punctuation: `Units Sold`, `units_sold` and `UNITS-SOLD` are
   the same.
2. Each column is matched by its name: exact names first, in the order listed (so `Region` wins over
   `State`), then names that contain a telling word. Columns with other names are ignored, however many
   there are.

   | Role | Exact names (abridged) | Or a name that contains |
   |---|---|---|
   | `date` (required) | Date, Sales Date, Sale Date, Order Date, Transaction Date, Invoice Date, Bill Date, Day, Datetime, Timestamp, Period, Posting Date, Datum, Fecha | `date` — but not ship, due, deliver, expir, birth, join, create, update, modif, start, end |
   | `units` (required) | Units Sold, Units, Quantity, Quantity Sold, Qty, Qty Sold, Sales Qty, Sales Units, Unit Sales, Quantity Ordered, Order Qty, Pieces, Pcs, Sold, Items Sold, Volume, Menge, Cantidad, Quantité | `qty`, `quantity`, `sold` — but not forecast, stock, inventory, return, price, cost, purchase, receiv, onhand, avail, reorder |
   | `product` (required) | A **SKU** column — SKU, Product ID, Product Code, Item ID, Item Code, Item No, Part No, Material Code, Article No, Stock Code, UPC, EAN, Barcode, ASIN, Code; else Product, Item, Article, Material; else a **name** column — Product Name, Item Name, Description, Particulars, Name, Title | `sku`, `barcode`; product / item / article / material / part ending in id, code, no, num, nbr, number or key |
   | `price` | Unit Price, Price, Selling Price, Sale Price, Price per Unit, Item Price, Price Each, Rate, MRP, List Price, Preis, Precio, Prix | `price` — but not competitor, purchase, cost, total |
   | `discount` | Discount Rate, Discount, Discount %, Disc % | starting `disc` |
   | `discountAmount` | Discount Amount, Discount Amt, Discount Value | `disc` with amount, amt or value |
   | `revenue` | Sales, Revenue, Net Revenue, Net Sales, Sales Amount, Amount, Total Amount, Total Sales, Net Amount, Line Total, Total, Turnover, Value | revenue, sales, amount, turnover — but not qty, unit, count, tax, cost, profit, margin, target, forecast, person, rep, channel |
   | `stock` | Stock, Stock Level, Stock on Hand, On Hand, Inventory, Inventory Level, Closing Stock, Current Stock, Available Stock, SOH | stock, inventory, onhand — but not order, forecast, out, value, cost |
   | `category` | Category, Product Category, Product Group, Product Family, Product Line, Product Type, Item Type, Department, Dept, Type | `categor` |
   | `region` | Region, Sales Region, Area, Zone, Territory, State, Province, Market, Country | region, zone, territor, province |
   | `location` | Location, Store, Store ID, Store Name, Warehouse, Branch, Outlet, Site, Shop, Depot, Plant, City | store, warehouse, branch, outlet, location, depot |
   | `channel` | Channel, Sales Channel, Order Channel, Distribution Channel | `channel` |

   The full lists are `ROLES` in `salesImport.js`. With both a SKU and a name column, the SKU column is the
   product and the name column names new products.
3. When a required role has no name:
   - **date**: the first column whose values are at least 80 % dates (written dates before bare numbers,
     which could be codes).
   - **units**: when the file has no price column, a revenue column whose name says `sales` or `sold` and
     whose values are at least 98 % whole numbers holds the units sold (as in `date,store,item,sales`).
   - **product**: a column whose values are at least 50 % known SKUs or product names; else the category
     column — its categories are then the products (as in a file with only `Product line`).
4. **No header row** (the first row has dates or numbers): the date, product and units columns are found
   by their contents (product: mostly text that repeats) and called `Column 1`, `Column 2` ….
5. **Dates across the top**: when no header row is found but a row among the first 15 has at least two
   dates as column names and no numbers, the sheet has one row per product and one column per day. Each
   filled cell under a date is that product's units that day (an empty cell is no entry, and `total` counts
   the entries). The other columns are read as above — the product is the first column of names when none
   is named — except revenue and discount amount, which would be the row's, not the day's.

When the date, product or units column can't be found, the file is rejected with the message "Couldn't
find … Columns in the file: …" (6.3).

**Reading the values**

| Value | Accepted |
|---|---|
| Dates | `2025-06-26` (also with `/` or `.`, and with a time after it), `26/06/2025`, `06/26/2025`, `26-06-25`, `26.06.2025`, `26 Jun 2025`, `26-Jun-2025`, `June 26, 2025`, `Thu, 26 Jun 2025`, `20250626`, an Excel day number from 18000 to 73000. Only real calendar dates from 1950 to 2100. A column is month-first (`06/26/2025`) when more of its values have a second number above 12 than a first number above 12; otherwise day-first (`05/06/2025` = 5 June) |
| Numbers | `1,234.50`, `1.234,50`, `12,5`, `₹ 1,248`, `USD 12.50`, `(5)` = −5, `1.5E-2`, `12%` |
| Units | A whole number, 0 or more |
| Price, revenue, discount amount | A number, 0 or more |
| Discount | A fraction from 0 to 1 (0.05 = 5 %) — or a percentage: a value written with `%`, and every value of a column that has any value above 1 (5 = 5 %). More than 100 % is unusable |

**Each data row** is excluded, and counted once, in this order when:

1. it repeats an earlier row exactly, every cell → `duplicates`
2. its date, product or units cell is empty → `missing`
3. its date can't be read → `invalidDates`
4. its units aren't a whole number ≥ 0 → `invalidNumeric`
5. a price, discount, revenue or discount amount is given but unusable → `invalidNumeric`

A row with `Total`, `Grand Total` or `Subtotal` as a whole cell sums the others: it's left out and not
counted at all.

**From rows to records** — one record per product and day:

- The product is the catalog's product whose SKU or name matches the product cell (or the name cell),
  ignoring case, spaces and punctuation (`pp 4012` is `PP-4012`). Otherwise it's a **new product**.
- A row's price is the price column; else revenue ÷ units ÷ (1 − discount); else the product's list price
  (0 for a new product without prices). A discount amount becomes the rate amount ÷ (units × price).
- **Rows for the same product and day are added up** into one record (several stores, or one row per sale):
  `units` is the sum; with gross = units × price and net = gross × (1 − discount) summed over the rows,
  `unitPrice` = gross ÷ units (2 decimals), `discountRate` = 1 − net ÷ gross (4 decimals) and
  `netRevenue = round(units × unitPrice × (1 − discountRate), 2)`. Each row after the first counts in
  `combined`.
- A record takes its category, location, region and channel from its product.

**New products** get: as `sku`, the file's ID in upper case when it looks like a code (letters, digits and
`. _ - /`, up to 40 characters), else one made from the name (`Bush Somerset Bookcase` →
`BUSH-SOMERSET-BOOKCASE`, then `-2`, `-3` … if taken); as `name`, the name cell, else the ID; as
`category`, `region`, `location` and `channel`, the value the file gives most often for that product, else
`Uncategorized` / `Unassigned`; as `unitPrice`, the median of its prices; as `stock`, the sum of its stock
column on the last date that has one, else 0. A file that names more than **10,000** new products is
rejected (usually the wrong column). The server adds them when the upload is accepted (section 8).

The file is **rejected** (422 `invalid_file`) when it is empty, a required column can't be found, it has a
header but no rows, or no row gives a record. Otherwise it is accepted (201) and the excluded rows are
reported as warnings (`validation: "2 warnings"`; combined rows aren't warnings). The records wait as the
dataset's pending records — they are not in `GET /sales` until a Data Analyst cleans the dataset.

### Downloads: `GET /reports/{id}/file`

- The body is the file itself, with `Content-Type` and
  **`Content-Disposition: attachment; filename="sales-summary.pdf"`** — the app saves the file under that name.
- FastAPI: `FileResponse(path, media_type=…, filename=…)` or `StreamingResponse` with the header set.
- If the frontend is served from another origin (no proxy), CORS must expose the header:
  `expose_headers=["Content-Disposition"]`, otherwise the browser hides the file name.

| Format | `Content-Type` | File name |
|---|---|---|
| CSV | `text/csv;charset=utf-8` (starts with a UTF-8 BOM so Excel opens it correctly) | `sales-summary.csv` |
| XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `sales-summary.xlsx` |
| PDF | `application/pdf` | `sales-summary.pdf` |

The file name is the report name in lower case with dashes. Every format has one header row with the
column names below and one row per record. The PDF (A4 landscape) also has a title band, these three
lines under the title, page numbers, and at most 2,000 rows (it then says to use XLSX or CSV):

```
Date range: 2025-03-19 to 2025-06-18
Category: All · SKU: All · Region: Central · Model: All
Generated by Omar Hassan (Store Manager)
```

**Columns per report type** (reference: `buildReportRows` in `src/lib/reports.js`):

| Report | One row per | Columns |
|---|---|---|
| Sales Summary | Filtered sales record | Date, SKU, Category, Region, Warehouse, Channel, Units, Net Revenue, Current Stock |
| Sales by Region | Region in the filtered sales | Region, Units, Net Revenue |
| Product Performance Report | Product with sales, by net revenue | SKU, Product, Category, Units, Net Revenue |
| Demand Forecast Report | Point of the newest saved run | Date, SKU, Model, Forecast Units |
| Forecast Accuracy Report | Saved run (filter `model` applies) | Model, SKU, Horizon, MAE, RMSE, MAPE, Executed |
| Inventory Status Report | Filtered product | SKU, Product, Category, Region, Warehouse, Current Stock, 30-day Demand, Reorder Level, Safety Stock, Suggested Reorder, Days Left, Status |
| Reorder Recommendation Report | Reorder (if any; otherwise the Inventory Status rows) | Order, SKU, Quantity, Supplier, Ordered, Ordered By, Delivered, Status |
| Data Quality Report | Dataset | Dataset, Uploaded, Uploader, Records, Validation, Missing, Duplicates, Invalid, Cleaning, Outliers Capped, Forecasting, Products Forecast |
| User Activity Report | Activity row | Timestamp, User ID, User, Role, Action, Module, Details, Status |
| System Error Report | Error-log row | Error ID, Timestamp, Module, Type, Severity, Message, Status |

A CSV example (`Sales by Region`):

```
HTTP/1.1 200 OK
Content-Type: text/csv;charset=utf-8
Content-Disposition: attachment; filename="sales-by-region.csv"

"Region","Units","Net Revenue"
"East","37543","9460808.36"
"North","6953","1242265.26"
"West","14127","5132673.82"
```

---

## 8. Business rules the server owns

The browser no longer calculates these; the server does. The demo backend's versions are the reference
(file and function in brackets). Matching them exactly matters most for the inventory formulas; forecast
numbers from a Python library (e.g. `statsmodels` for ARIMA) may differ slightly, which is fine as long as
the response shape and the rules below hold.

### Inventory (`deriveInventory`, `applyForecastToInventory` in `src/lib/domain.js`)

- `status`: **Critical** if `stock ≤ 1.15 × safety`; otherwise **Warning** if `stock < reorder`; otherwise **Safe**.
- `suggested`: 0 when Safe; otherwise `max(0, round(demand + safety − stock))`.
- `days`: `max(1, round(stock ÷ (demand ÷ 30)))`.
- After a forecast run, the product's `demand` becomes `max(1, round(average predicted units per day × 30))`
  and `status`, `suggested` and `days` are recalculated.
- Stock updates and delivered reorders also update the **current month's** snapshot (`GET /inventory/snapshots`).

### Reorders (`src/services/mock/routes/inventory.js`)

- Ordered → Delivered only (6.6). **Delivered** sets `deliveredAt` and adds `quantity` to the product's
  `stock`, then recalculates `status`, `suggested` and `days` with the rules above.

### Products added from an upload (`addNewProducts` in `src/services/mock/routes/sales.js`, `inventoryForNewProduct` in `src/lib/domain.js`)

When an upload is accepted, each new product (section 7) joins the catalog:

- Its category is the existing one with that name (ignoring case), else a new category: the next `CAT-`
  ID, `description` "Added from *file name*", `status` Active. Its records take the category's name.
- With `perDay` = its units in the file ÷ the days from its first to its last date (both included):
  `safety = max(1, round(perDay × 7))`, `reorder = max(safety + 1, round(perDay × 14))`,
  `demand = max(1, round(perDay × 30))`. `stock` comes from the file (else 0), `unitCost` is `null`, and
  `status`, `suggested` and `days` follow the inventory rules above.
- The current month's snapshot gets its row, the dataset's `newProducts` lists it, and the audit log gets
  one `Products added` row for the upload.

### Forecasting (`runForecast` in `src/lib/domain.js`, `src/lib/arima.js`)

1. History = the product's units per day from `startDate` to `endDate`, **every day included** (0 on days without sales).
2. At least **21 days** are needed; otherwise 422 `forecast_failed` ("At least 21 historical periods are
   required to run this forecast."). ARIMA(p,d,q) also needs at least `3 × (p + d + q) + 10` days to fit —
   for the accuracy test, counted before the held-back days.
3. Accuracy: the last `min(14, floor(days ÷ 4))` days are held back. The model is fitted on the earlier
   days, predicts the held-back days (negative predictions count as 0), and MAE, RMSE and MAPE are measured
   on them. MAPE is `null` if a held-back day had 0 units. `evaluation.holdoutDays` reports the count.
4. The future: the model is fitted on the whole history and predicts `horizon` days after `endDate`;
   each prediction is rounded to a whole number and never below 0.
5. Models: **Moving Average** — average of the last `windowSize` days, rolled forward one day at a time
   (each prediction joins the window). **Linear Regression** — least-squares line over the day number;
   `configuration.slope` is its slope (4 decimals). **ARIMA(p,d,q)** — differencing `d` times, `p`
   autoregressive and `q` moving-average terms.
6. The run is saved with its lineage (below). It doesn't change any dataset.

### Model recommendation (`compareModelsForProducts` in `src/lib/domain.js`)

- Each of the three models is run on every product with horizon 30, window 7 and order (2,1,2), using the
  sales that match the filters, over the filter dates.
- Test days = `min(14, floor(days in the range ÷ 4))`; fewer than **7** → no recommendation.
- A model is *eligible* only if it could be tested on every product. Fewer than two eligible models → no
  recommendation.
- Metric: **MAPE** if every eligible model has it for every product, otherwise **MAE**.
- Each model's metric is the average over the products. Eligible models are ranked by that average
  (lower is better; RMSE breaks ties). `wins` counts the products on which each model was best.
- `margin = (runner-up − best) ÷ runner-up`; `close = margin < 0.03`.
- The app asks about at most 30 products per demand type, those that sold the most units in the date
  range, so a large catalog doesn't mean thousands of model fits per request.

### Cleaning (`cleanDataset` in `src/lib/domain.js`)

- **Cap outliers** (`capOutliers: true`): for each product in the upload, take the units of its existing
  sales plus the upload (only when there are at least 8 values). Upper limit =
  `Q3 + 3 × max(Q3 − Q1, 1)` (quartiles with linear interpolation). Larger values are set to the rounded
  limit and `netRevenue` is recalculated. `outliersCapped` counts them.
- **Overlap**: a record whose date and product already exist either replaces the existing one
  (`"replace"`, counted in `replaced`) or is dropped (`"skip"`, counted in `skipped`). New records are counted in `added`.
- The dataset becomes `cleaning: "Completed"`, its pending records are merged into the sales data, and
  `cleaningSummary` records `inputRecords`, `excludedAtValidation`, `outliersCapped`, `replaced`,
  `skipped`, `added`, `cleanedBy` and `cleanedAt`.

### Dataset lineage (`src/lib/lineage.js`)

Forecasts run on the **shared, cleaned sales history** of one product over a date range — not on one chosen
upload. Several uploads usually feed one forecast, and one upload usually feeds forecasts for many
products. Lineage records that link:

1. **Every sales record keeps the ID of the upload it was cleaned from** (`datasetId`). Uploaded records
   get it when the file is accepted; cleaning merges them into the history with it. A record that replaces
   an existing one (`overlap: "replace"`) brings its own upload's ID; with `"skip"` the existing record and
   its ID stay.
2. **A forecast saves its lineage when it runs**: the sales records it used grouped by `datasetId`
   (`sources`, with records, first and last date), and the uploads still waiting for cleaning that have
   sales for the same product inside its range (`waiting`). It is a snapshot: if a later upload replaces
   records, the saved run still shows what it used.
3. **An upload's forecasting status is worked out from the saved runs' lineage**, product by product:

   | Status | When |
   |---|---|
   | `Not started` | The upload failed validation |
   | `Pending` | Not cleaned yet, or no saved run has used its records yet |
   | `Partial` | Saved runs used its records for some of its products, not all |
   | `Completed` | Saved runs used its records for every product it has in the history |
   | `Not needed` | Cleaned, but none of its records are in the history (all duplicates skipped, or all replaced before any run used them) |

   "Its products" = the products it still has in the history, plus any already forecast with its records
   (so an upload whose records were later replaced keeps the credit for the forecasts that used them).
   `forecastedAt` = when the first run that used it was saved.
4. A forecast for one product, or for a date range outside an upload's dates, never changes that upload's
   status — the bug in the first version, where every cleaned upload was marked forecasted after any run.

In the database (`backend-seed/`, section 13), lineage is two things: `sales_records.dataset_id`, and
`forecast_sources` — one row per upload a run used (`kind = 'used'`) or found waiting (`'waiting'`), with
its records and first and last date. The view `dataset_view` works out each upload's `forecasting`,
`forecastedAt` and `lineage` from them with the rules above.

### Dataset pipeline

Upload accepted → `cleaning: "Pending"` → cleaned (its records join the shared history) →
`forecasting: "Pending"` → saved runs use its records → `"Partial"` → every product forecast with them →
`"Completed"`. A rejected upload is `validation: "Failed"` with `cleaning` and `forecasting` `"Not started"`.

### Users and access

- At least one **active Admin** must always exist (`409 last_admin`).
- New accounts get their employee ID and work email from the server (6.7).
- The Admin only views Sales Data, Inventory and Forecasting (section 4).
- Nobody can deactivate their own account (`own_account`) or change their own role (`own_role`).
- Locked permissions and screens are listed in section 4.

---

## 9. Audit log and error log

The **server** writes the audit log as things happen — the app never writes it, except the one browser-only
event (`POST /activity`). Each row records the user, their role, the session and the time.

| `action` | `module` | `status` | Written by |
|---|---|---|---|
| User login | Authentication | Completed | `POST /auth/login` |
| Sign-in failed | Authentication | Failed | `POST /auth/login` (every refused sign-in) |
| User logout | Authentication | Completed | `POST /auth/logout` |
| Password reset requested | Authentication | Completed | `POST /auth/password-reset` (known emails only) |
| Screen access denied | Authentication | Failed | `POST /activity` (from the browser) |
| Dataset uploaded / Dataset upload failed | Sales Upload | Completed / Failed | `POST /datasets` |
| Products added | Sales Upload | Completed | `POST /datasets`, when the file added products (details: `retail_store_inventory.csv · P0001, P0002` — up to 10 SKUs, then `and N more`) |
| Data cleaned | Sales Upload | Completed | `POST /datasets/{id}/clean` |
| *Model* forecast executed / *Model* forecast failed | Forecasting | Completed / Failed | `POST /forecasts` (details name the product, the horizon and the uploads used) |
| Stock quantity updated | Inventory | Completed | `PATCH /inventory/{sku}` |
| Reorder placed | Inventory | Completed | `POST /reorders` (details: `RO-0004 · PP-4012, 600 units`) |
| Reorder delivered | Inventory | Completed | `PATCH /reorders/{id}` (details add `· stock now N`) |
| *Report* exported / *Report* export failed | Reports & Exports | Completed / Failed | when a report finishes |
| Report emailed | Reports & Exports | Pending | `POST /reports/email` |
| User created / User updated / User account activated | Admin Panel | Completed | `POST`, `PATCH /users` |
| Category created / Product category updated | Admin Panel | Completed | `POST`, `PATCH /categories` |
| Role modified | Admin Panel | Completed | `PATCH /roles/permissions` |
| Screen access changed | Admin Panel | Completed | `PUT /roles/{roleId}/screens` (one row per changed screen) |
| Role permissions restored | Admin Panel | Completed | `POST /roles/restore-defaults` |
| Error status updated | Admin Panel | Completed | `PATCH /errors/{id}` |

The Admin dashboard counts these rows per module (Authentication, Forecasting, Inventory, Sales Upload,
Reports & Exports), per role and per user, so keep the `module` names and `status` values exactly as above.

The **error log** gets a row (status `Open`) when:

| `module` | `type` | `severity` | When |
|---|---|---|---|
| Sales Upload | Invalid file | Error | An upload is rejected |
| Forecasting | Execution failure | Error | A forecast run fails |
| Reports & Exports | Export failure | Warning | A report fails |

---

## 10. Demo-only endpoints (do not implement)

The demo backend has two extra public endpoints for the sign-in page's **View demonstration accounts**
dialog. FastAPI must **not** implement them — a real server never sends passwords. In live mode the app
doesn't call them.

| Endpoint | What it does |
|---|---|
| `GET /demo/accounts` | The demonstration accounts **with their passwords**, role IDs and status |
| `POST /demo/reset` | Puts all demo data back to `src/data/seed.js` (204) |

---

## 11. Connecting the React app to FastAPI

Create a file named `.env.local` next to `package.json` (copy `.env.example`):

```bash
VITE_API_MODE=live      # "demo" (default) = the in-browser demo backend; "live" = FastAPI
VITE_API_URL=/api       # where FastAPI is; /api is forwarded to http://localhost:8000 by vite.config.js
```

Then restart `npm run dev`. Nothing else changes: the same pages, store and services run in both modes.

- **Development (recommended):** run FastAPI on port 8000 with every route under `/api`. Vite forwards
  `/api/…` to it, so the browser sees one origin and no CORS setup is needed.
- **Another origin:** set `VITE_API_URL=http://localhost:8000/api` and enable CORS in FastAPI:

  ```python
  from fastapi.middleware.cors import CORSMiddleware

  app.add_middleware(
      CORSMiddleware,
      allow_origins=["http://localhost:5173"],
      allow_methods=["*"],
      allow_headers=["Authorization", "Content-Type"],
      expose_headers=["Content-Disposition"],
  )
  ```

- **Production:** serve the built app (`npm run build` → `dist/`) and the API from the same site, with
  `/api` routed to FastAPI.

A quick check that the two sides agree:

1. `POST /api/auth/login` with a demo account returns the shape in 6.1 and the app opens the right dashboard.
2. Refresh the page: `GET /api/auth/me` keeps you signed in on the same screen.
3. Sign in as each role and open every screen; check the browser's Network tab for 4xx answers.
4. Upload sales files (CSV and Excel, in your own layouts, one with new products), clean one, run a
   forecast, place and deliver a reorder, generate a report in each format.

---

## 12. Changes from the integration note

The integration note's examples were a starting point. The contract above differs where the app needed
more, and the differences are deliberate:

| The note | This contract | Why |
|---|---|---|
| `authService.login({ login, password })` | `{ login, password, roleId, remember }` | Sign-in checks the account's assigned role, and Remember me sets the session length |
| Login returns a token | Also returns `user`, `permissions`, `screens`, `session`, `expiresAt` | The app builds the menus and enables actions from them; `GET /auth/me` returns the same after a refresh |
| `"forecastId": "FC-001"` | `"id": "FC-0011"` | Every resource uses `id` |
| Forecast request `{ sku, model, horizon, startDate, endDate }` | Plus `windowSize` (Moving Average) or `order` `[p, d, q]` (ARIMA) | The Forecasting page lets the user set them |
| Forecast response `metrics` and `points[].predicted` | Kept, plus `startDate`, `endDate`, `configuration`, `evaluation.holdoutDays`, `generatedAt`, `generatedBy`; `metrics.mape` can be `null`; `predicted` is a whole number ≥ 0 | Run history, accuracy labels and the chart need them; MAPE can't be calculated when a test day had no sales |
| "Get model results" | `POST /forecasts/compare` and `POST /forecasts/recommendation` | Compare models on the Forecasting page; the per-demand-type recommendation on the Data Analyst dashboard |
| "Role-specific dashboard summaries" | `GET /dashboard/summary` returns KPI objects with a raw `value` and a `format` | The server calculates, the app formats |
| "Download PDF/CSV" | PDF, XLSX and CSV, generated in the background (202, then polling) | The Reports page offers all three; large reports shouldn't block a request |
| "Activity logs, error logs, resolve errors" | Plus `GET /sessions` and three error statuses (Open, Investigating, Resolved) with notes | The activity log shows each event's session; the error drawer has Mark investigating and Mark resolved |
| "Roles, screen permissions" | Two separate settings: screen access (`/roles/screens`) and action permissions (`/roles/permissions`) | A role can open a screen but only view it (e.g. Forecasting without Run forecasts) |
| Forecast from one dataset, or from the shared history? (review, option B) | Shared cleaned history, with lineage: `datasetId` on sales records, `lineage` on runs, `GET /forecasts/lineage`, and dataset `forecasting` worked out product by product | Uploads are merged into one history, so a forecast can draw on several of them; lineage shows which, and only uploads a run actually used change status |
| "If the endpoint doesn't exist yet, the requests won't succeed" | The demo backend answers every request in demo mode | The app stays usable and testable until FastAPI is ready, with one setting to switch |

---

## 13. Database and demo data: `backend-seed/`

`backend-seed/` is the demo backend's starting data as a PostgreSQL database — every record the app shows in
demo mode, with the same IDs and values — so FastAPI can start from the same data and the app looks the
same in live mode.

| File | What it is |
|---|---|
| `schema.sql` | Every table, with keys, foreign keys, checks and ID sequences (new IDs continue in the app's format: FC-0012, RPT-022 …), and views that work out the calculated fields — inventory status, suggested order and days of cover, products per category, each upload's validation label, pending count and forecasting status — with the rules in section 8 |
| `seed.sql` | Every row, in load order; the demo passwords are hashed with bcrypt |
| `csv/`, `json/`, `manifest.json` | The same rows per table, for another database or a loader script |
| `DATA_DICTIONARY.md` | Every column, and the API field it becomes |
| `README.md` | How to load it (psql, pgAdmin, Docker), the demo accounts, and what to decide |

Load it: `psql -U postgres -d demandiq -v ON_ERROR_STOP=1 -f schema.sql -f seed.sql`.

The files are generated from `src/data/seed.js` by `npm run export:seed` (`scripts/backend-seed/`), so when
the demo data changes, export again rather than editing them. Loaded into PostgreSQL, the views return the
same values as the demo backend's `GET /inventory`, `/categories`, `/sales`, `/datasets` and `/forecasts`
and the same effective permissions as `/auth/me`.

For 1.2, reorders are in the table `reorders` (Ordered or Delivered; it replaces `reorder_requests`, which
`schema.sql` drops when it runs again). Products that an upload adds are rows in `products` with
`added_from` set to the dataset and `unit_cost` NULL; `datasets.combined_rows` holds `checks.combined`, and
`dataset_view.new_products` gives `newProducts`.
