// Sales records, file uploads (any layout: CSV, text, Excel) and cleaning. The dataset history is the list of datasets.
import { api } from "./api";
import { filterQuery, segment } from "./query";

export const salesService = {
  /** GET /sales?start&end&category&sku&region (lists repeat) → sales records. Without filters: the whole history. */
  getSales: (filters) => api.get("/sales", { query: filters ? filterQuery(filters) : undefined }),

  /** GET /datasets → every upload attempt, newest first (pendingCount = validated records waiting to be cleaned) */
  getDatasets: () => api.get("/datasets"),

  /**
   * POST /datasets (multipart/form-data, field "file": a sales file of any layout — CSV, TSV, text or .xlsx)
   * → 201 { dataset, validation }. Products the catalog doesn't have are added (dataset.newProducts).
   * A file that fails validation → 422 { detail: { code: "invalid_file", message, validation, dataset } }
   * (the failed attempt is still recorded as a dataset).
   */
  uploadDataset: (file) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return api.post("/datasets", form);
  },

  /** POST /datasets/{id}/clean { capOutliers, overlap: "replace" | "skip" } → { dataset, summary, salesRange } */
  cleanDataset: (id, { capOutliers, overlap }) => api.post(`/datasets/${segment(id)}/clean`, { capOutliers, overlap }),
};
