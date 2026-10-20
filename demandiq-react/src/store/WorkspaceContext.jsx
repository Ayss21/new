// UI actions any page can trigger: navigate, open the export dialog, open the side drawer,
// or start a stock update / reorder for a product.
import { createContext, useContext } from "react";

export const WorkspaceContext = createContext(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside the workspace");
  return ctx;
}
