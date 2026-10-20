// Uploads of any layout: columns found by name or contents, dates and numbers in common forms, rows added up
// per product and day, products matched by SKU or name, new products returned for the catalog.
import { describe, expect, it } from "vitest";
import { detectDelimiter, parseSalesCsv, products, splitDelimited } from "./domain";
import { importSales, readDate, readNumber } from "./salesImport";

const csv = (lines) => lines.join("\n");

describe("reading values", () => {
  it("reads dates in the usual forms", () => {
    expect(readDate("2025-06-26")).toBe("2025-06-26");
    expect(readDate("2025/6/26 14:05")).toBe("2025-06-26");
    expect(readDate("2025-06-26T00:00:00.000Z")).toBe("2025-06-26");
    expect(readDate("26/06/2025")).toBe("2025-06-26");
    expect(readDate("26-06-25")).toBe("2025-06-26");
    expect(readDate("06/26/2025", "MDY")).toBe("2025-06-26");
    expect(readDate("26 Jun 2025")).toBe("2025-06-26");
    expect(readDate("26-Jun-2025")).toBe("2025-06-26");
    expect(readDate("June 26, 2025")).toBe("2025-06-26");
    expect(readDate("Thu, 26 Jun 2025")).toBe("2025-06-26");
    expect(readDate("20250626")).toBe("2025-06-26");
    expect(readDate("45834")).toBe("2025-06-26"); // an Excel date
    expect(readDate("31/02/2025")).toBeNull();
    expect(readDate("2025-13-40")).toBeNull();
    expect(readDate("soon")).toBeNull();
  });

  it("reads numbers with currency signs, separators and percentages, and nothing else", () => {
    expect(readNumber("1,234.50")).toEqual({ value: 1234.5, percent: false });
    expect(readNumber("₹ 248")).toEqual({ value: 248, percent: false });
    expect(readNumber("USD 12.5")).toEqual({ value: 12.5, percent: false });
    expect(readNumber("12,5")).toEqual({ value: 12.5, percent: false });
    expect(readNumber("1.234,5")).toEqual({ value: 1234.5, percent: false });
    expect(readNumber("5%")).toEqual({ value: 5, percent: true });
    expect(readNumber("(3)")).toEqual({ value: -3, percent: false });
    expect(readNumber("-2")).toEqual({ value: -2, percent: false });
    expect(readNumber("1.5E-2")).toEqual({ value: 0.015, percent: false }); // how Excel writes some decimals
    expect(readNumber("P0001")).toBeNull();
    expect(readNumber("abc")).toBeNull();
    expect(readNumber("")).toBeNull();
  });

  it("finds the delimiter even below a title line", () => {
    expect(detectDelimiter("Sales report, June\nDate;Product;Qty\n2025-06-26;PP-4012;4\n2025-06-27;PP-4012;5\n")).toBe(";");
    expect(detectDelimiter("Date\tSKU\tUnits\n2025-06-26\tPP-4012\t4\n")).toBe("\t");
    expect(detectDelimiter("Date|SKU|Units\n2025-06-26|PP-4012|4\n")).toBe("|");
  });
});

describe("any file layout", () => {
  it("reads a many-column, several-store file and returns its new products", () => {
    const file = csv([
      "Date,Store ID,Product ID,Category,Region,Inventory Level,Units Sold,Units Ordered,Demand Forecast,Price,Discount,Weather Condition,Competitor Pricing",
      "2024-01-01,S001,P0001,Groceries,North,231,127,55,135.47,33.50,20,Rainy,29.69",
      "2024-01-01,S002,P0001,Groceries,South,150,73,66,80.1,30.00,10,Sunny,31.00",
      "2024-01-01,S001,P0002,Toys,North,204,150,66,144.04,63.01,0,Sunny,66.16",
      "2024-01-02,S001,P0001,Groceries,North,104,50,20,52.2,33.50,0,Cloudy,30.10",
      "2024-01-02,S002,P0001,Groceries,North,90,10,20,12.0,30.00,0,Cloudy,30.10",
    ]);
    const result = parseSalesCsv(file);
    expect(result).toMatchObject({ total: 5, valid: 3, combined: 2, missing: 0, duplicates: 0, invalidDates: 0, invalidNumeric: 0, errors: [] });
    expect(result.columns).toMatchObject({ date: "Date", product: "Product ID", units: "Units Sold", price: "Price", discount: "Discount", stock: "Inventory Level", location: "Store ID" });
    // Both stores added up: 127 + 73 units; 20% and 10% off (Discount above 1 → percentages)
    const day1 = result.records.find((r) => r.sku === "P0001" && r.date === "2024-01-01");
    expect(day1.units).toBe(200);
    expect(day1.unitPrice).toBe(Number(((127 * 33.5 + 73 * 30) / 200).toFixed(2)));
    expect(day1.netRevenue).toBeCloseTo(127 * 33.5 * 0.8 + 73 * 30 * 0.9, 0);
    expect(result.newProducts).toEqual([
      { sku: "P0001", name: "P0001", category: "Groceries", region: "North", location: "S001", channel: "Unassigned", unitPrice: 31.75, stock: 194 },
      { sku: "P0002", name: "P0002", category: "Toys", region: "North", location: "S001", channel: "Unassigned", unitPrice: 63.01, stock: 204 },
    ]);
    expect(result.records.every((r) => r.category === (r.sku === "P0001" ? "Groceries" : "Toys"))).toBe(true);
  });

  it("matches known products by SKU or name in any spelling, under a title row, with day-first dates", () => {
    const file = csv([
      "Weekly sales export",
      "",
      "Sale Date,Item Code,Description,Qty,Amount,Notes",
      '26-06-2025,pp4012,Polypropylene 4012,10,"2,480.00",ok',
      "27-06-2025,,HDPE Resin 7820,4,896,",
      "13-06-2025,PC 3308,,2,,",
    ]);
    const result = parseSalesCsv(file);
    expect(result).toMatchObject({ total: 3, valid: 3, newProducts: [], errors: [] });
    expect(result.records.map((r) => [r.date, r.sku, r.units, r.unitPrice])).toEqual([
      ["2025-06-13", "PC-3308", 2, products.find((p) => p.sku === "PC-3308").unitPrice], // no price or amount → list price
      ["2025-06-26", "PP-4012", 10, 248],
      ["2025-06-27", "PE-7820", 4, 224],
    ]);
  });

  it("reads month-first dates when the column says so", () => {
    const result = parseSalesCsv(csv(["Date,SKU,Units", "06/26/2025,PP-4012,1", "06/02/2025,PP-4012,2"]));
    expect(result.records.map((r) => r.date)).toEqual(["2025-06-02", "2025-06-26"]);
  });

  it("works out prices from a sales amount, and makes SKUs for products known only by name", () => {
    const file = csv([
      "Order ID,Order Date,Product Name,Sales,Quantity,Discount",
      "CA-1,11/8/2016,Bush Somerset Bookcase,261.96,2,0",
      "CA-2,11/8/2016,Bush Somerset Bookcase,130.98,1,0",
      "CA-3,6/12/2016,Self-Adhesive Labels,14.62,2,0",
      "CA-4,11/22/2016,Self-Adhesive Labels,7.31,1,0",
    ]);
    const result = parseSalesCsv(file);
    // 11/22/2016 can only be month-first, so the whole column is
    expect(result).toMatchObject({ valid: 3, combined: 1, errors: [] });
    expect(result.newProducts.map((p) => [p.sku, p.name, p.unitPrice])).toEqual([
      ["BUSH-SOMERSET-BOOKCASE", "Bush Somerset Bookcase", 130.98],
      ["SELF-ADHESIVE-LABELS", "Self-Adhesive Labels", 7.31],
    ]);
    const bookcase = result.records.find((r) => r.sku === "BUSH-SOMERSET-BOOKCASE");
    expect(bookcase).toMatchObject({ date: "2016-11-08", units: 3, unitPrice: 130.98, netRevenue: 392.94 });
  });

  it("reads a file without a header row by its contents", () => {
    const result = importSales(splitDelimited(csv(["2025-06-26,PP-4012,40,248", "2025-06-27,PE-7820,38,224", "2025-06-27,PP-4012,41,248"])), products);
    expect(result).toMatchObject({ total: 3, valid: 3, errors: [] });
    expect(result.columns).toMatchObject({ date: "Column 1", product: "Column 2", units: "Column 3" });
  });

  it("leaves out exact repeats and unusable rows, and says why nothing could be used", () => {
    const file = csv(["Date,SKU,Units", "2025-06-26,PP-4012,4", "2025-06-26,PP-4012,4", "2025-06-27,PP-4012,2.5", ",PP-4012,1", "2025-02-30,PP-4012,1"]);
    expect(parseSalesCsv(file)).toMatchObject({ total: 5, valid: 1, duplicates: 1, invalidNumeric: 1, missing: 1, invalidDates: 1 });
    const bad = parseSalesCsv(csv(["Date,SKU,Units", "31.31.2025,PP-4012,4", "32/01/2025,PP-4012,1", "2025-06-26,PP-4012,lots"]));
    expect(bad.valid).toBe(0);
    expect(bad.errors).toEqual(['None of the 3 rows could be used: 2 have a date that can\'t be read (such as "31.31.2025"); 1 has a number that can\'t be used (such as "lots").']);
  });

  it("says which column it couldn't find, and refuses a wrong product column", () => {
    expect(parseSalesCsv(csv(["Date,Customer,Amount", "2025-06-26,Acme,100"])).errors[0]).toBe(
      "Couldn't find a product column (SKU, Product ID, Item or Product Name …) and a quantity column (Units Sold, Quantity, Qty …). Columns in the file: Date, Customer, Amount.",
    );
    const many = ["Date,Item,Qty", ...Array.from({ length: 10001 }, (_, i) => `2025-06-26,X${i},1`)];
    expect(parseSalesCsv(csv(many)).errors[0]).toBe(
      `The file names ${(10001).toLocaleString()} products that aren't in the catalog (at most ${(10000).toLocaleString()} at a time). Check that "Item" is the product column.`,
    );
  });
});

describe("more layouts", () => {
  it("reads a sheet with the dates across the top, leaving out its totals", () => {
    const file = csv([
      "Daily sales,,,,",
      "Code,Description,01-06-2025,02-06-2025,03-06-2025,Total",
      "PP-4012,Polypropylene 4012,4,,6,10",
      "NEW-1,Garden hose,1,2,0,3",
      "Grand Total,,5,2,6,13",
    ]);
    const result = parseSalesCsv(file);
    // one row per product and date with a value (the empty cell is no sale)
    expect(result).toMatchObject({ total: 5, valid: 5, combined: 0, errors: [] });
    expect(result.columns).toMatchObject({ date: "01-06-2025 … 03-06-2025", units: "01-06-2025 … 03-06-2025", product: "Code", name: "Description" });
    expect(result.records.map((r) => [r.date, r.sku, r.units])).toEqual([
      ["2025-06-01", "NEW-1", 1],
      ["2025-06-01", "PP-4012", 4],
      ["2025-06-02", "NEW-1", 2],
      ["2025-06-03", "NEW-1", 0],
      ["2025-06-03", "PP-4012", 6],
    ]);
    expect(result.newProducts).toMatchObject([{ sku: "NEW-1", name: "Garden hose", unitPrice: 0, stock: null }]);
  });

  it("uses a Sales column of whole numbers as the units when there's no quantity column", () => {
    const result = parseSalesCsv(csv(["date,store,item,sales", "2013-01-01,1,1,13", "2013-01-01,2,1,11", "2013-01-02,1,1,14"]));
    expect(result).toMatchObject({ valid: 2, combined: 1, errors: [] });
    expect(result.columns).toMatchObject({ date: "date", product: "item", units: "sales", location: "store" });
    expect(result.records.map((r) => r.units)).toEqual([24, 14]);
    // Sales in money (with decimals) aren't units
    expect(parseSalesCsv(csv(["Date,Item,Sales", "2025-06-01,PP-4012,248.50"])).errors[0]).toMatch(/^Couldn't find a quantity column/);
  });

  it("forecasts the categories when the file has no product column", () => {
    const result = parseSalesCsv(csv(["Invoice ID,Product line,Unit price,Quantity,Date", "750-1,Health and beauty,74.69,7,1/5/2019", "750-2,Health and beauty,15.28,5,1/27/2019"]));
    expect(result.columns).toMatchObject({ product: "Product line", category: "Product line" });
    expect(result.records.map((r) => [r.date, r.sku, r.category])).toEqual([
      ["2019-01-05", "HEALTH-AND-BEAUTY", "Health and beauty"],
      ["2019-01-27", "HEALTH-AND-BEAUTY", "Health and beauty"],
    ]);
  });

  it("prefers the clearest column name, and finds columns by their contents under names it doesn't know", () => {
    // Region before State; Qty rather than the unit of measure; a known product under "Code"; dates under "When"
    const result = parseSalesCsv(
      csv(["When,Code,Unit,Qty,State,Region", "26/06/2025,PP-4012,KGS,5,Kerala,South", "27/06/2025,PE-7820,KGS,3,Kerala,South"]),
    );
    expect(result).toMatchObject({ valid: 2, errors: [] });
    expect(result.columns).toMatchObject({ date: "When", product: "Code", units: "Qty", region: "Region" });
  });

  it("reads semicolons, decimal commas and common European column names", () => {
    const result = parseSalesCsv("Datum;Artikel;Menge;Preis\n26.06.2025;PP-4012;4;248,50\n");
    expect(result).toMatchObject({ valid: 1, errors: [] });
    expect(result.records[0]).toMatchObject({ date: "2025-06-26", sku: "PP-4012", units: 4, unitPrice: 248.5 });
  });

  it("skips total rows", () => {
    const result = parseSalesCsv(csv(["Date,SKU,Qty", "2025-06-26,PP-4012,4", "Total,,4", ",Grand Total,4"]));
    expect(result).toMatchObject({ total: 1, valid: 1, missing: 0, invalidDates: 0 });
  });
});
