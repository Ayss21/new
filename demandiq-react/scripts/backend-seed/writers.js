// Writes the tables from tables.js as PostgreSQL (schema.sql, seed.sql), CSV, JSON and a data dictionary.
// Plain functions of the tables: no files are read or written here (export.mjs does that).

const PASSWORD_ROUNDS = 10; // bcrypt cost for the demo passwords
const NOT_SENT = "(not sent)"; // a column's api mark when the API never sends it (tables.js)

const isPassword = (value) => value !== null && typeof value === "object" && "plain" in value;

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** 'text' with quotes doubled. */
export const sqlString = (text) => `'${String(text).replaceAll("'", "''")}'`;

/** A value as a SQL literal for a column of this type. */
export function sqlValue(value, type) {
  if (value === null || value === undefined) return "NULL";
  if (isPassword(value)) return `crypt(${sqlString(value.plain)}, gen_salt('bf', ${PASSWORD_ROUNDS}))`;
  if (type === "TEXT[]") return value.length ? `ARRAY[${value.map(sqlString).join(", ")}]` : "'{}'::text[]";
  if (type === "JSONB") return `${sqlString(JSON.stringify(value))}::jsonb`;
  if (type === "BOOLEAN") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Backend seed: ${value} can't be stored as ${type}`);
    return String(value);
  }
  return sqlString(value);
}

const sequenceName = (t) => `${t.name}_id_seq`;
/**
 * Tables of earlier versions of the seed, dropped too when schema.sql runs again: dataset_history (1.0) and
 * reorder_requests (1.1, now reorders).
 */
const RETIRED_TABLES = ["dataset_history", "reorder_requests"];
const idColumn = (t) => t.columns.find((c) => c.id);
const pkColumns = (t) => t.columns.filter((c) => c.pk);

/** The largest number among IDs like FC-0011 (0 when none look like that). */
function largestId(t) {
  const column = idColumn(t);
  const pattern = new RegExp(`^${column.id[0]}-(\\d+)$`);
  return t.rows.reduce((max, row) => Math.max(max, Number(pattern.exec(row[column.name])?.[1] ?? 0)), 0);
}

/** What the next ID of each table with an ID sequence will be: [{ table, sequence, last, next }]. */
export function idCounters(tables) {
  return tables
    .filter(idColumn)
    .map((t) => {
      const [prefix, digits] = idColumn(t).id;
      const last = largestId(t);
      return { table: t.name, sequence: sequenceName(t), last, next: `${prefix}-${String(last + 1).padStart(digits, "0")}` };
    });
}

function commentText(column) {
  const parts = [];
  if (column.api === NOT_SENT) parts.push("Not sent by the API.");
  else if (column.api) parts.push(`API: ${column.api.replaceAll("`", "")}.`);
  if (column.note) parts.push(column.note.endsWith(".") ? column.note : `${column.note}.`);
  return parts.join(" ");
}

function columnSql(t, column, keyOf, width) {
  const singlePk = pkColumns(t).length === 1 && column.pk;
  let sql = `${column.name.padEnd(width)} ${column.type}`;
  if (singlePk) sql += " PRIMARY KEY";
  else if (!column.null) sql += " NOT NULL";
  if (column.id) sql += ` DEFAULT next_id('${column.id[0]}', '${sequenceName(t)}', ${column.id[1]})`;
  if (column.default) sql += ` DEFAULT ${column.default}`;
  if (column.unique) sql += " UNIQUE";
  if (column.ref) sql += ` REFERENCES ${column.ref} (${keyOf(column.ref)})${column.onDelete ? ` ON DELETE ${column.onDelete}` : ""}`;
  if (column.check) sql += ` CHECK (${column.check})`;
  return sql;
}

/**
 * schema.sql: the tables (with keys, foreign keys, checks and comments), the ID sequences and the views.
 * views: the SQL of views.sql.
 */
export function schemaSql(tables, views, header) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const keyOf = (name) => {
    const target = byName.get(name);
    if (!target || pkColumns(target).length !== 1) throw new Error(`Backend seed: can't refer to ${name}`);
    return pkColumns(target)[0].name;
  };
  const viewNames = [...views.matchAll(/CREATE VIEW (\w+)/g)].map((m) => m[1]);
  const out = [
    header,
    "SET client_encoding = 'UTF8';",
    "BEGIN;",
    "",
    "-- Running this file again starts over: it first drops the DemandIQ views, tables and sequences (only those),",
    "-- including tables earlier versions had.",
    `DROP VIEW IF EXISTS ${[...viewNames].reverse().join(", ")};`,
    `DROP TABLE IF EXISTS ${[...tables.map((t) => t.name)].reverse().concat(RETIRED_TABLES).join(", ")} CASCADE;`,
    `DROP SEQUENCE IF EXISTS ${tables.filter(idColumn).map(sequenceName).concat(RETIRED_TABLES.map((name) => `${name}_id_seq`)).join(", ")};`,
    "DROP FUNCTION IF EXISTS next_id(text, regclass, integer);",
    "",
    "-- New IDs in the app's format, e.g. next_id('FC', 'forecast_runs_id_seq', 4) → FC-0012.",
    "-- More digits are added when the number needs them (FC-10000).",
    "CREATE FUNCTION next_id(prefix text, seq regclass, digits integer) RETURNS text",
    "LANGUAGE sql VOLATILE AS $$",
    "  SELECT prefix || '-' || lpad(n::text, greatest(digits, length(n::text)), '0')",
    "  FROM (SELECT nextval(seq) AS n) AS next_value",
    "$$;",
  ];

  let area = null;
  for (const t of tables) {
    if (t.area !== area) {
      area = t.area;
      out.push("", `-- ${"=".repeat(100)}`, `-- ${area}`, `-- ${"=".repeat(100)}`);
    }
    out.push("", `-- ${t.name}: ${t.about}`);
    if (idColumn(t)) out.push(`CREATE SEQUENCE ${sequenceName(t)};`);
    const width = Math.max(...t.columns.map((c) => c.name.length));
    const parts = t.columns.map((c) => columnSql(t, c, keyOf, width));
    const pk = pkColumns(t);
    if (pk.length > 1) parts.push(`PRIMARY KEY (${pk.map((c) => c.name).join(", ")})`);
    for (const columns of t.uniques) parts.push(`UNIQUE (${columns.join(", ")})`);
    for (const expression of t.checks) parts.push(`CHECK (${expression})`);
    out.push(`CREATE TABLE ${t.name} (`, parts.map((p) => `  ${p}`).join(",\n"), ");");
    if (idColumn(t)) out.push(`ALTER SEQUENCE ${sequenceName(t)} OWNED BY ${t.name}.${idColumn(t).name};`);
    out.push(...t.indexes.map((sql) => `${sql};`));
    out.push(`COMMENT ON TABLE ${t.name} IS ${sqlString(t.about)};`);
    for (const c of t.columns) {
      const text = commentText(c);
      if (text) out.push(`COMMENT ON COLUMN ${t.name}.${c.name} IS ${sqlString(text)};`);
    }
  }
  out.push("", `-- ${"=".repeat(100)}`, "-- Views", `-- ${"=".repeat(100)}`, "", views.trim(), "");
  for (const view of describeViews(views)) out.push(`COMMENT ON VIEW ${view.name} IS ${sqlString(view.about)};`);
  out.push("", "COMMIT;", "");
  return out.join("\n");
}

/** seed.sql: every row, in load order, then the ID sequences moved past the seeded IDs. */
export function seedSql(tables, header, { chunk = 250 } = {}) {
  const out = [
    header,
    "SET client_encoding = 'UTF8';",
    "BEGIN;",
    "",
    "-- crypt() and gen_salt() hash the demo passwords (bcrypt).",
    "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
  ];
  for (const t of tables) {
    out.push("", `-- ${t.name}: ${t.rows.length.toLocaleString("en-US")} row${t.rows.length === 1 ? "" : "s"}`);
    const names = t.columns.map((c) => c.name).join(", ");
    for (let start = 0; start < t.rows.length; start += chunk) {
      const rows = t.rows.slice(start, start + chunk).map((row) => `  (${t.columns.map((c) => sqlValue(row[c.name], c.type)).join(", ")})`);
      out.push(`INSERT INTO ${t.name} (${names}) VALUES`, `${rows.join(",\n")};`);
    }
  }
  const counters = idCounters(tables).filter((c) => c.last > 0);
  out.push("", "-- New rows get the next IDs after the seeded ones.");
  for (const c of counters) out.push(`SELECT setval('${c.sequence}', ${c.last}); -- next: ${c.next}`);
  out.push("", "COMMIT;", "");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// CSV and JSON
// ---------------------------------------------------------------------------

/** A column's name in the CSV and JSON files. */
export const fileColumn = (column) => column.file ?? column.name;

/** A value for the CSV and JSON files (a password becomes the demo password itself). */
const plainValue = (value) => (isPassword(value) ? value.plain : value);

/** A PostgreSQL array literal: {Yes,Review,No}. */
function arrayLiteral(values) {
  const element = (v) => (/^[^",{}\\\s]+$/.test(v) && v.toUpperCase() !== "NULL" ? v : `"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
  return `{${values.map(element).join(",")}}`;
}

/**
 * One CSV cell. NULL is an empty cell and an empty string is "" (how PostgreSQL's COPY … CSV reads them);
 * arrays use PostgreSQL's {a,b} form and JSON is written as JSON text.
 */
export function csvCell(value, type) {
  const plain = plainValue(value);
  if (plain === null || plain === undefined) return "";
  let text;
  if (type === "TEXT[]") text = arrayLiteral(plain);
  else if (type === "JSONB") text = JSON.stringify(plain);
  else text = String(plain);
  return text === "" || /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A table as CSV: a header row with the column names, then one line per row. */
export function tableCsv(t) {
  const lines = [t.columns.map(fileColumn).join(",")];
  for (const row of t.rows) lines.push(t.columns.map((c) => csvCell(row[c.name], c.type)).join(","));
  return `${lines.join("\n")}\n`;
}

/** A table as JSON: an array of row objects, one per line. */
export function tableJson(t) {
  const rows = t.rows.map((row) => JSON.stringify(Object.fromEntries(t.columns.map((c) => [fileColumn(c), plainValue(row[c.name])]))));
  return rows.length ? `[\n  ${rows.join(",\n  ")}\n]\n` : "[]\n";
}

/** manifest.json: the tables in load order, with their keys, row counts and files. */
export function manifest(tables, info) {
  return `${JSON.stringify(
    {
      ...info,
      loadOrder: "Load the tables in this order: each refers only to tables before it.",
      tables: tables.map((t) => ({
        name: t.name,
        rows: t.rows.length,
        primaryKey: pkColumns(t).map((c) => c.name),
        references: [...new Set(t.columns.filter((c) => c.ref).map((c) => c.ref))],
        csv: `csv/${t.name}.csv`,
        json: `json/${t.name}.json`,
      })),
    },
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

const cell = (text) => String(text ?? "").replaceAll("|", "\\|");
const rowsLabel = (n) => `${n.toLocaleString("en-US")} row${n === 1 ? "" : "s"}`;

/** The tables grouped by area: | Table | Rows | What it holds |. */
export function tableSummary(tables) {
  const out = [];
  let area = null;
  for (const t of tables) {
    if (t.area !== area) {
      area = t.area;
      out.push("", `**${area}**`, "", "| Table | Rows | What it holds |", "|---|---:|---|");
    }
    out.push(`| [\`${t.name}\`](DATA_DICTIONARY.md#${t.name}) | ${t.rows.length.toLocaleString("en-US")} | ${cell(t.about)} |`);
  }
  return out.join("\n").trim();
}

/** DATA_DICTIONARY.md: every table and column, its key, the API field it becomes and what it holds. */
export function dataDictionary(tables, views, intro) {
  const out = [intro.trim(), ""];
  let area = null;
  for (const t of tables) {
    if (t.area !== area) {
      area = t.area;
      out.push(`## ${area}`, "");
    }
    out.push(`### ${t.name}`, "", t.about, "", `${rowsLabel(t.rows.length)} · used by ${t.used}`, "");
    out.push("| Column | Type | Key / null | API field | Notes |", "|---|---|---|---|---|");
    for (const c of t.columns) {
      const key = [
        c.pk ? "PK" : null,
        c.ref ? `→ \`${c.ref}\`` : null,
        c.unique ? "unique" : null,
        c.null ? "NULL" : null,
        c.id ? `default ${c.id[0]}-${"0".repeat(c.id[1] - 1)}1 …` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const name = fileColumn(c) === c.name ? `\`${c.name}\`` : `\`${c.name}\` (files: \`${fileColumn(c)}\`)`;
      const api = !c.api ? "" : c.api === NOT_SENT || c.api.includes("`") ? c.api : `\`${c.api}\``;
      out.push(`| ${name} | ${c.type} | ${cell(key)} | ${cell(api)} | ${cell(c.note ?? "")} |`);
    }
    const extras = [
      ...t.uniques.map((columns) => `Unique: (${columns.join(", ")})`),
      ...t.checks.map((expression) => `Check: \`${cell(expression)}\``),
    ];
    if (extras.length) out.push("", ...extras.map((line) => `- ${line}`));
    out.push("");
  }
  out.push("## Views", "", "Values worked out from the tables, the way the demo backend works them out (`views.sql` in `schema.sql`):", "");
  for (const view of views) out.push(`- **\`${view.name}\`** — ${view.about}`);
  out.push("");
  return out.join("\n");
}

/** The views in views.sql with the comment above each: [{ name, about }]. */
export function describeViews(viewsSql) {
  return [...viewsSql.matchAll(/((?:^--.*\n)+)CREATE VIEW (\w+)/gm)].map((m) => ({
    name: m[2],
    about: m[1]
      .split("\n")
      .map((line) => line.replace(/^--\s?/, "").trim())
      .filter(Boolean)
      .join(" "),
  }));
}
