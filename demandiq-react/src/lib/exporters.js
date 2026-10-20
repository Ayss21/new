// Report files (CSV / XLSX / PDF) and saving downloaded files in the browser.
// buildReportFile is what the backend does for GET /reports/{id}/file (the demo backend calls it);
// saveBlob saves any file the API returns.

export function fileSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const REPORT_CONTENT_TYPES = {
  CSV: "text/csv;charset=utf-8",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
};

/** Builds a report file. Resolves to { blob, fileName, contentType }; rejects when there are no rows. */
export async function buildReportFile(format, rows, name, metadata) {
  if (!rows.length) throw new Error("There is no matching data to export.");
  const safeName = fileSlug(name);
  const headers = Object.keys(rows[0]);
  const contentType = REPORT_CONTENT_TYPES[format];

  if (format === "CSV") {
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
    // BOM so Excel opens the UTF-8 file correctly
    return { blob: new Blob(["\uFEFF" + csv], { type: contentType }), fileName: `${safeName}.csv`, contentType };
  }

  if (format === "XLSX") {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const sheet = [
      headers.map((header) => ({ value: header, fontWeight: "bold" })),
      ...rows.map((row) => headers.map((header) => ({ value: row[header] ?? "" }))),
    ];
    const blob = await writeExcelFile(sheet, { sheet: "Report" }).toBlob();
    return { blob, fileName: `${safeName}.xlsx`, contentType };
  }

  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header band in the DemandIQ jet black, with a teal accent rule
  doc.setFillColor(2, 43, 58); // --jet-black #022b3a
  doc.rect(0, 0, pageWidth, 58, "F");
  doc.setFillColor(31, 122, 140); // --teal #1f7a8c
  doc.rect(0, 58, pageWidth, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(name, 36, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("DemandIQ · Demand Forecasting & Inventory Management", 36, 44);

  doc.setTextColor(2, 43, 58); // --jet-black
  doc.setFontSize(8);
  metadata.forEach((line, index) => doc.text(line, 36, 78 + index * 11));

  const limit = 2000;
  autoTable(doc, {
    startY: 78 + metadata.length * 11 + 8,
    head: [headers],
    body: rows.slice(0, limit).map((row) => headers.map((header) => String(row[header] ?? ""))),
    margin: { left: 36, right: 36 },
    styles: { fontSize: 7.5, cellPadding: 3.5 },
    headStyles: { fillColor: [31, 122, 140], textColor: 255, fontStyle: "bold" }, // --teal
    alternateRowStyles: { fillColor: [240, 242, 248] }, // lavender tint
  });
  if (rows.length > limit) {
    const y = (doc.lastAutoTable?.finalY ?? 80) + 14;
    doc.text(`Showing ${limit} of ${rows.length} records. Use XLSX or CSV for the full dataset.`, 36, y);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(77, 117, 133); // --jet-light
    doc.text(`Generated ${new Date().toLocaleString()}`, 36, pageHeight - 16);
    doc.text(`Page ${i} of ${pages}`, pageWidth - 36, pageHeight - 16, { align: "right" });
  }
  return { blob: doc.output("blob"), fileName: `${safeName}.pdf`, contentType };
}

/** Saves a downloaded file (a Blob from the API) to the user's computer. */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
