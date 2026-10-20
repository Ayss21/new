import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // When the FastAPI backend runs on port 8000, requests to /api are forwarded to it.
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
});
