// App shell: the sign-in page, or the workspace (header, navigation, global filters, current page).
//
// Which page is open is decided here, and only screens the signed-in user's role ID can open are
// ever shown (navigation.js → ROLE_SCREEN_ACCESS):
//   • after signing in        → the role's dashboard
//   • after a refresh         → the screen in the address bar (#/forecasting …) if the role can open it,
//                               otherwise the dashboard with a notice
//   • a menu or link          → only offered for screens the role can open; goTo() checks again
//   • a typed address or Back → checked; a screen the role can't open is refused and logged
import { useEffect, useRef, useState } from "react";
import { AppStoreProvider, useStore } from "./store/AppStore";
import { WorkspaceContext } from "./store/WorkspaceContext";
import { PAGE, hashFor, landingPageFor, parseHash, screenForPage } from "./navigation";
import { roleClass, roleName } from "./lib/roles";
import { TopHeader } from "./components/layout/TopHeader";
import { TopNav } from "./components/layout/TopNav";
import { FilterSidebar } from "./components/layout/FilterSidebar";
import { Toast } from "./components/layout/Toast";
import { Drawer } from "./components/Drawer";
import { ExportModal } from "./components/modals/ExportModal";
import { StockModal } from "./components/modals/StockModal";
import { ReorderModal } from "./components/modals/ReorderModal";
import { Button, Icon, ProgressState } from "./components/ui";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import SalesUploadPage from "./pages/SalesUploadPage";
import ForecastingPage from "./pages/ForecastingPage";
import InventoryPage from "./pages/InventoryPage";
import ReportsPage from "./pages/ReportsPage";
import AdminPage from "./pages/AdminPage";

// Addresses the app writes are marked, so a typed address can be told apart from Back / Forward.
const APP_ENTRY = { demandiq: true };
const addressWith = (hash) => `${window.location.pathname}${window.location.search}${hash}`;

/** Changes the address without adding a Back step, e.g. "#/dashboard" (or "" for no address). */
function replaceAddress(hash) {
  window.history.replaceState(APP_ENTRY, "", addressWith(hash));
}

/** Changes the address and adds a Back step. */
function pushAddress(hash) {
  window.history.pushState(APP_ENTRY, "", addressWith(hash));
}

function Workspace() {
  const { currentUser, navAccess, canOpen, authOrigin, logout, appliedFilters, notify, logClientEvent, workspaceStatus } = useStore();
  const roleId = currentUser.roleId;
  const landing = landingPageFor(navAccess, roleId);

  // The address when this workspace opened, and the first page: the dashboard after signing in, or the
  // address's screen after a refresh when this role can open it.
  const [opening] = useState(() => parseHash(window.location.hash));
  const [page, setPage] = useState(() =>
    authOrigin === "resumed" && opening.page && canOpen(opening.page) ? opening.page : landing,
  );
  const [dialog, setDialog] = useState(null);
  const [drawer, setDrawer] = useState(null);

  // If the Admin removes access to the open page, fall back to the dashboard.
  const current = canOpen(page) ? page : landing;

  /** Tells the user a screen was refused, and records it in the activity log. */
  const refuse = (target) => {
    const screen = screenForPage(target);
    if (!screen) return notify("There's no DemandIQ screen at that address, so you stayed on this page.", 4500, "warning");
    notify(`${screen.label} (${screen.id}) isn't available to the ${roleName(roleId)} role.`, 4500, "warning");
    logClientEvent("Screen access denied", `${screen.id} ${screen.label}`);
  };
  const latest = useRef({});
  latest.current = { canOpen, current, refuse };

  // After a refresh: say so when the address pointed at a screen this role can't open. Runs once
  // (the ref also stops React's development double-run from logging it twice).
  const openingChecked = useRef(false);
  useEffect(() => {
    if (openingChecked.current) return;
    openingChecked.current = true;
    if (authOrigin === "resumed" && opening.path && opening.page !== page) latest.current.refuse(opening.page);
  }, []); // first-render values only

  // Keep the state and the address bar on the page actually shown.
  useEffect(() => {
    if (current !== page) setPage(current);
    if (window.location.hash !== hashFor(current)) replaceAddress(hashFor(current));
  }, [current, page]);

  // A typed address, or the browser's Back / Forward buttons.
  useEffect(() => {
    const onAddressChange = () => {
      const { page: requested, path } = parseHash(window.location.hash);
      const { canOpen: allowed, current: shown, refuse: deny } = latest.current;
      if (requested && allowed(requested)) {
        setPage(requested);
        setDrawer(null);
        return;
      }
      if (path) deny(requested);
      // A typed address added a Back step: undo it, so Back still goes where the user expects.
      // Back / Forward onto an older address of this app: show the current page's address instead.
      if (window.history.state?.demandiq) replaceAddress(hashFor(shown));
      else window.history.back();
    };
    window.addEventListener("hashchange", onAddressChange);
    return () => window.removeEventListener("hashchange", onAddressChange);
  }, []);

  const workspace = {
    page: current,
    goTo: (next) => {
      if (!canOpen(next)) return refuse(next);
      setPage(next);
      setDrawer(null);
      if (window.location.hash !== hashFor(next)) pushAddress(hashFor(next));
    },
    openExport: (format, name) => setDialog({ kind: "export", format, name }),
    openDrawer: setDrawer,
    selectInventoryAction: (sku, kind) => {
      setDrawer(null);
      setDialog({ kind, sku });
    },
  };

  const signOut = () => {
    replaceAddress("");
    logout();
  };

  const showGlobalFilters = current !== PAGE.ADMIN;
  const workspaceClass = [
    "workspace",
    showGlobalFilters ? "" : "workspace-full",
    current === PAGE.FORECASTING ? "workspace-forecasting" : "",
    current === PAGE.SALES ? "workspace-sales-data" : "",
    current === PAGE.DASHBOARD ? "workspace-dashboard" : "",
    current === PAGE.INVENTORY ? "workspace-inventory" : "",
  ].join(" ");

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className={`app-shell ${roleClass(roleId)}`}>
        <TopHeader page={current} onSignOut={signOut} />
        <TopNav page={current} onNavigate={workspace.goTo} />
        <div className={workspaceClass}>
          {showGlobalFilters && <FilterSidebar />}
          <main className="content">
            {workspaceStatus !== "ready" ? (
              <WorkspaceLoading />
            ) : (
              <>
                {current === PAGE.DASHBOARD && <DashboardPage />}
                {current === PAGE.SALES && <SalesUploadPage />}
                {/* Starts again when the global filters that pick the product or model change */}
                {current === PAGE.FORECASTING && (
                  <ForecastingPage key={[appliedFilters.model, appliedFilters.sku, appliedFilters.category, appliedFilters.region].join("|")} />
                )}
                {current === PAGE.INVENTORY && <InventoryPage />}
                {current === PAGE.REPORTS && <ReportsPage />}
                {current === PAGE.ADMIN && <AdminPage />}
              </>
            )}
          </main>
        </div>
        {dialog?.kind === "export" && (
          <ExportModal
            key={`${dialog.name}-${dialog.format}`}
            reportName={dialog.name}
            requestedFormat={dialog.format}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "stock" && <StockModal key={dialog.sku} sku={dialog.sku} onClose={() => setDialog(null)} />}
        {dialog?.kind === "reorder" && (
          <ReorderModal key={dialog.sku} sku={dialog.sku} onClose={() => setDialog(null)} />
        )}
        {drawer && <Drawer key={JSON.stringify(drawer)} target={drawer} onClose={() => setDrawer(null)} />}
        <Toast />
      </div>
    </WorkspaceContext.Provider>
  );
}

/** While the workspace data loads from the API — or why it couldn't, with a way to try again. */
function WorkspaceLoading() {
  const { workspaceStatus, workspaceError, reloadWorkspace } = useStore();
  if (workspaceStatus === "error")
    return (
      <div className="card load-state" role="alert">
        <Icon name="warning" size={22} />
        <div>
          <strong>The workspace data couldn't be loaded</strong>
          <p>{workspaceError?.message}</p>
        </div>
        <Button icon="refresh" onClick={reloadWorkspace}>
          Try again
        </Button>
      </div>
    );
  return (
    <div className="card load-state">
      <ProgressState title="Loading your workspace" />
    </div>
  );
}

/** Full-page states before the sign-in page or the workspace: checking a saved session, or no server. */
function StartupScreen() {
  const { authStatus, authNotice, retryConnection, logout } = useStore();
  return (
    <main className="startup-screen">
      <div className="startup-card" role={authStatus === "offline" ? "alert" : "status"}>
        <div className="signin-brand startup-brand">
          <span>DI</span>DemandIQ
        </div>
        {authStatus === "offline" ? (
          <>
            <Icon name="warning" size={22} />
            <strong>Can't reach the DemandIQ server</strong>
            <p>
              {authNotice && !authNotice.startsWith("Can't reach") ? `${authNotice} ` : ""}
              You're still signed in on this device. Check that the backend is running, then try again.
            </p>
            <div className="startup-actions">
              <Button variant="secondary" onClick={logout}>
                Go to sign-in
              </Button>
              <Button icon="refresh" onClick={retryConnection}>
                Try again
              </Button>
            </div>
          </>
        ) : (
          <ProgressState title="Checking your session" detail="Contacting the DemandIQ server…" />
        )}
      </div>
    </main>
  );
}

/** The sign-in page, or a fresh workspace for each sign-in (keyed by session, so nothing carries over). */
function Root() {
  const { authStatus, currentUser, currentSessionId } = useStore();
  if (authStatus === "checking" || authStatus === "offline") return <StartupScreen />;
  return currentUser ? <Workspace key={currentSessionId} /> : <LoginPage />;
}

export default function App() {
  return (
    <AppStoreProvider>
      <Root />
      <LoginToast />
    </AppStoreProvider>
  );
}

/** Toasts (e.g. errors) also need to show on the login screen. */
function LoginToast() {
  const { currentUser } = useStore();
  return currentUser ? null : <Toast />;
}
