// /sales and /datasets — sales records, file uploads (any layout: CSV, text or Excel), cleaning (demo backend).
// Every upload attempt is a dataset, so GET /datasets is also the dataset history.
import { CURRENT_SNAPSHOT_MONTH } from "../../../data/seed";
import { cleanDataset, dateBounds, filterSales, inventoryForNewProduct, parseSalesCsv, parseSalesTable, updateSnapshotItems, validationLabel } from "../../../lib/domain";
import { datasetCoverage } from "../../../lib/lineage";
import { readXlsxSheets } from "../../../lib/xlsx";
import { nextId } from "../db";
import { created, fail, invalid, logError, logEvent, now, ok, requireAction } from "../http";
import { apiDataset, apiDatasets, filtersFromQuery } from "../shapes";

const MAX_MB = 50;

/** What a file is, from its first bytes (not its name): an Excel workbook, an old Excel file, a PDF, other binary or text. */
function kindOf(bytes) {
  const starts = (...values) => values.every((value, i) => bytes[i] === value);
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "xlsx";
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return "xls";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "pdf";
  if (starts(0xff, 0xfe) || starts(0xfe, 0xff)) return "text"; // UTF-16 ("Unicode text" from Excel)
  return bytes.subarray(0, 4096).includes(0) ? "binary" : "text";
}

/** Text in UTF-8, UTF-16 (with its byte order mark) or, failing UTF-8, Windows-1252. */
function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const UNREADABLE = {
  xls: "Excel 97–2003 (.xls) files can't be read. Save it as .xlsx or CSV and upload it again.",
  pdf: "A PDF can't be read as sales data. Upload a CSV, text or Excel (.xlsx) file.",
  binary: "Unsupported file type. Upload a CSV, text or Excel (.xlsx) file.",
};

/**
 * Reads and validates an uploaded file, whatever its name: delimited text, or an Excel workbook — its first
 * sheet with sales on it (a workbook may start with notes or a summary); when none has, what the fullest
 * sheet lacks.
 */
async function readUpload(bytes, catalog) {
  if (kindOf(bytes) !== "xlsx") return parseSalesCsv(decodeText(bytes), catalog);
  let fullest = null;
  for (const sheet of await readXlsxSheets(bytes)) {
    const result = parseSalesTable(sheet.rows, catalog);
    if (result.valid) return result;
    if (!fullest || result.total > fullest.total) fullest = result;
  }
  return fullest;
}

/** The validation counts returned with an upload (the records themselves stay on the server). */
function validationSummary(v) {
  return {
    total: v.total,
    valid: v.valid,
    combined: v.combined,
    missing: v.missing,
    duplicates: v.duplicates,
    invalidDates: v.invalidDates,
    invalidNumeric: v.invalidNumeric,
    errors: v.errors,
    columns: v.columns,
  };
}

/** The next category ID: CAT- and one more than the highest number in use. */
function nextCategoryId(categories) {
  const highest = Math.max(0, ...categories.map((c) => Number(/^CAT-(\d+)$/.exec(c.id)?.[1] ?? 0)));
  return `CAT-${String(highest + 1).padStart(3, "0")}`;
}

/**
 * Adds the products a file named that the catalog didn't have (and their categories, if new): stock from the
 * file or 0, reorder level and safety stock from their sales in the file. Their records take the category's
 * name as the catalog writes it. Returns the new products' SKUs.
 */
function addNewProducts(req, newProducts, records, fileName) {
  const recordsOf = new Map(newProducts.map((fresh) => [fresh.sku, []]));
  for (const record of records) recordsOf.get(record.sku)?.push(record);
  const items = [];
  for (const fresh of newProducts) {
    let category = req.db.categories.find((c) => c.name.toLowerCase() === fresh.category.toLowerCase());
    if (!category) {
      category = { id: nextCategoryId(req.db.categories), name: fresh.category, description: `Added from ${fileName}`, status: "Active" };
      req.db.categories.push(category);
    }
    const own = recordsOf.get(fresh.sku);
    for (const record of own) record.category = category.name;
    const item = inventoryForNewProduct({ ...fresh, category: category.name }, own);
    req.db.inventory.push(item);
    items.push({ item, product: item });
  }
  req.db.snapshots = updateSnapshotItems(req.db.snapshots, CURRENT_SNAPSHOT_MONTH, dateBounds(req.db.sales).end, items);
  return newProducts.map((fresh) => fresh.sku);
}

/** GET /sales?start&end&category&sku&region (lists repeat) */
export function list(req) {
  const hasFilters = Object.keys(req.query).some((key) => req.query[key]);
  return ok(hasFilters ? filterSales(req.db.sales, filtersFromQuery(req.query, req.db.sales)) : req.db.sales);
}

/** GET /datasets — every upload attempt, newest first, with its lineage and forecasting status */
export function datasets(req) {
  return ok(apiDatasets(req.db));
}

/** POST /datasets (multipart/form-data, field "file": a sales file of any layout — CSV, TSV, text or .xlsx) */
export async function upload(req) {
  requireAction(req, "Upload sales");
  const form = req.body;
  const upload = typeof FormData !== "undefined" && form instanceof FormData ? form.get("file") : null;
  if (!upload || typeof upload === "string") invalid({ file: "Attach the sales file in the form field \"file\"." });
  const fileName = upload.name || "upload.csv";
  if (upload.size > MAX_MB * 1024 * 1024) fail(413, "file_too_large", `The file exceeds the ${MAX_MB} MB limit.`);
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const kind = kindOf(bytes);
  if (UNREADABLE[kind]) fail(415, "unsupported_file", UNREADABLE[kind]);

  let validation;
  try {
    validation = await readUpload(bytes, req.db.inventory);
  } catch (error) {
    const reason = error instanceof Error && error.message.includes(".xlsx") ? error.message : "The file could not be read.";
    validation = { total: 0, valid: 0, combined: 0, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, errors: [reason], records: [], newProducts: [], columns: {} };
  }
  const user = req.user;
  const base = {
    id: nextId("DS"),
    fileName,
    uploadedAt: now(),
    uploader: user.name,
    uploaderId: user.id,
    checks: {
      total: validation.total,
      valid: validation.valid,
      combined: validation.combined,
      missing: validation.missing,
      duplicates: validation.duplicates,
      invalidDates: validation.invalidDates,
      invalidNumeric: validation.invalidNumeric,
    },
    cleanedAt: null,
    cleaningSummary: null,
  };

  if (validation.errors.length || !validation.valid) {
    const reason = validation.errors.join(" ") || "No valid records were found in the file.";
    // A rejected file never reaches cleaning or forecasting, but the attempt is recorded
    const dataset = { ...base, recordCount: 0, validation: "Failed", coverage: null, cleaning: "Not started", pendingRecords: [], newProducts: [], error: reason };
    req.db.datasets.unshift(dataset);
    logEvent(req, "Dataset upload failed", "Sales Upload", "Failed", `${fileName} · ${reason}`);
    logError(req, "Sales Upload", "Invalid file", "Error", reason);
    fail(422, "invalid_file", reason, { validation: validationSummary(validation), dataset: apiDataset(req.db, dataset.id) });
  }

  // Every record keeps the ID of the upload it came from — the start of its lineage
  const records = validation.records.map((record) => ({ ...record, datasetId: base.id }));
  // Products the catalog didn't have join it now, so their records are cleaned and forecast like any other
  const added = addNewProducts(req, validation.newProducts, records, fileName);
  const dataset = {
    ...base,
    recordCount: validation.valid,
    validation: validationLabel(validation),
    coverage: datasetCoverage(records),
    cleaning: "Pending",
    pendingRecords: records,
    newProducts: added,
    error: null,
  };
  req.db.datasets.unshift(dataset);
  logEvent(req, "Dataset uploaded", "Sales Upload", "Completed", `${fileName} · ${validation.valid.toLocaleString()} valid records`);
  if (added.length)
    logEvent(req, "Products added", "Sales Upload", "Completed", `${fileName} · ${added.slice(0, 10).join(", ")}${added.length > 10 ? ` and ${added.length - 10} more` : ""}`);
  return created({ dataset: apiDataset(req.db, dataset.id), validation: validationSummary(validation) });
}

/** POST /datasets/{id}/clean { capOutliers, overlap: "replace" | "skip" } */
export function clean(req) {
  requireAction(req, "Clean data");
  const dataset = req.db.datasets.find((d) => d.id === req.params.id);
  if (!dataset) fail(404, "not_found", "That dataset no longer exists.");
  if (dataset.cleaning !== "Pending" || !dataset.pendingRecords.length)
    fail(409, "not_pending", `${dataset.fileName} is not waiting for cleaning.`);
  const { capOutliers = true, overlap = "replace" } = req.body ?? {};
  invalid({
    capOutliers: typeof capOutliers !== "boolean" && "Use true or false.",
    overlap: !["replace", "skip"].includes(overlap) && 'Use "replace" or "skip".',
  });
  // Rows left out at validation (rows added to another row's product and day weren't left out)
  const excluded = dataset.checks ? dataset.checks.total - dataset.checks.valid - (dataset.checks.combined ?? 0) : 0;
  const { merged, summary } = cleanDataset(dataset.pendingRecords, req.db.sales, { capOutliers, overlap }, excluded, req.user.name);
  req.db.sales = merged;
  Object.assign(dataset, { cleaning: "Completed", cleanedAt: summary.cleanedAt, pendingRecords: [], cleaningSummary: summary });
  logEvent(req, "Data cleaned", "Sales Upload", "Completed", `${dataset.fileName} · ${summary.added + summary.replaced} records merged`);
  return ok({ dataset: apiDataset(req.db, dataset.id), summary, salesRange: dateBounds(merged) });
}
