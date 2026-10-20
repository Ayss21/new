// Reads an uploaded sales file of any layout into daily sales records: one record per product per day.
//
// • Columns are found by their names, in any order and among any number of other columns: "Date",
//   "Order Date", "Product ID", "SKU", "Item", "Product Name", "Units Sold", "Quantity", "Qty", "Price",
//   "Discount", "Sales" … (case, spaces and punctuation don't matter). Rows above the header (a title, notes)
//   and total rows are skipped. A file without a header row is read by its contents.
// • A sheet with the dates across the top (one row per product, one column per day) is read as well.
// • Without a quantity column, a "Sales" column of whole numbers is the units sold. Without a product column,
//   the products are those of a column that names known products, else the categories.
// • Dates may be 2025-06-26, 26/06/2025, 06/26/2025, 26-Jun-2025, Jun 26, 2025, 20250626 or an Excel date.
//   Whether a date like 05/06/2025 is day- or month-first is worked out from the whole column (day first when
//   nothing tells).
// • Numbers may have thousands separators, a currency sign or a % sign. A discount above 1 is a percentage.
// • Rows for the same product and day are added up (several stores, or one row per sale); a row that repeats
//   an earlier row exactly is a duplicate and is left out.
// • Products are recognised by SKU or name (case and punctuation don't matter). The others are new products:
//   they come back in `newProducts`, with what the file says about them, for the server to add to the catalog.
import { excelSerialDate } from "./xlsx";

/** A header or a name as a comparison key: "Units Sold" → "unitssold". */
const headerKey = (text) =>
  String(text ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, "");
/** A SKU or product name as a comparison key: "pp 4012" and "PP-4012" are the same. */
export const productKey = (text) =>
  String(text ?? "")
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** The most products one upload may add to the catalog (more usually means the wrong column). */
export const MAX_NEW_PRODUCTS = 10000;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * What each column can hold, with the header names that say so. `exact` names are matched first, in the order
 * listed ("Region" before "State"), then the `partial` rules for columns still unnamed.
 */
const ROLES = [
  {
    role: "date",
    exact: ["date", "salesdate", "saledate", "orderdate", "transactiondate", "txndate", "invoicedate", "billdate", "day", "datetime", "timestamp", "period", "documentdate", "postingdate", "dateofsale", "datum", "fecha"],
    partial: (k) => k.includes("date") && !/(ship|due|deliver|expir|birth|join|create|update|modif|start|end)/.test(k),
  },
  {
    role: "units",
    exact: ["unitssold", "units", "quantity", "quantitysold", "qty", "qtysold", "soldqty", "soldquantity", "salesqty", "salesquantity", "salesunits", "unitsales", "unitsold", "noofunits", "numberofunits", "quantityordered", "orderquantity", "orderqty", "pieces", "pcs", "sold", "itemssold", "itemsold", "volume", "menge", "anzahl", "cantidad", "quantite", "qte", "quantita"],
    partial: (k) => /(qty|quantity|unitssold|unitsold|unitsales|sold)/.test(k) && !/(forecast|stock|inventory|return|price|cost|purchase|receiv|onhand|avail|reorder)/.test(k),
  },
  {
    role: "discountAmount",
    exact: ["discountamount", "discountamt", "discountvalue"],
    partial: (k) => /disc/.test(k) && /(amount|amt|value)/.test(k),
  },
  {
    role: "discount",
    exact: ["discountrate", "discount", "discountpercent", "discountpercentage", "discountpct", "disc", "discount%", "disc%", "discountrate%"],
    partial: (k) => k.startsWith("disc"),
  },
  {
    role: "price",
    exact: ["unitprice", "price", "sellingprice", "saleprice", "salesprice", "priceperunit", "unitsellingprice", "itemprice", "priceeach", "rate", "unitrate", "mrp", "listprice", "preis", "precio", "prix", "prezzo"],
    partial: (k) => k.includes("price") && !/(competitor|purchase|cost|total)/.test(k),
  },
  {
    role: "revenue",
    exact: ["sales", "revenue", "netrevenue", "netsales", "salesamount", "salesvalue", "amount", "totalamount", "totalsales", "totalrevenue", "netamount", "lineamount", "linetotal", "total", "turnover", "value", "umsatz", "betrag", "ventas", "importe", "ventes", "montant"],
    partial: (k) => /(revenue|sales|amount|turnover)/.test(k) && !/(qty|quantity|unit|count|tax|cost|profit|margin|target|forecast|person|rep|channel)/.test(k),
  },
  {
    role: "sku",
    exact: ["sku", "productid", "skuid", "skucode", "productcode", "productsku", "itemid", "itemcode", "itemno", "itemnumber", "productno", "productnumber", "partno", "partnumber", "materialcode", "materialno", "articlecode", "articleno", "articlenumber", "stockcode", "upc", "ean", "barcode", "asin", "code", "artikelnummer", "artikelnr", "codigo"],
    partial: (k) => /(sku|barcode)/.test(k) || (/(product|item|article|material|part)/.test(k) && /(id|code|no|num|nbr|number|key)$/.test(k)),
  },
  {
    role: "name",
    exact: ["productname", "itemname", "productdescription", "itemdescription", "description", "productdesc", "itemdesc", "producttitle", "particulars", "name", "title"],
    partial: (k) => /(product|item|article)/.test(k) && /(name|desc|title)/.test(k),
  },
  {
    role: "product",
    exact: ["product", "item", "products", "items", "article", "material", "artikel", "produkt", "producto", "produit", "articulo", "prodotto"],
    partial: (k) => /^(product|item)/.test(k) && !/(categor|type|group|class|line|family)/.test(k),
  },
  {
    role: "stock",
    exact: ["stock", "stocklevel", "stockonhand", "onhand", "onhandqty", "inventory", "inventorylevel", "inventoryonhand", "closingstock", "currentstock", "availablestock", "stockqty", "soh"],
    partial: (k) => /(stock|inventory|onhand)/.test(k) && !/(order|forecast|out|value|cost)/.test(k),
  },
  {
    role: "category",
    exact: ["category", "productcategory", "categoryname", "itemcategory", "productgroup", "productfamily", "productline", "producttype", "itemtype", "department", "dept", "type"],
    partial: (k) => k.includes("categor"),
  },
  {
    role: "region",
    exact: ["region", "salesregion", "area", "zone", "territory", "state", "province", "market", "country"],
    partial: (k) => /(region|zone|territor|province)/.test(k),
  },
  {
    role: "location",
    exact: ["location", "store", "storeid", "storename", "storecode", "storeno", "warehouse", "warehouseid", "branch", "branchname", "outlet", "outletname", "site", "shop", "shopname", "depot", "plant", "locationid", "city"],
    partial: (k) => /(store|warehouse|branch|outlet|location|depot)/.test(k),
  },
  {
    role: "channel",
    exact: ["channel", "saleschannel", "orderchannel", "distributionchannel"],
    partial: (k) => k.includes("channel"),
  },
];

/** Role → the column whose header names it. */
function rolesFromHeader(header) {
  const keys = header.map(headerKey);
  const found = {};
  const taken = new Set();
  const claim = (role, index) => {
    if (index < 0) return;
    found[role] = index;
    taken.add(index);
  };
  for (const spec of ROLES)
    for (const name of spec.exact) {
      const index = keys.findIndex((k, i) => k === name && !taken.has(i));
      if (index >= 0) {
        claim(spec.role, index);
        break;
      }
    }
  for (const spec of ROLES) if (found[spec.role] === undefined) claim(spec.role, keys.findIndex((k, i) => k && !taken.has(i) && spec.partial(k)));
  return found;
}

const productRoles = (found) => ["sku", "product", "name"].filter((role) => found[role] !== undefined).length;

/** A first row of names only (no dates or numbers) above rows that have them: a header we don't recognise. */
function looksLikeHeader(rows) {
  const values = (row) => row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
  const isData = (value) => readDate(value) !== null || readNumber(value) !== null;
  return rows.length > 1 && values(rows[0]).length > 0 && !values(rows[0]).some(isData) && values(rows[1]).some(isData);
}

/** The header row among the first rows: the one that names the most of date, product and quantity. */
function findHeader(rows) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const found = rolesFromHeader(rows[i]);
    const score = (found.date !== undefined) + (productRoles(found) > 0) + (found.units !== undefined);
    if (score >= 2 && (!best || score > best.score)) best = { index: i, found, score };
  }
  return best;
}

/**
 * A header row with the dates across the top (one column per day, one row per product, the units in the
 * cells): { index, dates: [{ index, date, text }] }, or null.
 */
function findWideHeader(rows) {
  for (let i = 0; i < Math.min(rows.length - 1, 15); i += 1) {
    const cells = rows[i].map((cell) => String(cell ?? "").trim());
    const order = dateOrder(cells);
    const dates = cells.flatMap((text, index) => {
      const date = readDate(text, order);
      return date ? [{ index, date, text }] : [];
    });
    if (dates.length < 2) continue;
    const isDate = new Set(dates.map((d) => d.index));
    const labels = cells.filter((text, index) => text && !isDate.has(index));
    const roles = rolesFromHeader(cells.map((text, index) => (isDate.has(index) ? "" : text)));
    // Labels are names (a row of data has numbers), and a sheet with a date or quantity column isn't wide
    if (labels.some((text) => readNumber(text) !== null) || roles.date !== undefined || roles.units !== undefined) continue;
    if (rows.slice(i + 1, i + 6).some((row) => dates.some((d) => readNumber(row[d.index]) !== null))) return { index: i, dates };
  }
  return null;
}

/** A wide sheet as one row per product and day: its other columns, then Date and Units. Empty cells are skipped. */
function unpivot(rows, wide) {
  const head = rows[wide.index].map((cell) => String(cell ?? "").trim());
  const isDate = new Set(wide.dates.map((d) => d.index));
  const width = Math.max(...rows.map((row) => row.length));
  const keep = Array.from({ length: width }, (_, i) => i).filter((i) => !isDate.has(i));
  const table = [[...keep.map((i) => head[i] || `Column ${i + 1}`), "Date", "Units"]];
  for (const row of rows.slice(wide.index + 1))
    for (const { index, date } of wide.dates) {
      const value = String(row[index] ?? "").trim();
      if (value) table.push([...keep.map((i) => row[i] ?? ""), date, value]);
    }
  return table;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const month = (word) => MONTHS[word.toLowerCase().slice(0, word.toLowerCase().startsWith("sept") ? 4 : 3)] ?? null;
const pad = (n) => String(n).padStart(2, "0");
const fullYear = (y) => (y.length === 2 ? (Number(y) < 70 ? 2000 : 1900) + Number(y) : Number(y));

/** "YYYY-MM-DD" when the parts make a real date between 1950 and 2100, otherwise null. */
function isoOf(y, m, d) {
  if (!(y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,].*)?$/;

/** Day-first or month-first for a column of dates like 05/06/2025: month-first only when a value says so. */
function dateOrder(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const value of values) {
    const m = NUMERIC_DATE.exec(String(value).trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst += 1;
    if (Number(m[2]) > 12) monthFirst += 1;
  }
  return monthFirst > dayFirst ? "MDY" : "DMY";
}

/** A date in any common form → "YYYY-MM-DD", or null. */
export function readDate(value, order = "DMY") {
  let text = String(value ?? "").trim();
  if (!text) return null;
  text = text.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, "");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(text);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = NUMERIC_DATE.exec(text);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])];
    return order === "MDY" ? isoOf(y, a, b) : isoOf(y, b, a);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[-\s./]*([A-Za-z]{3,9})\.?[-\s.,/]*(\d{2}|\d{4})(?:[ T,].*)?$/.exec(text);
  if (m && month(m[2])) return isoOf(fullYear(m[3]), month(m[2]), Number(m[1]));
  m = /^([A-Za-z]{3,9})\.?[-\s.]*(\d{1,2})(?:st|nd|rd|th)?,?[-\s./]*(\d{2}|\d{4})(?:[ T,].*)?$/.exec(text);
  if (m && month(m[1])) return isoOf(fullYear(m[3]), month(m[1]), Number(m[2]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  // An Excel day number (an .xlsx date cell, or one saved to CSV)
  if (/^\d{5}(\.\d+)?$/.test(text) && Number(text) >= 18000 && Number(text) <= 73000) return excelSerialDate(text);
  return null;
}

const CURRENCY = /^(rs\.?|inr|usd|sar|aed|eur|gbp|qar|kwd|omr|bhd)\s*|\s*(rs\.?|inr|usd|sar|aed|eur|gbp|qar|kwd|omr|bhd)$/gi;

/**
 * A number, possibly with a currency sign or code, thousands separators, a % sign, brackets for a negative or
 * an exponent ("₹1,234.50", "12 %", "(5)", "1.234,5", "1.5E-2") → { value, percent }, or null for anything
 * else ("P0001", "abc").
 */
export function readNumber(value) {
  let text = String(value ?? "").trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  const percent = /%\s*$/.test(text);
  text = text.replace(/%\s*$/, "").replace(CURRENCY, "").replace(/[₹$€£¥\s ']/g, "");
  if (/^[-+]/.test(text)) {
    negative = negative !== text.startsWith("-");
    text = text.slice(1);
  }
  if (/^(\d+\.?\d*|\.\d+)e[-+]?\d+$/i.test(text)) {
    const number = Number(text) * (negative ? -1 : 1);
    return Number.isFinite(number) ? { value: number, percent } : null;
  }
  if (!/^[\d.,]+$/.test(text)) return null;
  if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", "."); // 12,5 = 12.5
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) && text.includes(",")) text = text.replace(/\./g, "").replace(",", "."); // 1.234,5
  else text = text.replace(/,/g, ""); // 1,234.5
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const number = Number(text) * (negative ? -1 : 1);
  return Number.isFinite(number) ? { value: number, percent } : null;
}

const round = (value, digits) => Number(value.toFixed(digits));

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The value seen most often (the first one on a tie), or null. */
function mostCommon(counts) {
  let best = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)) best = value;
  return best;
}

const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,39}$/;

/** A SKU for a new product: its ID as written (upper case), or one made from its name. */
function newSku(id, name, taken) {
  const asId = ID_LIKE.test(id ?? "") ? id.toUpperCase() : null;
  const base =
    asId ??
    (String(name || id || "PRODUCT")
      .normalize("NFKD")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "PRODUCT");
  let sku = base;
  for (let n = 2; taken.has(productKey(sku)); n += 1) sku = `${base}-${n}`;
  taken.add(productKey(sku));
  return sku;
}

/** ["a", "b", "c"] → "a, b and c". */
const listed = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);

const COLUMN_HINTS = {
  date: "a date column (Date, Order Date …)",
  product: "a product column (SKU, Product ID, Item or Product Name …)",
  units: "a quantity column (Units Sold, Quantity, Qty …)",
};

/** A row that sums the others ("Total", "Grand Total", "Subtotal"), not a sale. */
const SUMMARY = /^(grand\s*|sub\s*-?\s*)?totals?\s*:?$/i;

const textAt = (row, index) => (index === undefined ? "" : String(row[index] ?? "").trim());

/** The share of a column's filled cells (in the first 500 rows) that pass `test`; 0 for an empty column. */
function shareOf(body, index, test) {
  const values = body
    .slice(0, 500)
    .map((row) => textAt(row, index))
    .filter(Boolean);
  return values.length ? values.filter(test).length / values.length : 0;
}

const isWhole = (text) => {
  const n = readNumber(text);
  return Boolean(n) && !n.percent && n.value >= 0 && Number.isInteger(round(n.value, 6));
};
const isText = (text) => readNumber(text) === null && readDate(text) === null;
const isDate = (text) => readDate(text, "DMY") !== null || readDate(text, "MDY") !== null;

/**
 * The first of `columns` that holds dates, judged by its contents: written dates first; a column of bare
 * numbers (Excel day numbers, 20250626) only when there's none, as codes and postcodes look the same.
 */
function columnOfDates(body, columns) {
  return (
    columns.find((i) => shareOf(body, i, (v) => !/^\d+(\.\d+)?$/.test(v) && isDate(v)) >= 0.8) ??
    columns.find((i) => shareOf(body, i, isDate) >= 0.8)
  );
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

const empty = (errors, total = 0, columns = {}) => ({
  total,
  valid: 0,
  combined: 0,
  missing: 0,
  duplicates: 0,
  invalidDates: 0,
  invalidNumeric: 0,
  errors,
  records: [],
  newProducts: [],
  columns,
});

/**
 * Validates the rows of an uploaded sales file (rows of cell texts, header included) against the product
 * catalog (each product: { sku, name, category, location, region, channel, unitPrice }).
 * → { total, valid, combined, missing, duplicates, invalidDates, invalidNumeric, errors, records, newProducts,
 *     columns }
 *   total = data rows (with the dates across the top: one per product and date that has a value);
 *   valid = records (one per product and day); combined = rows added to another row's product and day;
 *   missing / duplicates / invalidDates / invalidNumeric = rows left out (each counted once);
 *   columns = the file's column for each role ({ date: "Order Date", product: "Product ID", units: "Qty" … }).
 */
export function importSales(rows, catalog) {
  let filled = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (!filled.length) return empty(["The file is empty."]);

  // Which column holds what
  let header = findHeader(filled);
  let across = null; // with the dates across the top: "01/06/2025 … 30/06/2025"
  if (!header) {
    const wide = findWideHeader(filled);
    if (wide) {
      const label = (d) => (/^\d+(\.\d+)?$/.test(d.text) ? d.date : d.text); // an Excel day number as a date
      across = `${label(wide.dates[0])} … ${label(wide.dates.at(-1))}`;
      filled = unpivot(filled, wide);
      header = { index: 0, found: rolesFromHeader(filled[0]) };
      // A row's total or amount isn't a day's
      delete header.found.revenue;
      delete header.found.discountAmount;
    }
  }
  header ??= looksLikeHeader(filled) ? { index: 0, found: rolesFromHeader(filled[0]) } : null;
  let found;
  let names;
  let body;
  if (header) {
    found = header.found;
    names = filled[header.index].map((cell, i) => String(cell ?? "").replace(/^\uFEFF/, "").trim() || `Column ${i + 1}`);
    body = filled.slice(header.index + 1);
  } else {
    // No header: read the columns by their contents
    body = filled;
    const width = Math.max(...body.map((row) => row.length));
    names = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    found = rolesFromContents(body, width, catalog);
  }
  const width = Math.max(names.length, ...body.slice(0, 500).map((row) => row.length));
  const free = () => Array.from({ length: width }, (_, i) => i).filter((i) => !Object.values(found).includes(i));

  // A date column under a name we don't know: the first column of dates
  if (found.date === undefined) {
    const dates = columnOfDates(body, free());
    if (dates !== undefined) found.date = dates;
  }
  // No quantity column: a "Sales" column of whole numbers is the units sold (unless a price says it's money)
  if (found.units === undefined && found.price === undefined && found.revenue !== undefined && /(sales|sold)/.test(headerKey(names[found.revenue])) && shareOf(body, found.revenue, isWhole) >= 0.98) {
    found.units = found.revenue;
    delete found.revenue;
  }
  // No product column: one that names known products; with the dates across the top, the first column of
  // names; else the categories
  const known = new Set(catalog.flatMap((p) => [productKey(p.sku), productKey(p.name)]));
  let identifier = found.sku ?? found.product ?? found.name;
  identifier ??= free().find((i) => shareOf(body, i, (v) => known.has(productKey(v))) >= 0.5);
  if (across) identifier ??= free().find((i) => shareOf(body, i, isText) >= 0.8);
  identifier ??= found.category;
  const nameColumn = [found.name, found.product].find((index) => index !== undefined && index !== identifier);

  const columns = Object.fromEntries(
    Object.entries({ ...found, product: identifier, sku: undefined, name: nameColumn })
      .filter(([, index]) => index !== undefined)
      .map(([role, index]) => [role, names[index]]),
  );
  if (across) Object.assign(columns, { date: across, units: across });
  const lacking = [found.date === undefined && "date", identifier === undefined && "product", found.units === undefined && "units"].filter(Boolean);
  if (lacking.length)
    return empty(
      [`Couldn't find ${listed(lacking.map((role) => COLUMN_HINTS[role]))}. Columns in the file: ${names.slice(0, 12).join(", ")}${names.length > 12 ? " …" : ""}.`],
      body.length,
      columns,
    );
  // Total rows aren't sales
  body = body.filter((row) => !row.some((cell) => SUMMARY.test(String(cell ?? "").trim())));
  if (!body.length) return empty(["The file has a header but no rows."], 0, columns);

  const order = dateOrder(body.slice(0, 2000).map((row) => textAt(row, found.date)));
  // A discount column with values above 1 holds percentages (5 = 5%)
  const discountPercent = found.discount !== undefined && body.some((row) => (readNumber(textAt(row, found.discount))?.value ?? 0) > 1);

  const bySku = new Map(catalog.map((p) => [productKey(p.sku), p]));
  const byName = new Map(catalog.map((p) => [productKey(p.name), p]));
  const taken = new Set(bySku.keys());
  const newBy = new Map(); // product key → new product being collected
  const groups = new Map(); // date|sku → { date, product, units, gross, net, first }
  const seen = new Set();
  const counts = { missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, combined: 0 };
  const examples = {};
  const note = (kind, value) => {
    counts[kind] += 1;
    if (examples[kind] === undefined) examples[kind] = value;
  };

  body.forEach((row, rowIndex) => {
    const signature = row.map((value) => String(value ?? "").trim()).join("\u0001");
    if (seen.has(signature)) return note("duplicates", rowIndex);
    seen.add(signature);
    const dateText = textAt(row, found.date);
    const id = textAt(row, identifier);
    const name = textAt(row, nameColumn);
    const unitsText = textAt(row, found.units);
    if (!dateText || !(id || name) || unitsText === "") return note("missing", rowIndex);
    const date = readDate(dateText, order);
    if (!date) return note("invalidDates", dateText);
    const units = readNumber(unitsText);
    if (!units || units.value < 0 || !Number.isInteger(round(units.value, 6))) return note("invalidNumeric", unitsText);
    const u = Math.round(units.value);

    // The product: by SKU, then by name; otherwise a new one (added below once the row has passed)
    const product = bySku.get(productKey(id)) ?? byName.get(productKey(id)) ?? (name ? (byName.get(productKey(name)) ?? bySku.get(productKey(name))) : null);

    // Price and discount: the file's, else worked out from its revenue, else the product's list price
    const priceText = textAt(row, found.price);
    const discountText = textAt(row, found.discount);
    const amountText = textAt(row, found.discountAmount);
    const revenueText = textAt(row, found.revenue);
    const price = priceText ? readNumber(priceText) : null;
    if (priceText && (!price || price.value < 0)) return note("invalidNumeric", priceText);
    let discount = 0;
    if (discountText) {
      const d = readNumber(discountText);
      if (!d) return note("invalidNumeric", discountText);
      discount = d.percent || discountPercent ? d.value / 100 : d.value;
      if (discount < 0 || discount > 1) return note("invalidNumeric", discountText);
    }
    let p = price?.value;
    if (p === undefined && revenueText) {
      const revenue = readNumber(revenueText);
      if (!revenue || revenue.value < 0) return note("invalidNumeric", revenueText);
      if (u > 0) p = revenue.value / u / (1 - Math.min(discount, 0.9999));
    }
    if (p === undefined) p = product?.unitPrice ?? 0;
    if (amountText && u > 0 && p > 0) {
      const amount = readNumber(amountText);
      if (!amount || amount.value < 0 || amount.value > u * p) return note("invalidNumeric", amountText);
      discount = amount.value / (u * p);
    }

    // What the file says about a new product
    let fresh = null;
    if (!product) {
      const k = productKey(id || name);
      fresh = newBy.get(k);
      if (!fresh) {
        fresh = { key: k, id, name: name || (ID_LIKE.test(id) ? "" : id), attributes: { category: new Map(), region: new Map(), location: new Map(), channel: new Map() }, prices: [], stock: new Map() };
        newBy.set(k, fresh);
      }
      for (const role of ["category", "region", "location", "channel"]) {
        const value = textAt(row, found[role]);
        if (value) fresh.attributes[role].set(value, (fresh.attributes[role].get(value) ?? 0) + 1);
      }
      if (p > 0) fresh.prices.push(p);
      const stock = readNumber(textAt(row, found.stock));
      if (stock && stock.value >= 0) fresh.stock.set(date, (fresh.stock.get(date) ?? 0) + Math.round(stock.value));
    }

    // Rows for the same product and day are added up
    const groupKey = `${date}|${product ? product.sku : `new:${fresh.key}`}`;
    const group = groups.get(groupKey);
    const gross = u * p;
    if (group) {
      counts.combined += 1;
      group.units += u;
      group.gross += gross;
      group.net += gross * (1 - discount);
    } else groups.set(groupKey, { date, product, fresh, units: u, gross, net: gross * (1 - discount), first: rowIndex });
  });

  // New products, with what the file said about them
  if (newBy.size > MAX_NEW_PRODUCTS)
    return empty(
      [`The file names ${newBy.size.toLocaleString()} products that aren't in the catalog (at most ${MAX_NEW_PRODUCTS.toLocaleString()} at a time). Check that "${columns.product}" is the product column.`],
      body.length,
      columns,
    );
  const newProducts = [...newBy.values()].map((fresh) => {
    const dates = [...fresh.stock.keys()].sort();
    const product = {
      sku: newSku(fresh.id, fresh.name, taken),
      name: fresh.name || fresh.id,
      category: mostCommon(fresh.attributes.category) ?? "Uncategorized",
      region: mostCommon(fresh.attributes.region) ?? "Unassigned",
      location: mostCommon(fresh.attributes.location) ?? "Unassigned",
      channel: mostCommon(fresh.attributes.channel) ?? "Unassigned",
      unitPrice: round(median(fresh.prices) ?? 0, 2),
      stock: dates.length ? fresh.stock.get(dates.at(-1)) : null,
    };
    fresh.product = product;
    return product;
  });

  const stamp = Date.now();
  const records = [...groups.values()]
    .map((group) => {
      const product = group.product ?? group.fresh.product;
      const unitPrice = group.units ? round(group.gross / group.units, 2) : round(product.unitPrice ?? 0, 2);
      const discountRate = group.gross > 0 ? round(1 - group.net / group.gross, 4) : 0;
      return {
        id: `UPL-${stamp}-${group.first}`,
        date: group.date,
        sku: product.sku,
        category: product.category,
        location: product.location,
        region: product.region,
        channel: product.channel,
        units: group.units,
        unitPrice,
        discountRate,
        netRevenue: round(group.units * unitPrice * (1 - discountRate), 2),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku));

  const result = { total: body.length, valid: records.length, ...counts, errors: [], records, newProducts: records.length ? newProducts : [], columns };
  if (!records.length) result.errors.push(noRowsMessage(body.length, counts, examples));
  return result;
}

/** Why no row could be used, biggest reason first: "None of the 120 rows could be used: 120 have a date …". */
function noRowsMessage(total, counts, examples) {
  const has = (n) => `${n.toLocaleString()} ${n === 1 ? "has" : "have"}`;
  const reasons = [
    ["invalidDates", (n, e) => `${has(n)} a date that can't be read (such as "${e}")`],
    ["invalidNumeric", (n, e) => `${has(n)} a number that can't be used (such as "${e}")`],
    ["missing", (n) => `${has(n)} no date, product or quantity`],
    ["duplicates", (n) => `${n.toLocaleString()} ${n === 1 ? "repeats" : "repeat"} an earlier row`],
  ]
    .filter(([kind]) => counts[kind])
    .sort(([a], [b]) => counts[b] - counts[a])
    .map(([kind, text]) => text(counts[kind], examples[kind]));
  return `None of the ${total.toLocaleString()} rows could be used: ${reasons.join("; ")}.`;
}

/** Without a header row: the date, product and quantity columns worked out from what the cells hold. */
function rolesFromContents(body, width, catalog) {
  const known = new Set(catalog.flatMap((p) => [productKey(p.sku), productKey(p.name)]));
  const found = {};
  const free = () => Array.from({ length: width }, (_, i) => i).filter((i) => !Object.values(found).includes(i));
  found.date = columnOfDates(body, free());
  found.product =
    free().find((i) => shareOf(body, i, (v) => known.has(productKey(v))) >= 0.5) ??
    free().find((i) => {
      const list = body
        .slice(0, 500)
        .map((row) => textAt(row, i))
        .filter(Boolean);
      return shareOf(body, i, isText) >= 0.8 && new Set(list).size <= Math.max(1, list.length * 0.5);
    });
  found.units = free().find((i) => shareOf(body, i, isWhole) >= 0.9);
  return Object.fromEntries(Object.entries(found).filter(([, index]) => index !== undefined));
}
