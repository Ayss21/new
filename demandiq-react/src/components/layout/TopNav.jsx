import { useEffect, useRef, useState } from "react";
import { CONSOLE, PAGE_ICON, PAGE_LABEL, consolePagesFor, isConsolePage, topNavFor } from "../../navigation";
import { ROLE } from "../../lib/roles";
import { useStore } from "../../store/AppStore";
import { Icon } from "../ui";

/**
 * Admin's module dropdown (Sales Data, Inventory, Reports & Exports, Forecasting). The button shows the open
 * module's name, or the first module (Sales Data) as a placeholder on other screens; choosing one opens it.
 */
function ConsoleMenu({ page, pages, onNavigate }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const active = isConsolePage(page);
  const shown = active ? page : pages[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="console-menu" ref={wrap}>
      <button
        className={active ? "active" : "is-placeholder"}
        aria-current={active ? "page" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Modules: ${PAGE_LABEL[shown]}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name={PAGE_ICON[shown]} />
        <span>{PAGE_LABEL[shown]}</span>
        <Icon name="chevron" size={15} />
      </button>
      {open && (
        <div className="console-dropdown" role="menu" aria-label="Modules">
          {pages.map((key) => (
            <button
              key={key}
              role="menuitem"
              className={page === key ? "is-current" : ""}
              onClick={() => {
                setOpen(false);
                onNavigate(key);
              }}
            >
              <Icon name={PAGE_ICON[key]} size={16} />
              <span>{PAGE_LABEL[key]}</span>
              {page === key && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Top navigation bar: only the screens the signed-in role ID can open (the screen IDs the server sent at sign-in).
 * Admin: Dashboard | <module dropdown> | Administration. Others: Dashboard | <individual module tabs>.
 */
export function TopNav({ page, onNavigate }) {
  const { navAccess, currentUser } = useStore();
  const roleId = currentUser?.roleId;
  const isAdmin = roleId === ROLE.ADMIN;
  return (
    <nav className="top-nav" aria-label="Main">
      {topNavFor(navAccess, roleId).map((item) =>
        isAdmin && item.key === CONSOLE ? (
          <ConsoleMenu key={item.key} page={page} pages={consolePagesFor(navAccess, roleId)} onNavigate={onNavigate} />
        ) : (
          <button
            key={item.key}
            className={page === item.key ? "active" : ""}
            aria-current={page === item.key ? "page" : undefined}
            onClick={() => onNavigate(item.key)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ),
      )}
    </nav>
  );
}
