# DemandIQ — integrated frontend + FastAPI backend

This bundle combines the supplied React/Vite frontend with the supplied FastAPI backend and retains the provided ER diagram. The frontend's existing screens and components are preserved. Live API mode is the default in `.env.example`; mock/demo services remain in source for explicit demo-mode use.

## Project layout

- `demandiq-react/` — React + Vite UI, existing pages/components/services/tests
- `backend/` — FastAPI application, SQLAlchemy models/repositories/routes and backend tests
- `database/er/` — supplied ER diagram and source formats
- `database/seed/demo-data.json` — isolated SQLite test fixture for backend unit tests; it is not applied to SQL Server
- `docs/` — API endpoint, database and OpenAPI documentation

## Important database note

The backend `.env.example` targets the already-existing SQL Server database `B1A-S6-T3`. No database is created, dropped, seeded, or migrated by these setup steps. The included JSON seed is used only by isolated SQLite tests. Do not execute seed commands or database creation/schema scripts against your existing database. The backend source expects the schema documented in `docs/DATABASE.md`; verify that the imported database matches that schema before running write operations. Your original `.env` file was intentionally not included in this ZIP to avoid distributing credentials. Fill in `backend/.env` locally with the connection details appropriate to your environment.

## Prerequisites

- Python 3.11+
- Node.js 20+
- Microsoft SQL Server ODBC driver matching `MSSQL_DRIVER` (ODBC Driver 17 is the supplied backend configuration default)
- Network access from the backend host to SQL Server

## Start the backend

From the project root:

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
# Copy .env.example to .env, then configure the real server/authentication settings:
# Windows PowerShell: Copy-Item .env.example .env
# macOS/Linux: cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check `http://127.0.0.1:8000/api/health`; interactive API docs are at `http://127.0.0.1:8000/docs`. A health response with `database: unavailable` means the API process started but its SQL Server connection did not succeed.

## Start the frontend

In a second terminal, from the project root, run:
```bash
cd demandiq-react
npm ci
# Copy .env.example to .env.local (VITE_API_MODE=live by default)
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:8000`, so no browser-side database credentials are used. If hosting frontend and backend on separate origins, set `VITE_API_URL` to the backend API base URL and add the frontend origin to `CORS_ORIGINS` in `backend/.env`.

## Tests

Frontend:

```bash
cd demandiq-react
npm test
npm run build
```

Backend (does not require the configured SQL Server for its SQLite-backed unit tests):

```bash
cd backend
pytest -q
```

To verify the real SQL Server connection, start the backend and request `/api/health`. The database connectivity and frontend-to-backend integration cannot be fully verified without access to the configured SQL Server/ODBC driver and valid local `.env` settings.

## Security

- Never commit `backend/.env` or frontend `.env.local`.
- Keep SQL Server credentials exclusively in backend environment variables; never use `VITE_*` variables for secrets.
- Change demo credentials before production use.
- Configure SMTP only if email-report delivery is required.

## Verification performed for this ZIP

- **Python syntax compilation:** passed (`python -m compileall` on `backend/app`).
- **Frontend production build:** not completed. `npm ci` could not download packages because the environment could not resolve `registry.npmjs.org` (`EAI_AGAIN`); consequently Vite was unavailable.
- **Backend pytest suite:** not completed. The execution environment is missing the `bcrypt` dependency and package installation was not available.
- **Live SQL Server/API integration:** not verified from this environment. The configured SQL Server is external to this build sandbox; verify `/api/health` after configuring `backend/.env` on a machine with network access and the matching ODBC driver.
