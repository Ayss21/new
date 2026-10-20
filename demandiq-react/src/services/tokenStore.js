// Where the browser keeps the sign-in token between page loads.
//   remember = true  → localStorage: survives closing the browser (until the token expires).
//   remember = false → sessionStorage: this tab only; closing the tab signs you out.
// A new sign-in replaces any earlier token. Storage can be blocked (some private windows), so every
// access is wrapped: the app still works, it just won't stay signed in after a refresh.

const KEY = "demandiq.token";

function storage(name) {
  try {
    return typeof window === "undefined" ? null : (window[name] ?? null);
  } catch {
    return null;
  }
}

function attempt(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** { local, session } storages; tests pass in-memory ones. */
let stores = null;
const local = () => (stores ? stores.local : storage("localStorage"));
const session = () => (stores ? stores.session : storage("sessionStorage"));

export const tokenStore = {
  get() {
    return attempt(() => session()?.getItem(KEY)) ?? attempt(() => local()?.getItem(KEY)) ?? null;
  },
  save(token, { remember = false } = {}) {
    this.clear();
    attempt(() => (remember ? local() : session())?.setItem(KEY, token));
  },
  clear() {
    attempt(() => local()?.removeItem(KEY));
    attempt(() => session()?.removeItem(KEY));
  },
  /** Tests only: use in-memory storages ({ local, session }), or null for the browser's. */
  useStorages(value) {
    stores = value;
  },
};
