import { useState } from "react";
import { PAGE, breadcrumbFor } from "../../navigation";
import { plural } from "../../lib/format";
import { roleName } from "../../lib/roles";
import { useStore } from "../../store/AppStore";
import { useWorkspace } from "../../store/WorkspaceContext";
import { Button, Icon } from "../ui";

export function TopHeader({ page, onSignOut }) {
  const { currentUser, alerts, canOpen } = useStore();
  const { goTo } = useWorkspace();
  const [openMenu, setOpenMenu] = useState(null);
  if (!currentUser) return null;
  const toggle = (menu) => setOpenMenu((current) => (current === menu ? null : menu));

  return (
    <header className="top-header">
      <div className="header-brand">
        <div className="product-mark">
          <span>DI</span>DemandIQ
        </div>
        <div>
          <strong>Demand Planning</strong>
          <span>& Inventory Management</span>
        </div>
      </div>
      <div className="breadcrumb">
        <span>Workspace</span>
        {breadcrumbFor(page).map((part, index, parts) => (
          <span key={part} className="breadcrumb-part">
            <b>/</b>
            {index === parts.length - 1 ? <strong>{part}</strong> : <span>{part}</span>}
          </span>
        ))}
      </div>
      <div className="header-actions">
        <button
          className="icon-btn header-icon"
          onClick={() => toggle("notifications")}
          aria-label="Notifications"
          aria-expanded={openMenu === "notifications"}
        >
          <Icon name="bell" />
          {alerts.length > 0 && <i />}
        </button>
        <button className="icon-btn header-icon" aria-label="Help">
          <Icon name="help" />
        </button>
        <button className="profile-trigger" onClick={() => toggle("profile")} aria-expanded={openMenu === "profile"}>
          <span className="avatar">{currentUser.initials}</span>
          <span>
            <strong>{currentUser.name}</strong>
            <small>{roleName(currentUser.roleId)}</small>
          </span>
          <Icon name="chevron" size={15} />
        </button>
      </div>
      {openMenu === "notifications" && (
        <div className="dropdown notification-drop">
          <div className="dropdown-head">
            <strong>Stock alerts</strong>
            <span>{alerts.length ? `${alerts.length.toLocaleString()} below reorder level` : "None"}</span>
          </div>
          {/* GET /inventory/alerts — most urgent first */}
          {alerts.slice(0, 5).map((alert) => (
            <button key={alert.sku} onClick={() => setOpenMenu(null)}>
              <i className={alert.status === "Critical" ? "red-dot" : ""} />
              <div>
                <strong>{alert.status === "Critical" ? "Critical stock alert" : "Low stock"}</strong>
                <span>{alert.message}</span>
                <small>
                  {alert.name} · suggested reorder {plural(alert.suggested, "unit")}
                </small>
              </div>
            </button>
          ))}
          {!alerts.length && <p className="dropdown-empty">Every product is above its reorder level.</p>}
          {canOpen(PAGE.INVENTORY) && alerts.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                setOpenMenu(null);
                goTo(PAGE.INVENTORY);
              }}
            >
              Open inventory
            </Button>
          )}
        </div>
      )}
      {openMenu === "profile" && (
        <div className="dropdown profile-drop">
          <div className="profile-summary">
            <span className="avatar large">{currentUser.initials}</span>
            <div>
              <strong>{currentUser.name}</strong>
              <span>{currentUser.email}</span>
              <small>{roleName(currentUser.roleId)}</small>
            </div>
          </div>
          <button onClick={() => setOpenMenu(null)}>
            <Icon name="shield" />
            Profile & preferences
          </button>
          <button
            className="logout"
            onClick={() => {
              setOpenMenu(null);
              onSignOut();
            }}
          >
            <Icon name="arrow" />
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
