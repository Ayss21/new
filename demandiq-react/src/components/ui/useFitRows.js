import { useLayoutEffect, useState } from "react";

/**
 * Rows per page that fill a table down to the bottom of the screen; pagination takes over after that.
 *
 *   const [tableRef, pageSize] = useFitRows({ min: 5 });
 *   const pageData = paginate(rows, page, pageSize);
 *   <table ref={tableRef}>…
 *
 * The hook measures, inside the scrolling content area, where the table body starts, the height of one
 * row, and everything that must stay visible below the rows (the table footer with the pager, the card
 * edge, and any blocks after the card such as action buttons), then returns how many rows fit. It
 * recalculates when the window or the page layout changes.
 *   min     never fewer rows (a table that starts low on the page still gets a useful page)
 *   max     never more rows
 *   stopAt  CSS selector of a later block that may sit below the fold, so no room is kept for it
 */
export function useFitRows({ min = 5, max = 50, rowHeight = 46, stopAt } = {}) {
  const [table, setTable] = useState(null);
  const [rows, setRows] = useState(min);

  useLayoutEffect(() => {
    const content = table?.closest(".content");
    if (!table || !content) return undefined;

    const measure = () => {
      const body = table.tBodies[0];
      if (!body) return;
      const contentBox = content.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      // Position inside the scrolling area, so scrolling never changes the result
      const top = bodyBox.top - contentBox.top + content.scrollTop;
      const paddingBottom = parseFloat(getComputedStyle(content).paddingBottom) || 0;

      const card = table.closest(".card") ?? table.parentElement;
      let below = card.getBoundingClientRect().bottom - bodyBox.bottom; // footer + pager + card edge
      const column = card.parentElement;
      const gap = parseFloat(getComputedStyle(column).rowGap) || 0;
      for (let el = card.nextElementSibling; el; el = el.nextElementSibling) {
        if (stopAt && el.matches(stopAt)) break;
        const position = getComputedStyle(el).position;
        if (position === "fixed" || position === "absolute") continue; // dialogs, toasts
        const height = el.getBoundingClientRect().height;
        if (height > 0) below += gap + height;
      }

      const firstRow = body.rows[0];
      const height = Math.max(20, firstRow ? firstRow.getBoundingClientRect().height : rowHeight);
      const space = content.clientHeight - paddingBottom - top - below;
      const fit = Math.floor((space + 1) / height);
      setRows(Math.max(min, Math.min(max, fit)));
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    for (const child of content.children) observer.observe(child);
    observer.observe(table);
    measure(); // first page size before paint, so the table doesn't jump
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [table, min, max, rowHeight, stopAt]);

  return [setTable, rows];
}
