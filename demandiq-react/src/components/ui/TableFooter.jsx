/** Page numbers to show: all of them when there are few, otherwise first, last and a window around the current page. */
export function pageWindow(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = [1];
  const from = Math.max(2, Math.min(page - 1, pageCount - 4));
  const to = Math.min(pageCount - 1, Math.max(page + 1, 5));
  if (from > 2) pages.push("…");
  for (let p = from; p <= to; p++) pages.push(p);
  if (to < pageCount - 1) pages.push("…");
  pages.push(pageCount);
  return pages;
}

/** Table footer with "Showing…" text and numbered ‹ 1 2 3 › pagination. */
export function TableFooter({ label, page, pageCount, onPage }) {
  return (
    <div className="table-footer">
      <span>{label}</span>
      <div className="pagination" role="navigation" aria-label="Pagination">
        <button disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))} aria-label="Previous page">
          ‹
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="pagination-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              className={p === page ? "current" : ""}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          disabled={page >= pageCount}
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

/** Splits rows into pages; keeps the page in range when the list shrinks. */
export function paginate(rows, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: current,
    pageCount,
    label: rows.length
      ? `Showing ${(start + 1).toLocaleString()}–${Math.min(start + pageSize, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`
      : "Showing 0 of 0",
  };
}
