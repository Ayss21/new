// Administration: users, product categories, role permissions, activity log and error log.
// API (through the store): /users, /categories, /roles/permissions, /roles/{roleId}/screens,
// /roles/restore-defaults, /activity, /sessions, /errors.
import { useEffect, useMemo, useState } from "react";
import { PERMISSION_ACTIONS, PERMISSION_OPTIONS, PERMISSION_SCREEN } from "../data/seed";
import { actionLock } from "../lib/permissions";
import { ROLE, ROLE_IDS, roleName, toRoleId } from "../lib/roles";
import { formatSessionDuration } from "../lib/activity";
import { formatDateTime } from "../lib/format";
import { SCREENS, accessLock, canOpenScreen, screenById, screenIdsFor } from "../navigation";
import { useStore } from "../store/AppStore";
import { useWorkspace } from "../store/WorkspaceContext";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Icon,
  Modal,
  SearchBox,
  Select,
  Status,
  TableFooter,
  paginate,
  useFitRows,
} from "../components/ui";

const DEPARTMENTS = ["Commercial", "Data & Analytics", "Supply Chain", "Digital Operations", "Finance"];

function UserModal({ existing, onClose }) {
  const { addUser, updateUser, notify } = useStore();
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    id: existing?.id ?? "",
    email: existing?.email ?? "",
    department: existing?.department ?? "",
    roleId: existing?.roleId ?? ROLE.STORE_MANAGER,
    status: existing?.status ?? "Active",
    password: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key, value) => {
    setForm({ ...form, [key]: value });
    setErrors({ ...errors, [key]: "" });
    setFormError("");
  };

  /**
   * POST /users (the server generates the employee ID and work email) or PATCH /users/{id}.
   * The server's field messages appear under the fields.
   */
  const save = async () => {
    const e = {};
    if (!form.name.trim()) e.name = "Enter the user's full name.";
    if (existing && !/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = "Enter a valid work email.";
    if (!form.department) e.department = "Select a department.";
    if (!existing && form.password.length < 8) e.password = "At least 8 characters.";
    if (existing && form.password && form.password.length < 8)
      e.password = "At least 8 characters, or leave blank to keep the current password.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    const result = existing
      ? await updateUser(existing.id, {
          name: form.name,
          email: form.email,
          department: form.department,
          roleId: form.roleId,
          status: form.status,
          ...(form.password ? { password: form.password } : {}),
        })
      : await addUser({ name: form.name, department: form.department, roleId: form.roleId, status: form.status, password: form.password });
    setSaving(false);
    if (!result.ok) {
      setErrors({ ...e, ...result.error.fields });
      return setFormError(result.error.message);
    }
    notify(existing ? "User updated." : `${result.data.name} added · ${result.data.id} · ${result.data.email}`, 6000);
    onClose();
  };

  return (
    <Modal title={existing ? "Edit user" : "Add new user"} onClose={onClose} width="wide">
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Full name" error={errors.name}>
            <input placeholder="Enter full name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          {existing && (
            <>
              <Field label="Employee ID">
                <input value={form.id} readOnly />
              </Field>
              <Field label="Work email" error={errors.email}>
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Department" error={errors.department}>
            <Select value={form.department} onChange={(v) => set("department", v)}>
              <option value="">Select department</option>
              {(DEPARTMENTS.includes(form.department) || !form.department ? DEPARTMENTS : [form.department, ...DEPARTMENTS]).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          </Field>
          <Field label="Assign role">
            <Select value={String(form.roleId)} onChange={(v) => set("roleId", toRoleId(v))}>
              {ROLE_IDS.map((roleId) => (
                <option key={roleId} value={roleId}>
                  {roleName(roleId)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account status">
            <Select value={form.status} onChange={(v) => set("status", v)}>
              <option>Active</option>
              <option>Pending activation</option>
              {existing && <option>Inactive</option>}
            </Select>
          </Field>
          <Field
            label={existing ? "New password" : "Temporary password"}
            error={errors.password}
            helper={existing ? "Leave blank to keep the current password." : "Share it with the user securely."}
          >
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </Field>
        </div>
        {formError && (
          <div className="form-error" role="alert">
            <Icon name="warning" size={16} />
            {formError}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving…" : existing ? "Save changes" : "Create user"}
        </Button>
      </div>
    </Modal>
  );
}

function CategoryModal({ existing, onClose }) {
  const { addCategory, updateCategory, notify } = useStore();
  const [name, setName] = useState(existing?.name ?? "");
  const [id, setId] = useState(existing?.id ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState(existing?.status ?? "Active");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  /** POST /categories or PATCH /categories/{id} */
  const save = async () => {
    if (!name.trim()) return setError("Enter a category name.");
    if (!existing && id.trim() && !/^CAT-\d{3}$/i.test(id.trim()))
      return setError("Category ID must look like CAT-006, or leave it blank.");
    setSaving(true);
    const result = existing
      ? await updateCategory(existing.id, { name, description, status })
      : await addCategory({ id: id.trim(), name, description });
    setSaving(false);
    if (!result.ok) return setError(result.error.message);
    notify(existing ? "Product category updated." : "Product category created successfully.");
    onClose();
  };

  return (
    <Modal title={existing ? "Edit product category" : "Add product category"} onClose={onClose}>
      <div className="modal-body">
        <Field label="Category name">
          <input
            placeholder="Enter category name"
            value={name}
            onChange={(e) => (setName(e.target.value), setError(""))}
          />
        </Field>
        <Field label="Category ID" helper={existing ? undefined : "Leave blank to assign the next ID automatically."}>
          <input
            placeholder="e.g. CAT-006"
            value={id}
            onChange={(e) => (setId(e.target.value), setError(""))}
            readOnly={!!existing}
          />
        </Field>
        <Field label="Description">
          <textarea
            placeholder="Describe the product category..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {existing && (
          <Field label="Status">
            <Select value={status} onChange={(v) => setStatus(v)}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
        )}
        {error && (
          <div className="form-error" role="alert">
            <Icon name="warning" size={16} />
            {error}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving…" : existing ? "Save changes" : "Create category"}
        </Button>
      </div>
    </Modal>
  );
}

/** One cell of the screen access matrix: a tick box while editing, unless the cell is locked. */
/** While a change is being saved, show the value asked for; afterwards, what the server saved. */
function usePendingValue(saved, busy) {
  const [requested, setRequested] = useState(null);
  useEffect(() => {
    if (!busy) setRequested(null);
  }, [busy]);
  return [busy && requested !== null ? requested : saved, setRequested];
}

function ScreenAccessCell({ roleId, screen, allowed: saved, editing, busy, onChange }) {
  const [allowed, setRequested] = usePendingValue(saved, busy);
  const lock = accessLock(roleId, screen.id);
  const label = `${roleName(roleId)} (role ID ${roleId}) ${allowed ? "can" : "can't"} open ${screen.id} ${screen.label}`;
  if (editing && !lock)
    return (
      <label className="access-toggle" title={label}>
        <input
          type="checkbox"
          checked={allowed}
          disabled={busy}
          onChange={(e) => {
            setRequested(e.target.checked);
            onChange(e.target.checked);
          }}
          aria-label={`${roleName(roleId)} (role ID ${roleId}) can open ${screen.id} ${screen.label}`}
        />
      </label>
    );
  return (
    <span className={`access-cell ${editing && lock ? "is-locked" : ""}`} title={editing && lock ? lock : label}>
      {allowed ? (
        <span className="access-yes">
          <Icon name="check" size={14} />
        </span>
      ) : (
        <span className="access-no">—</span>
      )}
      {editing && lock && <Icon name="lock" size={12} />}
    </span>
  );
}

/** One editable cell of the action permissions matrix. */
function PermissionSelect({ action, roleId, value: saved, busy, onChange }) {
  const [value, setRequested] = usePendingValue(saved, busy);
  return (
    <select
      className="permission-select"
      value={value}
      disabled={busy}
      aria-label={`${roleName(roleId)}: ${action}`}
      onChange={(e) => {
        setRequested(e.target.value);
        onChange(e.target.value);
      }}
    >
      {PERMISSION_OPTIONS[action].map((o) => (
        <option key={o} value={o}>
          {o === "No" ? "No access" : o === "Yes" ? "Allowed" : o}
        </option>
      ))}
    </select>
  );
}

function PermissionCell({ value }) {
  if (value === "Yes")
    return (
      <span className="permission-yes">
        <Icon name="check" size={14} />
        Allowed
      </span>
    );
  if (value === "No") return <span className="muted">No access</span>;
  return <>{value}</>;
}

export default function AdminPage() {
  const store = useStore();
  const {
    users,
    categories,
    permissions,
    screenAccess,
    activity,
    sessions,
    errors,
    setPermission,
    setScreenAccess,
    restoreDefaultAccess,
    updateUser,
    notify,
    can,
    canExport,
    currentUser,
    refresh,
  } = store;
  const { openDrawer, openExport } = useWorkspace();
  const [tab, setTab] = useState("User Management");
  const [search, setSearch] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [errorPage, setErrorPage] = useState(1);
  const [userModal, setUserModal] = useState(null);
  const [categoryModal, setCategoryModal] = useState(null);
  const [editingPermissions, setEditingPermissions] = useState(false);
  const [busyKey, setBusyKey] = useState(null); // the user row or permission cell being saved
  const canViewLogs = can("View system logs");

  // Logs and sessions change with everyone's actions: reload them whenever Administration opens
  useEffect(() => {
    refresh(["users", "activity", "sessions", "errors"]);
  }, [refresh]);
  const tabs = [
    "User Management",
    "Product Categories",
    "Role Permissions",
    ...(canViewLogs ? ["Activity Log", "Error Log"] : []),
  ];

  const q = search.toLowerCase();
  const visibleUsers = users.filter((u) =>
    [u.name, u.email, u.id, roleName(u.roleId), u.department, u.status].some((v) => v.toLowerCase().includes(q)),
  );
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const lastLogin = (userId) => {
    const latest = sessions.filter((s) => s.userId === userId).sort((a, b) => b.loginAt.localeCompare(a.loginAt))[0];
    return latest ? formatDateTime(latest.loginAt) : "Never";
  };
  // Each activity row with its session: Login = session sign-in, Logout = sign-out ("—" while active).
  const activityRows = activity
    .map((row) => {
      const session = row.sessionId ? sessionById.get(row.sessionId) : null;
      return {
        row,
        login: session ? formatDateTime(session.loginAt) : formatDateTime(row.at),
        logout: session?.logoutAt ? formatDateTime(session.logoutAt) : "—",
        duration: session ? formatSessionDuration(session.loginAt, session.logoutAt) : "No session",
      };
    })
    .filter(({ row, login, logout }) =>
      [login, logout, row.userName, row.userId ?? "", row.roleId ? roleName(row.roleId) : "", row.action, row.module, row.details, row.status]
        .some((v) => v.toLowerCase().includes(q)),
    );
  const errorRows = errors.filter((row) =>
    [row.id, formatDateTime(row.at), row.module, row.type, row.severity, row.message, row.status].some((v) => v.toLowerCase().includes(q)),
  );
  const [activityTable, activityPageSize] = useFitRows({ min: 5 });
  const [errorTable, errorPageSize] = useFitRows({ min: 5 });
  const activityData = paginate(activityRows, activityPage, activityPageSize);
  const errorData = paginate(errorRows, errorPage, errorPageSize);
  const activeUsers = users.filter((u) => u.status === "Active").length;

  /** PATCH /users/{id} { status } */
  const toggleStatus = async (user) => {
    const next = user.status === "Active" ? "Inactive" : "Active";
    setBusyKey(user.id);
    const result = await updateUser(user.id, { status: next });
    setBusyKey(null);
    if (!result.ok) notify(result.error.message, 4000, "warning");
    else notify(`${user.name} ${next === "Active" ? "activated" : "deactivated"}.`);
  };

  /** Runs a permission change and reports a refusal. */
  const savePermission = async (key, change) => {
    setBusyKey(key);
    const result = await change();
    setBusyKey(null);
    if (!result.ok) notify(result.error.message, 4000, "warning");
  };

  return (
    <div className="page-stack admin-combined-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h1>Administration</h1>
        </div>
        {(tab === "Activity Log" || tab === "Error Log") && canExport(tab === "Activity Log" ? "User Activity Report" : "System Error Report") && (
          <Button
            variant="secondary"
            icon="download"
            onClick={() => openExport("CSV", tab === "Activity Log" ? "User Activity Report" : "System Error Report")}
          >
            Export log
          </Button>
        )}
        {tab === "Role Permissions" && (
          <div className="table-tools">
            {editingPermissions && (
              <Button
                variant="secondary"
                icon="refresh"
                disabled={busyKey === "defaults"}
                onClick={async () => {
                  setBusyKey("defaults");
                  const result = await restoreDefaultAccess();
                  setBusyKey(null);
                  if (result.ok) notify("Screen access and action permissions are back to their defaults.");
                  else notify(result.error.message, 4000, "warning");
                }}
              >
                Restore defaults
              </Button>
            )}
            <Button
              variant={editingPermissions ? "primary" : "secondary"}
              icon={editingPermissions ? "check" : "edit"}
              onClick={() => setEditingPermissions(!editingPermissions)}
            >
              {editingPermissions ? "Done" : "Edit permissions"}
            </Button>
          </div>
        )}
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            className={tab === x ? "active" : ""}
            onClick={() => {
              setTab(x);
              setSearch("");
            }}
          >
            {x}
            {x === "Error Log" && <span className="tab-count">{errors.filter((e) => e.status !== "Resolved").length}</span>}
          </button>
        ))}
      </div>

      {tab === "User Management" && (
        <Card>
          <CardHeader
            title="User management"
            subtitle={`${activeUsers} active user${activeUsers === 1 ? "" : "s"}`}
            action={
              <div className="table-tools">
                <SearchBox value={search} onChange={setSearch} placeholder="Search users" />
                <Button onClick={() => setUserModal("new")}>+ Add user</Button>
              </div>
            }
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>User ID</th>
                  <th>Assigned role</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <span>{u.initials}</span>
                        <div>
                          <strong>
                            {u.name}
                            {u.id === currentUser?.id && " (you)"}
                          </strong>
                          <small>{u.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>{u.id}</td>
                    <td>
                      <Status value={roleName(u.roleId)} />
                    </td>
                    <td>{u.department}</td>
                    <td>
                      <Status value={u.status} />
                    </td>
                    <td>{lastLogin(u.id)}</td>
                    <td className="row-actions">
                      <Button variant="ghost" icon="edit" onClick={() => setUserModal(u)}>
                        Edit
                      </Button>
                      {u.id !== currentUser?.id && (
                        <Button variant="ghost" disabled={busyKey === u.id} onClick={() => toggleStatus(u)}>
                          {busyKey === u.id ? "Saving…" : u.status === "Active" ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleUsers.length && (
              <EmptyState inline title="No users found" detail="Try a name, user ID, email, role or department." />
            )}
          </div>
        </Card>
      )}

      {tab === "Product Categories" && (
        <Card>
          <CardHeader title="Product categories" action={<Button onClick={() => setCategoryModal("new")}>+ Add category</Button>} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Category ID</th>
                  <th>Description</th>
                  <th>Products</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{c.id}</td>
                    <td>{c.description}</td>
                    <td>{c.products.toLocaleString()}</td>
                    <td>
                      <Status value={c.status} />
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => setCategoryModal(c)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "Role Permissions" && (
        <Card className="rollup-card screen-access-card">
          <CardHeader
            title="Screen access by role ID"
            subtitle={editingPermissions ? "Tick a screen to let that role open it." : "The screens each role can open"}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Screen</th>
                  {ROLE_IDS.map((roleId) => (
                    <th key={roleId}>
                      {roleName(roleId)} <span className="role-id">ID {roleId}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SCREENS.map((screen) => (
                  <tr key={screen.id}>
                    <td>
                      <span className="screen-id">{screen.id}</span>
                      <strong>{screen.label}</strong>
                    </td>
                    {ROLE_IDS.map((roleId) => (
                      <td key={roleId}>
                        <ScreenAccessCell
                          roleId={roleId}
                          screen={screen}
                          allowed={canOpenScreen(screenAccess, roleId, screen.id)}
                          editing={editingPermissions}
                          busy={busyKey === `${roleId}-${screen.id}`}
                          onChange={(allowed) => savePermission(`${roleId}-${screen.id}`, () => setScreenAccess(roleId, screen.id, allowed))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Role ID → screen IDs</th>
                  {ROLE_IDS.map((roleId) => (
                    <td key={roleId}>
                      <span className="screen-list">{screenIdsFor(screenAccess, roleId).join(" · ")}</span>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="info-callout permission-note">
            <Icon name="lock" />
            <p>Every role keeps SCR-01 Dashboard, and only the Admin has SCR-06 Administration.</p>
          </div>
        </Card>
      )}

      {tab === "Role Permissions" && (
        <Card className="action-permissions-card">
          <CardHeader title="Action permissions" subtitle="What each role can do on its screens" />
          <div className="table-wrap permission-table">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Screen</th>
                  {ROLE_IDS.map((roleId) => (
                    <th key={roleId}>
                      {roleName(roleId)} <span className="role-id">ID {roleId}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ACTIONS.map((action) => {
                  const screenId = PERMISSION_SCREEN[action];
                  return (
                    <tr key={action}>
                      <td>
                        <strong>{action}</strong>
                      </td>
                      <td>
                        <span className="screen-id" title={screenById(screenId)?.label}>
                          {screenId}
                        </span>
                      </td>
                      {ROLE_IDS.map((roleId) => {
                        const value = permissions[action][roleId];
                        const lock = actionLock(action, roleId);
                        const unreachable = value === "Yes" && !canOpenScreen(screenAccess, roleId, screenId);
                        return (
                          <td key={roleId}>
                            {editingPermissions && !lock ? (
                              <PermissionSelect
                                action={action}
                                roleId={roleId}
                                value={value}
                                busy={busyKey === `${action}-${roleId}`}
                                onChange={(next) => savePermission(`${action}-${roleId}`, () => setPermission(action, roleId, next))}
                              />
                            ) : (
                              <span className="permission-value" title={editingPermissions ? (lock ?? undefined) : undefined}>
                                <PermissionCell value={value} />
                                {editingPermissions && lock && <Icon name="lock" size={12} />}
                              </span>
                            )}
                            {unreachable && (
                              <small className="permission-hint" title={`${roleName(roleId)} can't open ${screenId}, so this action can't be used`}>
                                No {screenId} access
                              </small>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="info-callout permission-note">
            <Icon name="shield" />
            <p>
              View and Review = can see but not act. The Admin only views Sales Data, Inventory and Forecasting; locked cells can't be changed.
            </p>
          </div>
        </Card>
      )}

      {tab === "Activity Log" && (
        <Card className="admin-log-card">
          <CardHeader
            title="User activity log"
            subtitle="Application events"
            action={
              <SearchBox
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setActivityPage(1);
                }}
                placeholder="Search activity"
              />
            }
          />
          <div className="table-wrap">
            <table ref={activityTable}>
              <thead>
                <tr>
                  <th>Login</th>
                  <th>Logout time</th>
                  <th>Session time</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Module</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activityData.rows.map(({ row, login, logout, duration }) => (
                  <tr
                    key={row.id}
                    className="clickable-row"
                    tabIndex={0}
                    onClick={() => openDrawer({ type: "activity", id: row.id })}
                    onKeyDown={(e) => e.key === "Enter" && openDrawer({ type: "activity", id: row.id })}
                    title="View activity details"
                  >
                    <td>{login}</td>
                    <td>{logout}</td>
                    <td>{duration === "Ongoing" ? <Status value="Ongoing" /> : duration}</td>
                    <td>{row.userName}</td>
                    <td>{row.roleId ? roleName(row.roleId) : "—"}</td>
                    <td>{row.action}</td>
                    <td>{row.module}</td>
                    <td>
                      <Status value={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!activityRows.length && (
              <EmptyState inline title="No activity found" detail="Try a user, ID, role, action or module." />
            )}
          </div>
          <TableFooter
            label={activityData.label}
            page={activityData.page}
            pageCount={activityData.pageCount}
            onPage={setActivityPage}
          />
        </Card>
      )}

      {tab === "Error Log" && (
        <Card className="admin-log-card">
          <CardHeader
            title="System error log"
            subtitle="Failures and their status"
            action={
              <SearchBox
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setErrorPage(1);
                }}
                placeholder="Search errors"
              />
            }
          />
          <div className="table-wrap">
            <table ref={errorTable}>
              <thead>
                <tr>
                  <th>Error ID</th>
                  <th>Timestamp</th>
                  <th>Module</th>
                  <th>Severity</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {errorData.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.id}</strong>
                    </td>
                    <td>{formatDateTime(row.at)}</td>
                    <td>{row.module}</td>
                    <td>
                      <Status value={row.severity} />
                    </td>
                    <td>{row.message}</td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        onClick={() => openDrawer({ type: "error", errorId: row.id })}
                        aria-label="View error details"
                      >
                        <Icon name="arrow" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!errorRows.length && (
              <EmptyState inline title="No errors found" detail="Try an error ID, module, type or severity." />
            )}
          </div>
          <TableFooter
            label={errorData.label}
            page={errorData.page}
            pageCount={errorData.pageCount}
            onPage={setErrorPage}
          />
        </Card>
      )}

      {userModal && <UserModal existing={userModal === "new" ? null : userModal} onClose={() => setUserModal(null)} />}
      {categoryModal && (
        <CategoryModal
          existing={categoryModal === "new" ? null : categoryModal}
          onClose={() => setCategoryModal(null)}
        />
      )}
    </div>
  );
}
