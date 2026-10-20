// The demo backend's database (demo mode only — FastAPI has its own database).
//
// It starts from src/data/seed.js and is saved in this browser after every change — in IndexedDB, which has
// room for big uploads (localStorage, the fallback, holds about 5 MB) — so, like a real server, data survives
// a page reload and is shared by every tab. POST /demo/reset (the "Reset demo data" button on the sign-in
// page) puts everything back to the seed, and so does a new version of the seed data. Records are kept in
// the shapes the app uses; the route files turn them into the JSON described in docs/API_CONTRACT.md.
import {
  initialActivities,
  initialCategories,
  initialDatasets,
  initialErrors,
  initialExports,
  initialForecastHistory,
  initialInventory,
  initialPermissions,
  initialReorders,
  initialSessions,
  initialSnapshots,
  initialUsers,
  sampleSales,
} from "../../data/seed";
import { SAMPLE_START, dateBounds } from "../../lib/domain";
import { forecastLineage } from "../../lib/lineage";
import { ROLE_SCREEN_ACCESS } from "../../navigation";

const KEY = "demandiq.demo-db";
const VERSION = 2;
const OLD_KEYS = ["demandiq.session", "demandiq.access"]; // used before the app talked to an API
const IDB_NAME = "demandiq-demo";
const IDB_STORE = "database";

const clone = (value) => JSON.parse(JSON.stringify(value));

/** A fresh database from the seed data. */
function seedDatabase() {
  const lastSale = dateBounds(sampleSales).end;
  const userById = Object.fromEntries(initialUsers.map((user) => [user.id, user]));
  const sales = clone(sampleSales);
  const datasets = clone(initialDatasets);
  return {
    users: clone(initialUsers),
    categories: clone(initialCategories),
    permissions: clone(initialPermissions),
    screenAccess: clone(ROLE_SCREEN_ACCESS),
    sales,
    inventory: clone(initialInventory),
    snapshots: clone(initialSnapshots),
    // Seed runs used the whole sample period (so their lineage is the uploads that period came from);
    // ids count up from the oldest run
    forecasts: initialForecastHistory.map((run, index) => ({
      id: `FC-${String(initialForecastHistory.length - index).padStart(4, "0")}`,
      startDate: SAMPLE_START,
      endDate: lastSale,
      ...clone(run),
      lineage: forecastLineage({ sales, datasets }, { sku: run.sku, startDate: SAMPLE_START, endDate: lastSale }),
    })),
    datasets,
    reorders: clone(initialReorders),
    reports: clone(initialExports).map((report) => ({ ...report, filters: null, error: report.status === "Failed" ? "The export failed." : null })),
    activity: clone(initialActivities),
    // Seeded sessions are finished sessions; live ones also carry the token and its expiry
    sessions: clone(initialSessions).map((session) => ({
      ...session,
      roleId: userById[session.userId]?.roleId ?? null,
      token: null,
      expiresAt: session.logoutAt,
      remember: false,
    })),
    errors: clone(initialErrors),
    counters: {},
  };
}

/** A short fingerprint of a value (djb2), used to notice when the seed data changes. */
export function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Where it's kept: IndexedDB (one record), else localStorage. Outside a browser (tests): memory only.
// ---------------------------------------------------------------------------

let connection = null; // Promise of the IndexedDB database, or of null when there's none
function openIndexedDb() {
  connection ??= new Promise((resolve) => {
    try {
      if (typeof window === "undefined" || typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return connection;
}

async function readSaved() {
  const idb = await openIndexedDb();
  try {
    if (idb)
      return await new Promise((resolve, reject) => {
        const request = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(KEY);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    const raw = storage()?.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeSaved(record) {
  const idb = await openIndexedDb();
  try {
    if (!idb) return storage()?.setItem(KEY, JSON.stringify(record));
    await new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(record, KEY);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch {
    /* storage full or blocked: the demo keeps working until the page reloads */
  }
}

let state = null;
let seedPrint = null;
let stale = false; // another tab saved: read the database again before the next request
let loading = null;
let pendingSave = null;

// Tabs share one database: a tab that saves tells the others, which read it again before their next request
let channel = null;
try {
  if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(KEY);
    channel.onmessage = () => {
      stale = true;
    };
  }
  if (typeof window !== "undefined")
    window.addEventListener("storage", (event) => {
      if (event.key === KEY) stale = true; // the localStorage fallback
    });
} catch {
  /* each tab keeps its own copy until it reloads */
}

/** Loads the database before a request: the saved one when it belongs to this seed, otherwise the seed. */
export function whenLoaded() {
  if (state && !stale) return Promise.resolve();
  loading ??= (async () => {
    const fresh = seedPrint ? null : seedDatabase();
    seedPrint ??= fingerprint(fresh);
    const saved = await readSaved();
    if (saved?.version === VERSION && saved.seed === seedPrint && saved.data) state = saved.data;
    else state ??= fresh ?? seedDatabase();
    stale = false;
    try {
      for (const key of OLD_KEYS) storage()?.removeItem(key);
      if (await openIndexedDb()) storage()?.removeItem(KEY); // version 1 kept the database in localStorage
    } catch {
      /* ignore */
    }
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** The database (the seed until whenLoaded() has read the saved one; tests use it directly). */
export function db() {
  if (!state) {
    state = seedDatabase();
    seedPrint ??= fingerprint(state);
  }
  return state;
}

/** Saves the database (after every request that changed something): one write for a burst of changes. */
export function save() {
  if (!state || pendingSave) return;
  pendingSave = setTimeout(async () => {
    pendingSave = null;
    await writeSaved({ version: VERSION, seed: seedPrint, savedAt: new Date().toISOString(), data: state });
    channel?.postMessage("saved");
  }, 0);
}

/** Puts every record back to the seed data. */
export function resetDatabase() {
  state = seedDatabase();
  seedPrint = fingerprint(state);
  save();
}

/** Seeded records per id prefix: new ids continue after them (FC-0012, RPT-022, SES-0013 …). */
const SEEDED = {
  FC: initialForecastHistory.length,
  RPT: initialExports.length,
  EVT: initialActivities.length,
  SES: initialSessions.length,
  ERR: initialErrors.length,
  DS: initialDatasets.length,
  RO: initialReorders.length,
};

/** Next id for a prefix: FC-0012, RPT-022, RO-0004 … (continues after the seeded ids). */
export function nextId(prefix) {
  const data = db();
  const width = { RPT: 3 }[prefix] ?? 4;
  const start = SEEDED[prefix] ?? 0;
  data.counters[prefix] = (data.counters[prefix] ?? start) + 1;
  return `${prefix}-${String(data.counters[prefix]).padStart(width, "0")}`;
}

/** Tests only: start again from the seed without touching storage. */
export function resetForTests() {
  state = seedDatabase();
  seedPrint = fingerprint(state);
}
