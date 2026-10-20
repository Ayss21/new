// Reads the worksheets of an Excel (.xlsx) file into rows of cell texts — enough for a sales upload,
// without a library: an .xlsx file is a zip of XML files, unzipped here with the platform's
// DecompressionStream ("deflate-raw"; every current browser and Node 18+) and read with a few patterns.
// Numbers come back as Excel stores them (a date is usually a day number: see excelSerialDate).

const decoder = new TextDecoder("utf-8");

/** The files of a zip archive whose names pass `wanted`: Map(name → Uint8Array). */
async function unzip(buffer, wanted) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last 0x06054b50 within 64 KB of the end
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("This isn't a valid .xlsx file.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("This .xlsx file is damaged.");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error("This .xlsx file uses an unsupported compression.");
  }
  return files;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code) =>
    code[0] === "#" ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code.toLowerCase()],
  );

/** The text of a string item: every <t> run joined (rich text has several). */
const textOf = (xml) => unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** "B12" → 1 (zero-based column). */
function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** The rows of one worksheet's XML, every cell as text. */
function sheetRows(sheet, shared) {
  const rows = [];
  for (const [, rowXml] of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, attributes, content = ""] of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([^"]+)"/.exec(attributes)?.[1];
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1];
      const value = type === "s" ? (shared[Number(raw)] ?? "") : type === "inlineStr" ? textOf(content) : raw === undefined ? "" : unescapeXml(raw);
      const column = ref ? columnIndex(ref) : row.length;
      while (row.length < column) row.push("");
      row[column] = value;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Every worksheet, in the workbook's order with hidden sheets last: [{ name, rows }], where rows are
 * [["Date", "Product_ID", …], ["45826", "PP-4012", …], …]. Every cell is text; empty cells are "". Throws
 * when the file isn't a readable .xlsx workbook.
 */
export async function readXlsxSheets(buffer) {
  const files = await unzip(buffer, (name) => name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml" || name.startsWith("xl/worksheets/"));
  const read = (name) => (files.has(name) ? decoder.decode(files.get(name)) : null);
  const workbook = read("xl/workbook.xml");
  const relations = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !relations) throw new Error("This isn't a valid .xlsx file.");
  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const links = [...relations.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]);
  const sheets = [];
  // Each sheet → its file through the relationships
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const id = /\br:id="([^"]+)"/.exec(tag)?.[1];
    const link = links.find((candidate) => candidate.includes(`Id="${id}"`));
    const path = /Target="([^"]+)"/.exec(link ?? "")?.[1];
    const xml = path ? read(path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`) : null;
    if (!xml) continue; // a chart sheet
    sheets.push({ name: unescapeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? ""), hidden: /\bstate="(hidden|veryHidden)"/.test(tag), rows: sheetRows(xml, shared) });
  }
  if (!sheets.length) throw new Error("This .xlsx file has no worksheet.");
  return [...sheets.filter((s) => !s.hidden), ...sheets.filter((s) => s.hidden)].map(({ name, rows }) => ({ name, rows }));
}

/** Rows of the first worksheet (see readXlsxSheets). */
export async function readXlsxRows(buffer) {
  return (await readXlsxSheets(buffer))[0].rows;
}

/** An Excel day number as YYYY-MM-DD (45826 → "2025-06-18"), or null when it isn't one. */
export function excelSerialDate(text) {
  if (!/^\d{4,6}(\.\d+)?$/.test(String(text))) return null;
  const days = Math.floor(Number(text));
  if (days < 1 || days > 2958465) return null;
  return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
}
