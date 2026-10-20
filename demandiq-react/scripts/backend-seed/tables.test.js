// The backend seed's tables hold together: unique keys, references that point at real rows, a load order in
// which every table only refers to tables before it, and files that read back to the same values.
import { beforeAll, describe, expect, it } from "vitest";
import { db, resetForTests } from "../../src/services/mock/db";
import { DemoPassword, buildTables, primaryKey } from "./tables";
import { csvCell, idCounters, schemaSql, seedSql, sqlValue, tableCsv, tableJson } from "./writers";

let tables;
beforeAll(() => {
  resetForTests();
  tables = buildTables(db());
});

const find = (name) => tables.find((t) => t.name === name);
const keyOf = (t, row) => JSON.stringify(primaryKey(t).map((name) => row[name]));

/** Reads a CSV line back into cells (quotes, doubled quotes, commas inside quotes). */
function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      cells.push(wasQuoted || cell !== "" ? cell : null);
      cell = "";
      wasQuoted = false;
    } else cell += ch;
  }
  cells.push(wasQuoted || cell !== "" ? cell : null);
  return cells;
}

describe("backend seed tables", () => {
  it("has every table with rows, columns once each and a primary key", () => {
    expect(tables.length).toBe(24);
    for (const t of tables) {
      expect(t.rows.length, t.name).toBeGreaterThan(0);
      expect(new Set(t.columns.map((c) => c.name)).size, t.name).toBe(t.columns.length);
      expect(primaryKey(t).length, t.name).toBeGreaterThan(0);
    }
  });

  it("has unique primary keys and unique columns", () => {
    for (const t of tables) {
      const keys = t.rows.map((row) => keyOf(t, row));
      expect(new Set(keys).size, `${t.name} primary key`).toBe(keys.length);
      for (const column of t.columns.filter((c) => c.unique)) {
        const values = t.rows.map((row) => row[column.name]).filter((v) => v !== null);
        expect(new Set(values).size, `${t.name}.${column.name}`).toBe(values.length);
      }
      for (const columns of t.uniques) {
        const values = t.rows.map((row) => JSON.stringify(columns.map((name) => row[name])));
        expect(new Set(values).size, `${t.name} (${columns.join(", ")})`).toBe(values.length);
      }
    }
  });

  it("refers only to rows that exist, in tables loaded earlier", () => {
    tables.forEach((t, index) => {
      for (const column of t.columns.filter((c) => c.ref)) {
        const target = tables.findIndex((other) => other.name === column.ref);
        expect(target, `${t.name}.${column.name} → ${column.ref}`).toBeGreaterThanOrEqual(0);
        expect(target, `${column.ref} loads before ${t.name}`).toBeLessThan(index);
        const keyColumn = primaryKey(tables[target]);
        expect(keyColumn.length).toBe(1);
        const keys = new Set(tables[target].rows.map((row) => row[keyColumn[0]]));
        const missing = t.rows.map((row) => row[column.name]).filter((value) => value !== null && !keys.has(value));
        expect(missing, `${t.name}.${column.name} → ${column.ref}`).toEqual([]);
      }
    });
  });

  it("fills required columns and keeps the case-insensitive keys unique", () => {
    for (const t of tables)
      for (const column of t.columns.filter((c) => !c.null))
        expect(t.rows.filter((row) => row[column.name] === null || row[column.name] === undefined).length, `${t.name}.${column.name}`).toBe(0);
    const lower = (name, column) => find(name).rows.map((row) => row[column].toLowerCase());
    for (const [name, column] of [["users", "email"], ["users", "user_id"], ["categories", "name"]])
      expect(new Set(lower(name, column)).size, `${name}.${column}`).toBe(find(name).rows.length);
  });

  it("stores what the API's calculated fields are worked out from", () => {
    const runs = find("forecast_runs").rows;
    for (const run of runs) {
      expect(run.window_size !== null, run.forecast_id).toBe(run.model === "Moving Average");
      expect(run.slope !== null, run.forecast_id).toBe(run.model === "Linear Regression");
      expect(run.arima_p !== null, run.forecast_id).toBe(run.model === "ARIMA");
    }
    // Every seeded run used the four cleaned uploads, so they count as forecast
    const used = new Set(find("forecast_sources").rows.filter((s) => s.kind === "used").map((s) => s.dataset_id));
    expect([...used].sort()).toEqual(["DS-0002", "DS-0003", "DS-0004", "DS-0005"]);
    // Reorders: Ordered when placed, Delivered with a delivery time; the orders in the activity log exist
    expect(find("reorders").rows.map((r) => [r.reorder_id, r.status, r.ordered_at !== null, r.delivered_at])).toEqual([
      ["RO-0003", "Ordered", true, null],
      ["RO-0002", "Ordered", true, null],
      ["RO-0001", "Delivered", true, "2025-06-18T10:00:00.000Z"],
    ]);
    const placed = find("activity_log").rows.filter((e) => e.action === "Reorder placed").map((e) => e.details.split(" · ")[0]);
    expect(placed.sort()).toEqual(["RO-0002", "RO-0003"]);
    // Uploads: no seeded file had rows for the same product and day, or added products
    expect(find("datasets").rows.map((d) => d.combined_rows)).toEqual(find("datasets").rows.map(() => 0));
    expect(find("products").rows.filter((p) => p.added_from !== null)).toEqual([]);
    // The Admin's view-only levels
    const admin = Object.fromEntries(find("role_permissions").rows.filter((r) => r.role_id === 4).map((r) => [r.action, r.level]));
    expect(admin).toMatchObject({ "Upload sales": "Review", "Clean data": "View", "Run forecasts": "View", "Update inventory": "View", "Manage users": "Yes" });
  });

  it("continues the IDs after the seeded ones", () => {
    const next = Object.fromEntries(idCounters(tables).map((c) => [c.table, c.next]));
    expect(next).toMatchObject({ forecast_runs: "FC-0012", reports: "RPT-022", reorders: "RO-0004", datasets: "DS-0008", categories: "CAT-006" });
  });
});

describe("backend seed files", () => {
  it("writes SQL literals safely", () => {
    expect(sqlValue("O'Brien", "TEXT")).toBe("'O''Brien'");
    expect(sqlValue(null, "TEXT")).toBe("NULL");
    expect(sqlValue(["Yes", "No"], "TEXT[]")).toBe("ARRAY['Yes', 'No']");
    expect(sqlValue({ start: "2025-01-01" }, "JSONB")).toBe(`'{"start":"2025-01-01"}'::jsonb`);
    expect(sqlValue(new DemoPassword("it's"), "TEXT")).toBe("crypt('it''s', gen_salt('bf', 10))");
    expect(() => sqlValue(Number.NaN, "NUMERIC")).toThrow();
  });

  it("writes CSV cells that read back to the same value, keeping NULL and empty text apart", () => {
    for (const value of ['say "hi", then', "line\nbreak", " padded ", "plain", "Approved supplier · SUP-024"])
      expect(parseCsvLine(csvCell(value, "TEXT"))).toEqual([value]);
    expect(parseCsvLine(`${csvCell(null, "TEXT")},${csvCell("", "TEXT")}`)).toEqual([null, ""]);
    expect(parseCsvLine(csvCell(["Yes", "Review", "No"], "TEXT[]"))).toEqual(["{Yes,Review,No}"]); // PostgreSQL's array form
    expect(csvCell(new DemoPassword("Store123!"), "TEXT")).toBe("Store123!");
  });

  it("writes every row to CSV and JSON with the same columns", () => {
    for (const t of tables) {
      const lines = tableCsv(t).trimEnd().split("\n");
      expect(lines.length, t.name).toBe(t.rows.length + 1);
      const json = JSON.parse(tableJson(t));
      expect(json.length, t.name).toBe(t.rows.length);
      expect(Object.keys(json[0]), t.name).toEqual(parseCsvLine(lines[0]));
    }
    // Users: the demo password instead of the hash, never the hash expression
    const users = JSON.parse(tableJson(find("users")));
    expect(users.find((u) => u.user_id === "USR-1042")).toMatchObject({ password: "Analyze123!" });
    expect(users.every((u) => !("password_hash" in u))).toBe(true);
  });

  it("creates every table and loads every row", () => {
    const schema = schemaSql(tables, "CREATE VIEW v AS SELECT 1;", "-- test");
    const seed = seedSql(tables, "-- test");
    for (const t of tables) {
      expect(schema, t.name).toContain(`CREATE TABLE ${t.name} (`);
      expect(seed, t.name).toContain(`INSERT INTO ${t.name} (`);
    }
    expect(seed).toContain("SELECT setval('forecast_runs_id_seq', 11); -- next: FC-0012");
    // A password only ever appears inside crypt(…), which hashes it as it loads
    expect(seed.split("Analyze123!").length).toBe(seed.split("crypt('Analyze123!', gen_salt('bf', 10))").length);
    expect(seed).toContain("crypt('Analyze123!', gen_salt('bf', 10))");
  });
});
