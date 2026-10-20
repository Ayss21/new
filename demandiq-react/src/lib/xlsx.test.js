// The .xlsx reader used by sales uploads, checked against files written by a real Excel writer.
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { parseSalesTable } from "./domain";
import { excelSerialDate, readXlsxRows, readXlsxSheets } from "./xlsx";

const workbook = (rows) => writeXlsxFile(rows.map((row) => row.map((cell) => (cell && typeof cell === "object" && !(cell instanceof Date) ? cell : { value: cell })))).toBuffer();

describe("readXlsxRows", () => {
  it("reads the first sheet's cells as text, with dates as Excel day numbers", async () => {
    const buffer = await workbook([
      ["Date", "Product_ID", "Units_Sold", "Unit_Price"],
      [{ value: new Date(Date.UTC(2025, 5, 26)), type: Date, format: "yyyy-mm-dd" }, "PP-4012", 40, 248],
      ["2025-06-27", "PE-7820", 38, 224.5],
    ]);
    const rows = await readXlsxRows(buffer);
    expect(rows[0]).toEqual(["Date", "Product_ID", "Units_Sold", "Unit_Price"]);
    expect(rows[1].slice(1)).toEqual(["PP-4012", "40", "248"]);
    expect(excelSerialDate(rows[1][0])).toBe("2025-06-26");
    expect(rows[2]).toEqual(["2025-06-27", "PE-7820", "38", "224.5"]);
  });

  it("feeds the same checks as a CSV upload", async () => {
    const buffer = await workbook([
      ["date", "product id", "UNITS SOLD"],
      [{ value: new Date(Date.UTC(2025, 5, 26)), type: Date, format: "yyyy-mm-dd" }, "PP-4012", 40],
      ["2025-06-27", "PP-4012", 2.5],
      ["2025-06-27", "XX-0000", 4],
    ]);
    const result = parseSalesTable(await readXlsxRows(buffer));
    expect(result).toMatchObject({ total: 3, valid: 2, invalidNumeric: 1, missing: 0, errors: [] });
    expect(result.records[0]).toMatchObject({ date: "2025-06-26", sku: "PP-4012", units: 40 });
    expect(result.newProducts.map((p) => p.sku)).toEqual(["XX-0000"]);
  });

  it("reads every sheet, in the workbook's order", async () => {
    const buffer = await writeXlsxFile([
      { sheet: "Notes", data: [[{ value: "Prepared by the store" }]] },
      { sheet: "June & July", data: [[{ value: "SKU" }, { value: "Qty" }], [{ value: "PP-4012" }, { value: 3 }]] },
    ]).toBuffer();
    const sheets = await readXlsxSheets(buffer);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Notes", "June & July"]);
    expect(sheets[1].rows).toEqual([["SKU", "Qty"], ["PP-4012", "3"]]);
    expect(await readXlsxRows(buffer)).toEqual([["Prepared by the store"]]);
  });

  it("refuses files that aren't workbooks", async () => {
    await expect(readXlsxRows(new TextEncoder().encode("Date,Product_ID\n").buffer)).rejects.toThrow("This isn't a valid .xlsx file.");
  });
});

describe("excelSerialDate", () => {
  it("turns Excel day numbers into dates and leaves other text alone", () => {
    expect(excelSerialDate("45834")).toBe("2025-06-26");
    expect(excelSerialDate("45834.5")).toBe("2025-06-26");
    expect(excelSerialDate("2025-06-26")).toBeNull();
    expect(excelSerialDate("12")).toBeNull();
  });
});
