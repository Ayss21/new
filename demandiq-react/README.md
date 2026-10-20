# DemandIQ — Demand Forecasting & Inventory Management (React frontend)

A plain React (JavaScript + CSS, built with Vite) version of the DemandIQ Figma Make prototype. No TypeScript, no CSS framework. It keeps
the same screens, styles and behaviour, split into components and pages, and adds the
parts the prototype only mocked so it covers the full problem statement.

## Run it

You need **Node.js 20 or newer** (check with `node -v`).

```bash
npm install
npm run dev        # opens on http://localhost:5173
```

Other commands:

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build
npm test           # unit tests: forecasting, ARIMA, cleaning, CSV / Excel validation, filters,
                   # role IDs and screen access, sign-in, demand classification, activity
                   # summaries, monthly inventory trends, chart data, pagination, plus the
                   # API layer: HTTP client, token storage, services and every endpoint of
                   # the demo backend (status codes, errors, permissions), and the backend
                   # seed's tables (unique keys, references that exist)
npm run export:seed  # writes backend-seed/: the demo data as a PostgreSQL database for the
                     # backend team (see "Seed data for the backend" below)
```

The app talks to its backend only through an API (see **Backend and API** below). Out of the box it
runs in **demo mode**: a demo backend inside the browser answers every request, so no server is needed.

## Demo accounts

| Role (ID) | Email | Employee ID | Password | Status |
|---|---|---|---|---|
| Store Manager (1) | store.manager@demo.demandiq | USR-2091 | Store123! | Active |
| Data Analyst (2) | analyst@demo.demandiq | USR-1042 | Analyze123! | Active |
| Inventory Supervisor (3) | inventory@demo.demandiq | USR-3381 | Stock123! | Active |
| Admin (4) | admin@demo.demandiq | USR-1001 | Admin123! | Active |
| Store Manager (1) | former.manager@demo.demandiq | USR-2107 | Former123! | Inactive (sign-in is refused) |
| Data Analyst (2) | new.analyst@demo.demandiq | USR-1188 | Welcome123! | Pending activation (sign-in is refused) |

On the sign-in page, **View demonstration accounts** lists these accounts with their live status
and screen IDs; clicking one fills in the form. **Reset demo data** in that dialog puts accounts,
role permissions and screen access back to the defaults above.

There is no sign-up page: every account is created by the Admin (Administration → User
Management → Add user). The Admin types the name and picks the department, role, status and a temporary
password; the server gives the account its employee ID (the next USR- number) and work email
(first.last@ the company's domain), shown when the user is created.

## Sign-in and screen access

Sign-in goes through the API like everything else: the sign-in page calls `authService.login`
(`POST /auth/login`) with the email or employee ID, the password and the **role ID** picked on the page.
The server answers with a token, the user, the role's permissions and its screen IDs.

> **In demo mode this is a demonstration of authentication and permissions, not a secure system.**
> The demo backend runs in the browser, so its accounts, passwords and permissions can be read or
> changed with the browser's developer tools. With `VITE_API_MODE=live` the FastAPI backend verifies
> every sign-in and every request (hashed passwords, tokens it can revoke, a permission check on each
> request), as described in `docs/API_CONTRACT.md`. Only demo mode offers **View demonstration accounts**.

**Sign-in checks** (made by the server, in this order):

1. The email or employee ID and the password must match an account. A wrong password and an
   unknown account get the same message: "Invalid user ID or password."
2. The account must be **Active**. Inactive and Pending-activation accounts are refused.
3. The selected **role** must be the role assigned to the account ("This account isn't registered
   as a Data Analyst.").

Empty fields and the fields at fault are highlighted. Every refused sign-in is recorded in the
Activity Log.

**Role ID → screen IDs.** Role IDs are defined once in `src/lib/roles.js` (1 Store Manager,
2 Data Analyst, 3 Inventory Supervisor, 4 Admin). Every screen has an ID and an address in
`src/navigation.js` (`SCREENS`), and the default access is one explicit map:

```js
// src/navigation.js
export const ROLE_SCREEN_ACCESS = {
  [ROLE.STORE_MANAGER]: ["SCR-01", "SCR-02", "SCR-04"], // role ID 1
  [ROLE.DATA_ANALYST]: ["SCR-01", "SCR-02", "SCR-04", "SCR-05"], // role ID 2
  [ROLE.INVENTORY_SUPERVISOR]: ["SCR-01", "SCR-03", "SCR-04"], // role ID 3
  [ROLE.ADMIN]: ["SCR-01", "SCR-02", "SCR-03", "SCR-04", "SCR-05", "SCR-06"], // role ID 4
};
// SCR-01 Dashboard · SCR-02 Sales Data · SCR-03 Inventory · SCR-04 Reports & Exports
// SCR-05 Forecasting · SCR-06 Administration
```

The server keeps the current map (the Admin can change it) and sends the signed-in role's screen IDs
with the sign-in. `canOpenPage(access, roleId, page)` answers "can this role open this screen?",
`topNavFor` builds the tabs from the same list, and the store's `canOpen(page)` applies it.

- After signing in, every role lands on its **dashboard** (SCR-01).
- The top navigation, the Admin's module menu, buttons that lead to another screen, and the
  address bar only open screens in the user's list. Typing the address of any other screen
  (for example `#/administration` as a Store Manager) is refused with a message, logged as
  "Screen access denied", and the user stays where they were.
- The Admin edits the map in **Administration → Role Permissions → Edit permissions** (tick boxes,
  plus **Restore defaults**). Two cells are fixed: every role keeps SCR-01 Dashboard, and only the
  Admin has SCR-06 Administration, so nobody can lock the access settings away.
- What a role may do **on** a screen is the separate **Action permissions** matrix (upload, clean,
  run forecasts, update inventory, generate reports …). An action only counts on a screen the role
  can open. If a role can open a screen but not its action, the screen is view-only: for example
  Forecasting without "Run forecasts" shows results but disables Run forecast and Compare models.
- **The Admin only views** Sales Data, Inventory and Forecasting: upload and clean, stock update, Place
  reorder and Mark delivered, and Run forecast / Reset / Run again are visible but switched off. These
  levels are locked in the matrix (the server enforces them); Reports stay usable.
- The server checks the permission on every request, so a hidden button is never the only protection.

**Refreshing the page**

- Signed in: you stay signed in on the same screen (each screen has its own address, such as
  `http://localhost:5173/#/forecasting`). The app keeps the sign-in token and asks the server who you
  are (`GET /auth/me`). If the session has expired, or the Admin has since deactivated the account or
  changed its role, you are signed out and the sign-in page explains why. If your role can no longer
  open that screen, you see your dashboard with a message. If the server can't be reached, a screen
  says so and offers **Try again**.
- Signed out: you stay signed out.
- **Remember me** keeps you signed in for 7 days, even after the browser closes. Without it the
  session lasts for that tab only (up to 8 hours).
- Data is kept by the backend. In demo mode the demo backend saves everything (accounts, permissions,
  uploads, forecasts, stock, reports, logs) in this browser's IndexedDB, which has room for big uploads, so
  it survives a refresh and is shared by every tab. **Reset demo data** in the demonstration-accounts dialog puts it all back to
  `src/data/seed.js`.
- The browser's Back and Forward buttons move between screens.

## Navigation

- **Admin:** Dashboard | module menu | Administration. The menu is a dropdown of Sales Data, Inventory,
  Reports & Exports and Forecasting, with no label of its own: it shows the open module, or **Sales Data**
  (greyed, as a placeholder) on the other screens. The breadcrumb reads `Workspace / <module>`.
- **Other roles:** Dashboard plus their own modules as separate tabs —
  Store Manager: Sales Data, Reports & Exports · Data Analyst: Sales Data, Forecasting,
  Reports & Exports · Inventory Supervisor: Inventory, Reports & Exports.
- Tabs come from the role ID → screen IDs map above, so they change when the Admin changes it.

**Global filters** apply to every page: Date range (Last 30 Days, Last 3 Months, Last 6 Months or
Custom Range with From / To dates), product category, SKU, region and forecasting model. Category, SKU,
region and model take several values (nothing ticked = all), and so do the pages' own filters (dataset
action and status, report status, inventory status, months, modules). Changes take effect with
**Apply filters**.

## Sales file uploads

Any sales file works; there is no template.

- **Files**: CSV, TSV or text (comma, tab, semicolon or `|`), or an Excel workbook (.xlsx — the first sheet
  with sales on it). The type comes from the contents, not the name. A PDF, an old `.xls` or another file
  gets a message saying what to upload instead.
- **Columns** are found by their names, in any order and among any number of other columns: a date (Date,
  Order Date, Invoice Date …), a product (SKU, Product ID, Item Code, Product Name, Description …) and a
  quantity (Units Sold, Quantity, Qty …). Price, discount, sales amount, stock, category, region, store and
  channel are used when the file has them. Titles above the header are skipped; a file without a header,
  or with the dates across the top, is read by its contents.
- **Values**: dates such as 2025-06-26, 26/06/2025, 06/26/2025, 26-Jun-2025 or Excel dates (day first unless
  the column shows otherwise); numbers with ₹ or $, thousands separators or %.
- **Rows** for the same product and day (several stores, one row per sale) are added up. Exact repeats and
  rows that can't be read are left out and counted.
- **New products** join the catalog with their category, the stock the file gives (else 0), and a reorder
  level and safety stock worked out from their sales. Their unit cost is unknown.
- When nothing can be used, the message says which column is missing or why the rows failed.

The rules in detail are in `docs/API_CONTRACT.md` (section 7) and the code in `src/lib/salesImport.js`.

## Try the full workflow

1. **Admin** → Administration → User Management → **Add user** (choose the role) → sign out and
   sign in with the new account.
   Then try the access rules: Role Permissions → **Edit permissions** → tick SCR-05 Forecasting
   for the Store Manager → sign in as the Store Manager. Forecasting is now a tab, view-only
   because the Store Manager's "Run forecasts" is View. Type `#/administration` at the end of the
   address: it is refused. Refresh: you stay on the same screen.
2. **Store Manager** → Sales Data → **Upload sales data** → choose a sales file → **Upload**. Any layout
   works (details below): CSV, TSV or text with any delimiter, or an Excel workbook; any number of
   columns, in any order, named the way the file names them. Products the catalog doesn't have are added
   (the dataset details list them). Dataset history lists every attempt: Action **Uploaded** or
   **Failed**, Status **Forecasted** once forecasts have used the upload for all its products, otherwise
   **Not Forecasted**.
3. **Data Analyst** → Sales Data → "Waiting for cleaning" (oldest first) → **Clean** → Run forecast.
   A sample upload (`sales_jun_19_25_2025.csv`, DS-0007) is already waiting, with one keying error to
   catch. Cleaning merges its records into the shared sales history; each record keeps the ID of its upload.
   When a file's dates are outside the date range in the filters (an older file), **Show these dates**
   (or Run forecast) switches the range to them; the Forecasting page offers the same.
4. **Data Analyst** → Dashboard → **Demand type distribution** (pie of products per demand type) → hover
   a demand type: a tooltip names the recommended model. The server tests Moving Average, Linear
   Regression and ARIMA on the same products and held-out days (the last 14 days of the range) and picks
   the lowest average MAPE, or MAE when days without sales make MAPE impossible.
5. **Data Analyst** → Forecasting → pick the horizon (7, 14, 30, 60 or 90 days) → **Run forecast** →
   chart, MAE / RMSE / MAPE and run history. The product and the model come from the global filters
   (one SKU / one model; with several models, the most accurate of them is chosen by comparing them).
   One sentence names the dataset used. Forecasts use the shared, cleaned history of the product over
   the date range; every saved run keeps its lineage, so an upload's status changes only when a run used
   it, product by product.
6. **Inventory Supervisor** → Dashboard: **Inventory status** filter (several statuses), Monthly
   inventory trends with several months (four fit; more scroll sideways). Inventory → **Review** a
   product → Update stock or **Place reorder**. **Reorder status**: an order is **Ordered** when it is
   placed; **Mark delivered** → **Delivered** adds the quantity to the stock and the status is worked out
   again everywhere.
7. **Admin** → the module menu → each module, view-only. Dashboard (module activity, user activity for
   every user, recent events) → Administration → users, categories, role permissions, activity log with
   sessions, error log.
8. Any role → Reports & Exports → choose a report and PDF, Excel (XLSX) or CSV → Generate report.
   The report appears in Report history as Processing, then Completed (or Failed).

## Demo data

All demo data is in `src/data/seed.js` and every figure on screen is calculated from it:

- Six months of daily sales, 19 Dec 2024 – 18 Jun 2025, for 11 products with four demand
  patterns (5 smooth, 2 erratic, 2 intermittent, 2 lumpy). The default date range is the last 3 months.
  The history came from four cleaned uploads (DS-0002 Dec–Mar, DS-0003 April, DS-0004 May, DS-0005
  1–18 June); every record keeps its upload's ID, and the uploads' record counts are counted from it.
- Eleven saved forecast runs (one per product, 19–25 Jun), each with its lineage, so the four history
  uploads start as Forecasted for all 11 products and DS-0007 (19–25 Jun) waits for cleaning.
- Month-end inventory snapshots (Dec 2024 – Jun 2025) for the Monthly inventory trends chart, and
  three reorders (RO-0003 and RO-0002 Ordered, RO-0001 Delivered).
- Five categories; how many products each has is counted from the products.
- Users with role IDs, sessions and an activity log (including failed events), report history and
  error log, numbered in time order. The demo "today" is about 26 Jun 2025;
  events you create in the app use the real current time.
- `npm run export:seed` writes the same data as database tables for the backend (below).

## Project structure

```
src/
  App.jsx                    App shell: startup check, sign-in page or workspace; which screen is shown,
                             address bar, Back/Forward, refused screens
  navigation.js              Screens (SCR-01…06) and their addresses, ROLE_SCREEN_ACCESS
                             (default role ID → screen IDs), access checks, top navigation
  services/                  Every call to the backend (see docs/API_CONTRACT.md)
    api.js                   HTTP client: token, JSON, uploads, downloads, errors, demo/live mode
    tokenStore.js            Where the sign-in token is kept between page loads
    query.js                 Global filters → query parameters
    authService.js           Sign in, current user, sign out, roles, password reset
    dashboardService.js      KPI cards per role
    salesService.js          Sales, file upload (any layout), datasets (= dataset history), cleaning
    forecastService.js       Run, list and compare forecasts; model recommendation
    inventoryService.js      Stock, stock updates, alerts, month-end snapshots
    reorderService.js        Reorders: Ordered → Delivered
    adminService.js          Users, categories, action permissions, screen access
    reportService.js         Generate (background + polling), download, email, history
    activityService.js       Activity log, sessions, error log
    demoService.js           Demo mode only: demonstration accounts, reset
    mock/                    The demo backend: the same API, answered inside the browser
      server.js              Route table (a map of the whole API) and request handling
      db.js                  Its database, saved in this browser
      http.js                Errors, permission checks, audit logging
      routes/                One file per area: auth, dashboard, sales, forecasts, inventory,
                             admin, reports, activity, demo
  store/
    AppStore.jsx             Shared state: sign-in, loaded data, actions that call the services
                             (each returns { ok, data } or { ok: false, error })
    useRequest.js            Loading / error / retry for data one page needs (KPIs, recommendation)
    WorkspaceContext.jsx     UI actions: go to page, open export dialog, open drawer
  lib/
    roles.js                 Role IDs 1–4 and their names (defined once)
    permissions.js           Locked action permissions (the Admin's view-only levels)
    domain.js                Business logic: filters, forecasting, cleaning, sign-in checks, chart
                             series, date presets, demand classification, monthly inventory trends
    dashboard.js             KPI definitions per role (used by the demo backend) and KPI formatting
    lineage.js               Dataset lineage: which uploads a forecast used; uploads' forecasting status
    reports.js               What goes into each report
    salesImport.js           Reads a sales file of any layout into daily records (columns by name,
                             new products, rows added up per product and day)
    xlsx.js                  Reads the sheets of an Excel upload (no library)
    activity.js              Activity summaries for the Admin dashboard, session time
    arima.js                 ARIMA(p,d,q)
    exporters.js             CSV / XLSX / PDF files, saving downloaded files
    format.js                Date, date-range and plural formatting
  data/seed.js               Demo data: users, permissions, sessions, activity, datasets, reports,
                             forecast runs, reorders, month-end inventory snapshots
  components/
    ui/                      Icon, Button, Field, Select, MultiSelect, Status, Card, Modal, Kpi,
                             TableFooter, SearchBox, EmptyState, DataLineChart, ColumnChart, PieChart,
                             PipelineTracker
    layout/                  TopHeader, TopNav (+ the Admin's module menu), FilterSidebar, Toast
    modals/                  ExportModal, StockModal, ReorderModal
    Drawer.jsx               Inventory / activity / error detail drawer
  pages/
    LoginPage.jsx            Sign-in (with role), demonstration accounts, forgot password
    dashboard/               DashboardPage + one file per role dashboard, MonthlyInventoryTrends
    SalesUploadPage.jsx      Upload dialog, cleaning queue, dataset history + details and tracker
    ForecastingPage.jsx      Horizon, run, chart, accuracy, comparison, run history
    InventoryPage.jsx        Stock table, safe/low/critical status, reorder status
    ReportsPage.jsx          Configure report, report history (Processing / Completed / Failed), email
    AdminPage.jsx            Users, categories, screen access + action permissions, activity log,
                             error log
  index.css                  The prototype's stylesheet + a plain-CSS reset at the top and a small additions block
docs/
  API_CONTRACT.md            The API for the FastAPI team: every endpoint with real JSON examples
scripts/backend-seed/        npm run export:seed: the demo data → database tables (tables.js), SQL, CSV,
                             JSON and documents (writers.js), views (views.sql), the command (export.mjs)
backend-seed/                Its output: schema.sql, seed.sql, csv/, json/, DATA_DICTIONARY.md, README.md
.env.example                 VITE_API_MODE, VITE_API_URL, VITE_DEMO_LATENCY_MS
```

## What changed from the Figma Make prototype

Same look and screens. These parts were placeholders in Make and now work:

- **ARIMA** runs in the browser (Make showed "unavailable without a backend").
- **Data cleaning**: uploads wait for a Data Analyst, who caps extreme values and merges the
  records into the shared sales data. Dataset history and the **status tracker** reflect real state.
- **Forecasts feed inventory**: running a forecast updates that product's 30-day demand,
  suggested reorder and status.
- **Admin**: adding/editing users and categories saves; screen access (role ID → screen IDs) and
  action permissions are editable and control navigation and actions; new users can sign in.
- **Reorder status** on the Inventory page: Ordered → Delivered, and delivery adds the stock.
- **Drawers** show the selected log entry or product (Make always showed one fixed example).
- The Store Manager forecast chart compares the forecast with the same product's history.
- Excel export uses `write-excel-file` (the old `xlsx` package has open security advisories).
- The Figma-only Vite plugins were removed so the project runs anywhere.
- Plain JavaScript (`.jsx`) instead of TypeScript, and plain CSS instead of Tailwind. The Make app
  only used Tailwind for its base reset, which is now written out as ordinary CSS at the top of `index.css`.

## Backend and API

The frontend is API-first: pages and the store call the service files in `src/services`, and only
`api.js` sends requests. **`docs/API_CONTRACT.md`** is the contract for the FastAPI team — every endpoint
with its request and response JSON (recorded from real responses), the error format and codes, the sign-in
token, uploads and downloads, the permission each endpoint needs, and the business rules the server owns.

Two modes, set in `.env.local` (copy `.env.example`):

| `VITE_API_MODE` | Who answers | Use it for |
|---|---|---|
| `demo` (default) | The demo backend in the browser (`src/services/mock`) — same paths, JSON, status codes, errors and permission checks as the contract | Running and testing the app before FastAPI exists |
| `live` | FastAPI at `VITE_API_URL` (default `/api`, forwarded to `http://localhost:8000` by `vite.config.js`) | Working against the real backend |

Pages, the store and the services are the same in both modes. Every page that loads data shows a
loading state and, when a request fails, the server's message with **Try again**; forms show the
server's field errors next to the inputs. A request answered with 401 (session expired or revoked)
signs the user out with the reason.

To switch to FastAPI: run it on port 8000 with every route under `/api`, set `VITE_API_MODE=live`, and
restart `npm run dev`. Section 11 of the contract has a short checklist.

### Seed data for the backend

The backend needs the same data the app shows, so it isn't typed in again: **`backend-seed/`** is the demo
backend's starting data exported as a PostgreSQL database — 24 tables, with the same IDs and values as in
demo mode, and views that work out the calculated fields (inventory status, products per category, each
upload's forecasting status …) with the same rules as the demo backend.

```bash
createdb -U postgres demandiq
psql -U postgres -d demandiq -v ON_ERROR_STOP=1 -f backend-seed/schema.sql -f backend-seed/seed.sql
```

`backend-seed/README.md` covers pgAdmin and Docker, the demo accounts, how rows map to the API's JSON and
a few decisions for the backend team; `DATA_DICTIONARY.md` lists every column. There are CSV and JSON
copies of every table for other databases. After changing `src/data/seed.js`, run `npm run export:seed`
again (`-- --tz Asia/Riyadh` writes the times for another time zone; the default is Asia/Kolkata).

## Colour palette

Defined once at the top of `src/index.css` (`:root`):

| Token | Colour | Used for |
|---|---|---|
| `--jet-black` | `#022b3a` | Header bar, headings and body text, forecast line, top bar in column charts, tooltips |
| `--teal` | `#1f7a8c` | Primary buttons, active tab, links, chart lines and bars, icons |
| `--pale-sky` | `#bfdbf7` | Borders and dividers, the forecast zone in charts, the blue "Uploaded" badge family |
| `--lavender` | `#e1e5f2` | Page background (cards sit on it in white) |
| `--white` | `#ffffff` | Cards, navigation bar, inputs |

Tints and shades of these are defined next to them. The only other colours are status colours:
green (Completed / Safe / Delivered / Forecasted), amber (Processing / Low / Pending), blue (Uploaded /
Ordered) and red
(Failed / Critical); grey for neutral labels (Not Forecasted). Text meets at least 4.5:1 contrast. One type scale is used everywhere (nothing
smaller than 11 px) and all inputs, selects and buttons share the same 36 px height.
