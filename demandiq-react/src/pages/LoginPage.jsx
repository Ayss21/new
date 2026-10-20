// Sign-in page: the company name and title on the left, the sign-in form on the right. It calls
// POST /auth/login through the store (authService) and shows what the server says. In demo mode (the default,
// see src/services/api.js) "View demonstration accounts" lists the demo accounts; the demo backend runs in
// the browser, so it isn't a secure sign-in. There is no sign-up; the Admin creates accounts.
import { useEffect, useRef, useState } from "react";
import { ROLE_IDS, roleName, toRoleId } from "../lib/roles";
import { screenById } from "../navigation";
import { API_MODE, settle } from "../services/api";
import { SESSION_RULES, authService } from "../services/authService";
import { demoService } from "../services/demoService";
import { useStore } from "../store/AppStore";
import { Button, Field, Icon, Modal, ProgressState, Status } from "../components/ui";

const DEMO = API_MODE === "demo";

const MISSING = {
  login: "Enter your email or employee ID.",
  password: "Enter your password.",
  role: "Select the role you're signing in as.",
};

/** Which form fields to highlight for an error from POST /auth/login. */
function fieldsFor(error) {
  if (error.code === "invalid_credentials") return ["login", "password"];
  if (error.code === "role_mismatch") return ["role"];
  if (error.code === "validation_error")
    return Object.keys(error.fields ?? {})
      .map((key) => (key === "roleId" ? "role" : key))
      .filter((key) => key in MISSING);
  return [];
}

function SignInForm({ prefill, onShowDialog }) {
  const { login } = useStore();
  const [loginId, setLoginId] = useState(prefill?.login ?? "");
  const [password, setPassword] = useState(prefill?.password ?? "");
  const [roleId, setRoleId] = useState(prefill?.roleId ? String(prefill.roleId) : "");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, fields: ["login" | "password" | "role"] }
  const inputs = { login: useRef(null), password: useRef(null), role: useRef(null) };
  const selectedRole = toRoleId(roleId);

  const fail = (message, fields) => {
    setError({ message, fields });
    if (fields.length) inputs[fields[0]].current?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const missing = ["login", "password", "role"].filter((field) => !{ login: loginId.trim(), password, role: selectedRole }[field]);
    if (missing.length) return fail(missing.length > 1 ? "Fill in the highlighted fields to sign in." : MISSING[missing[0]], missing);
    setBusy(true);
    setError(null);
    const result = await login(loginId, password, selectedRole, { remember });
    // On success the workspace opens and this form goes away
    if (!result.ok) {
      setBusy(false);
      fail(result.error.message, fieldsFor(result.error));
    }
  };

  const edit = (setter) => (value) => {
    setter(value);
    setError(null);
  };
  const invalid = (field) => (error?.fields.includes(field) ? true : undefined);

  return (
    <form className="signin-form" onSubmit={submit} noValidate aria-busy={busy}>
      <Field label="Email or employee ID">
        <input
          ref={inputs.login}
          value={loginId}
          autoComplete="username"
          aria-invalid={invalid("login")}
          onChange={(e) => edit(setLoginId)(e.target.value)}
          placeholder="name@company.com or USR-1042"
        />
      </Field>
      <Field label="Password">
        <div className="password-wrap">
          <input
            ref={inputs.password}
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            aria-invalid={invalid("password")}
            onChange={(e) => edit(setPassword)(e.target.value)}
          />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <Field label="Role">
        <select ref={inputs.role} value={roleId} aria-invalid={invalid("role")} onChange={(e) => edit(setRoleId)(e.target.value)}>
          <option value="">Select your role</option>
          {ROLE_IDS.map((id) => (
            <option key={id} value={id}>
              {roleName(id)} (role ID {id})
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <div className="form-error" role="alert">
          <Icon name="warning" size={16} />
          {error.message}
        </div>
      )}
      <div className="form-row">
        <label className="check" title={`Keeps you signed in for ${SESSION_RULES.rememberDays} days, even after the browser closes`}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember me</span>
        </label>
        <button className="link-btn" type="button" onClick={() => onShowDialog("forgot")}>
          Forgot password?
        </button>
      </div>
      <Button type="submit" className="sign-in" disabled={busy}>
        {busy ? (
          "Signing in…"
        ) : (
          <>
            Sign in <Icon name="arrow" size={16} />
          </>
        )}
      </Button>
      {DEMO && (
        <Button variant="secondary" icon="users" className="signin-demo-btn" onClick={() => onShowDialog("demo")}>
          View demonstration accounts
        </Button>
      )}
    </form>
  );
}

/** Demo mode only: the demonstration accounts (GET /demo/accounts). A row fills the form. */
function DemoAccountsDialog({ onPick, onClose }) {
  const { roles, resetDemoData } = useStore();
  const [state, setState] = useState({ status: "loading", accounts: [], error: null });
  const [resetting, setResetting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: "loading" }));
    settle(demoService.getAccounts()).then((result) => {
      if (active) setState(result.ok ? { status: "ready", accounts: result.data, error: null } : { status: "error", accounts: [], error: result.error });
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reset = async () => {
    setResetting(true);
    const result = await resetDemoData();
    setResetting(false);
    if (result.ok) setAttempt((n) => n + 1);
  };

  const screensOf = (roleId) => roles.find((role) => role.roleId === roleId)?.screens ?? [];

  return (
    <Modal title="Demonstration accounts" onClose={onClose} width="xwide">
      <div className="modal-body">
        <p>Click an account to fill in the sign-in form.</p>
        {state.status === "loading" && <ProgressState title="Loading accounts" />}
        {state.status === "error" && (
          <div className="form-error no-margin" role="alert">
            <Icon name="warning" size={16} />
            {state.error.message}
          </div>
        )}
        {state.status === "ready" && (
          <div className="table-wrap demo-accounts">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Password</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Screen IDs</th>
                </tr>
              </thead>
              <tbody>
                {state.accounts.map((user) => (
                  <tr
                    key={user.id}
                    className={`clickable-row ${user.status === "Active" ? "" : "is-blocked"}`}
                    tabIndex={0}
                    onClick={() => onPick(user)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPick(user);
                      }
                    }}
                  >
                    <td>
                      <strong>
                        {user.name} <span className="account-id">· {user.id}</span>
                      </strong>
                      <small>{user.email}</small>
                    </td>
                    <td>
                      <code>{user.password}</code>
                    </td>
                    <td>
                      {roleName(user.roleId)} <span className="role-id">ID {user.roleId}</span>
                    </td>
                    <td>
                      <Status value={user.status} />
                    </td>
                    <td>
                      <div className="screen-chips">
                        {screensOf(user.roleId).map((id) => (
                          <span key={id} className="screen-chip" title={screenById(id)?.label}>
                            <b>{id}</b>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <Button variant="ghost" icon="refresh" className="modal-action-start" disabled={resetting} onClick={reset}>
          {resetting ? "Resetting…" : "Reset demo data"}
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/** "Forgot password?" — POST /auth/password-reset. */
function ForgotPasswordDialog({ onClose }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", message: "", error: null }); // idle | sending | sent
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  const send = async () => {
    setState({ status: "sending", message: "", error: null });
    const result = await settle(authService.requestPasswordReset(email.trim()));
    setState(result.ok ? { status: "sent", message: result.data.message, error: null } : { status: "idle", message: "", error: result.error });
  };

  return (
    <Modal title="Reset your password" onClose={onClose}>
      <div className="modal-body">
        {state.status === "sent" ? (
          <div className="info-callout no-margin">
            <Icon name="check" />
            <p>{state.message}</p>
          </div>
        ) : (
          <>
            <p>Enter your work email and we'll send instructions to reset your password.</p>
            <Field label="Work email" error={state.error?.fields?.email}>
              <input placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {state.error && !state.error.fields?.email && (
              <div className="form-error no-margin" role="alert">
                <Icon name="warning" size={16} />
                {state.error.message}
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-actions">
        {state.status === "sent" ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid || state.status === "sending"} onClick={send}>
              {state.status === "sending" ? "Sending…" : "Send instructions"}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function LoginPage() {
  const { authNotice, loadRoles } = useStore();
  const [dialog, setDialog] = useState(null); // "demo" | "forgot" | null
  const [prefill, setPrefill] = useState(null);

  // Each role's screen IDs (GET /auth/roles), shown with the demonstration accounts
  useEffect(() => {
    if (DEMO) loadRoles();
  }, [loadRoles]);

  return (
    <main className="signin-page">
      <div className="signin-card">
        <section className="signin-intro" aria-label="DemandIQ">
          <div className="signin-brand">
            <span>DI</span>DemandIQ
          </div>
          <h1>Demand Forecasting &amp; Inventory Management</h1>
        </section>

        <section className="signin-main" aria-labelledby="signin-title">
          <div className="signin-head">
            <h2 id="signin-title">Sign in</h2>
          </div>
          {authNotice && (
            <div className="signin-notice" role="status">
              <Icon name="warning" size={16} />
              <span>{authNotice}</span>
            </div>
          )}
          <SignInForm key={prefill ? `${prefill.login}-${prefill.roleId}` : "empty"} prefill={prefill} onShowDialog={setDialog} />
        </section>
      </div>

      {dialog === "forgot" && <ForgotPasswordDialog onClose={() => setDialog(null)} />}

      {DEMO && dialog === "demo" && (
        <DemoAccountsDialog
          onClose={() => setDialog(null)}
          onPick={(user) => {
            setPrefill({ login: user.email, password: user.password, roleId: user.roleId });
            setDialog(null);
          }}
        />
      )}
    </main>
  );
}
