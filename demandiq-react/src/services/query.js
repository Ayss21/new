// Turns the app's global filters into query parameters for the API:
//   { startDate, endDate, category: ["Polymers", "Chemicals"], sku: [], … }
//   → { start, end, category: ["Polymers", "Chemicals"] } → ?start=…&end=…&category=Polymers&category=Chemicals
// A list filter with nothing picked means "all", so it is left out. Several values repeat the parameter.
import { LIST_FILTERS, filterList } from "../lib/domain";

export function filterQuery(filters = {}) {
  const query = { start: filters.startDate || undefined, end: filters.endDate || undefined };
  for (const key of Object.keys(LIST_FILTERS)) {
    const values = filterList(filters[key]);
    if (values.length) query[key] = values;
  }
  return query;
}

/** Encodes one path segment, e.g. a dataset id with dots or spaces. */
export const segment = (id) => encodeURIComponent(String(id));
